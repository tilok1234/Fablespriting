/**
 * Fablesprite — the M1 PNG encoder (design 06 §6, normative).
 *
 * RGBA buffer → PNG bytes, byte-exactly per the §6 recipe: M1 ships its
 * OWN minimal encoder because delegating encoding breaks the byte-identity
 * promise (the spike phase proved Pillow re-renders pixel-identically but
 * not byte-identically across versions — §6). The output is fully
 * determined by the input:
 *
 * - PNG signature `89 50 4E 47 0D 0A 1A 0A`;
 * - `IHDR`: width, height (u32 BE), bit depth 8, color type 6 (RGBA),
 *   compression 0, filter 0, interlace 0;
 * - one `IDAT` chunk holding one zlib stream: header `78 01`, deflate
 *   STORED blocks — each block a `BFINAL|BTYPE=00` byte (`01` on the
 *   final block), LEN (u16 LE), NLEN = LEN XOR 0xFFFF, then data; blocks
 *   split at 65535 bytes. Stream data = scanlines, each prefixed by
 *   filter byte 0 (no filtering, ever). Adler-32 over the full
 *   uncompressed stream INCLUDING each scanline's leading filter byte
 *   (§0), u32 BE, closes the stream;
 * - `IEND`; NO ancillary chunks — no tEXt, pHYs, gAMA, sRGB, nothing;
 * - chunk CRCs: standard PNG CRC-32 (reflected 0xEDB88320) over
 *   type + data.
 *
 * The normative vector: the 1×1 fully-transparent frame is exactly the
 * 73 bytes listed in §6 — transcribed (not computed) into
 * tests/png.test.ts as a must-pass golden, and independently reproduced
 * by the scratchpad Python oracle from the recipe text alone.
 *
 * CRC-32 and Adler-32 are plain integer arithmetic on unsigned 32-bit
 * values (they are bit-manipulation checksums, not 16.16 creature-space
 * math — the §5.2 bitwise ban protects fp raws, which never enter this
 * module). Both are differentially verified against Python's
 * binascii.crc32 / zlib.adler32 over an independent corpus
 * (tests/png.test.ts pins oracle-derived vectors).
 */

// ---------------------------------------------------------------------------
// CRC-32 (reflected 0xEDB88320) — the PNG chunk checksum
// ---------------------------------------------------------------------------

/** The 256-entry CRC-32 table for the reflected polynomial 0xEDB88320. */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) === 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * Standard PNG CRC-32 (ISO 3309 / ITU-T V.42, reflected 0xEDB88320,
 * init and final XOR 0xFFFFFFFF) over `bytes`. Returns an unsigned
 * 32-bit integer. Differentially pinned against Python binascii.crc32.
 */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = (CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Adler-32 — the zlib stream checksum
// ---------------------------------------------------------------------------

/**
 * Largest n such that 255·n·(n+1)/2 + (n+1)·65520 < 2^31 — zlib's NMAX:
 * the modulo can be deferred across runs of 5552 bytes without s2
 * overflowing the exact-integer range.
 */
const ADLER_NMAX = 5552;

/**
 * Adler-32 (RFC 1950): s1/s2 accumulation mod 65521, initial value 1,
 * result s2·65536 + s1 as an unsigned 32-bit integer. Differentially
 * pinned against Python zlib.adler32.
 */
export function adler32(bytes: Uint8Array): number {
  let s1 = 1;
  let s2 = 0;
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const end = Math.min(i + ADLER_NMAX, n);
    for (; i < end; i++) {
      s1 += bytes[i]!;
      s2 += s1;
    }
    s1 %= 65521;
    s2 %= 65521;
  }
  return (s2 * 65536 + s1) >>> 0;
}

// ---------------------------------------------------------------------------
// The encoder
// ---------------------------------------------------------------------------

/** PNG signature `89 50 4E 47 0D 0A 1A 0A` (design 06 §6). */
export const PNG_SIGNATURE: readonly number[] = Object.freeze([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** Deflate stored-block payload cap (LEN is u16): 65535 bytes. */
export const STORED_BLOCK_MAX = 65535;

function pushU32BE(out: number[], v: number): void {
  out.push(Math.floor(v / 16777216) % 256, Math.floor(v / 65536) % 256, Math.floor(v / 256) % 256, v % 256);
}

/** Append one chunk: length, type, data, CRC-32 over type + data. */
function pushChunk(out: number[], type: string, data: readonly number[]): void {
  pushU32BE(out, data.length);
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
  body.set(data, 4);
  for (const b of body) out.push(b);
  pushU32BE(out, crc32(body));
}

/**
 * Encode an RGBA buffer as PNG bytes, byte-exactly per the design 06 §6
 * recipe (see the module doc). `rgba` is the §6 artifact-1 form —
 * width·height·4 bytes, rows top-to-bottom, pixels left-to-right, byte
 * order R, G, B, A — exactly what `applyPalette` returns, so the golden
 * RGBA hash and the PNG encoder consume one buffer with no reshaping.
 *
 * Traps (RangeError) on a dimension/buffer mismatch, non-positive or
 * non-integer dimensions, or dimensions beyond the PNG u31 limit —
 * never truncates or pads.
 */
export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`png: dimensions must be positive integers, got ${width}×${height}`);
  }
  if (width > 0x7fffffff || height > 0x7fffffff) {
    throw new RangeError(`png: dimensions exceed the PNG 2^31−1 limit: ${width}×${height}`);
  }
  if (rgba.length !== width * height * 4) {
    throw new RangeError(
      `png: buffer length ${rgba.length} is not width·height·4 = ${width * height * 4}`,
    );
  }

  // Uncompressed zlib stream: each scanline prefixed by filter byte 0.
  const rowBytes = width * 4;
  const stream = new Uint8Array(height * (1 + rowBytes));
  for (let y = 0; y < height; y++) {
    // stream[y * (1 + rowBytes)] = 0 — filter byte 0, already zero-filled.
    stream.set(rgba.subarray(y * rowBytes, (y + 1) * rowBytes), y * (1 + rowBytes) + 1);
  }

  // zlib: header 78 01, stored blocks split at 65535, Adler-32 (BE) over
  // the FULL uncompressed stream, filter bytes included (§0).
  const idat: number[] = [0x78, 0x01];
  let pos = 0;
  do {
    const len = Math.min(STORED_BLOCK_MAX, stream.length - pos);
    const final = pos + len === stream.length;
    const nlen = len ^ 0xffff;
    idat.push(final ? 0x01 : 0x00);
    idat.push(len % 256, Math.floor(len / 256)); // LEN u16 LE
    idat.push(nlen % 256, Math.floor(nlen / 256)); // NLEN u16 LE
    for (let i = 0; i < len; i++) idat.push(stream[pos + i]!);
    pos += len;
  } while (pos < stream.length);
  pushU32BE(idat, adler32(stream));

  // IHDR data: w, h (u32 BE), depth 8, color type 6, compression 0,
  // filter 0, interlace 0.
  const ihdr: number[] = [];
  pushU32BE(ihdr, width);
  pushU32BE(ihdr, height);
  ihdr.push(8, 6, 0, 0, 0);

  const out: number[] = [...PNG_SIGNATURE];
  pushChunk(out, "IHDR", ihdr);
  pushChunk(out, "IDAT", idat);
  pushChunk(out, "IEND", []);
  return Uint8Array.from(out);
}
