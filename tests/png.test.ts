import { describe, expect, test } from "vitest";

import {
  PNG_SIGNATURE,
  STORED_BLOCK_MAX,
  adler32,
  crc32,
  encodePng,
} from "../src/png.js";

// ---------------------------------------------------------------------------
// Every expected value below comes from an independent oracle, never from
// the implementation under test: the CRC-32/Adler-32 vectors are Python
// binascii.crc32 / zlib.adler32 outputs (scratchpad crc_adler_oracle.py,
// 2026-07-11), and the 73-byte 1×1 vector is TRANSCRIBED from the
// design 06 §6 normative hex (the same oracle re-derived it from the
// recipe text and PIL-decoded it).
// ---------------------------------------------------------------------------

/**
 * The design 06 §6 normative vector: the 1×1 fully-transparent frame is
 * exactly these 73 bytes. Transcribed from the spec hex, not computed.
 */
const VECTOR_1X1_HEX =
  "89504e470d0a1a0a" + // signature
  "0000000d49484452" + // IHDR len 13, type
  "0000000100000001" + // w = 1, h = 1
  "08060000001f15c489" + // depth 8, RGBA, comp/filter/interlace 0, crc
  "0000001049444154" + // IDAT len 16, type
  "7801" + // zlib header
  "010500faff" + // final stored block, LEN = 5, NLEN
  "0000000000" + // filter 0 + RGBA(0,0,0,0)
  "00050001" + // adler32
  "64789538" + // IDAT crc
  "0000000049454e44ae426082"; // IEND

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  }
  return out;
}

/**
 * The oracle's deterministic LCG buffer (crc_adler_oracle.py `buf`):
 * x ← (x·1103515245 + 12345) mod 2^31, byte = (x >> 16) & 0xFF. BigInt —
 * the product overflows 2^53 for doubles.
 */
function lcgBytes(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = BigInt(seed);
  const m = 1n << 31n;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245n + 12345n) % m;
    out[i] = Number((x >> 16n) & 0xffn);
  }
  return out;
}

describe("CRC-32 / Adler-32 — oracle vectors (Python binascii/zlib)", () => {
  const VECTORS: readonly [string, Uint8Array, number, number][] = [
    ["empty", new Uint8Array(0), 0, 1],
    ["single zero", Uint8Array.of(0), 3523407757, 65537],
    ["single 0xff", Uint8Array.of(0xff), 4278190080, 16777472],
    ["abc", new TextEncoder().encode("abc"), 891568578, 38600999],
    ["123456789", new TextEncoder().encode("123456789"), 3421780262, 152961502],
    ["0..255", Uint8Array.from({ length: 256 }, (_, i) => i), 688229491, 2918612865],
    ["65535 zeros (one full stored block)", new Uint8Array(65535), 2503374279, 917505],
    ["65536 zeros (block split boundary)", new Uint8Array(65536), 3617033963, 983041],
    ["LCG 72060 bytes seed 42", lcgBytes(300 * 60 * 4 + 60, 42), 473394451, 2842637341],
  ];

  for (const [name, data, crc, adler] of VECTORS) {
    test(name, () => {
      expect(crc32(data)).toBe(crc);
      expect(adler32(data)).toBe(adler);
    });
  }
});

describe("the design 06 §6 normative 1×1 vector (MUST-PASS)", () => {
  test("encodePng of one transparent pixel is exactly the 73 spec bytes", () => {
    const png = encodePng(new Uint8Array(4), 1, 1);
    expect(png.length).toBe(73);
    expect(Buffer.from(png).toString("hex")).toBe(VECTOR_1X1_HEX);
  });
});

// ---------------------------------------------------------------------------
// Structure tests: chunk walk on the encoder's own output
// ---------------------------------------------------------------------------

interface Chunk {
  readonly type: string;
  readonly data: Uint8Array;
  readonly crc: number;
}

function readU32BE(b: Uint8Array, at: number): number {
  return b[at]! * 16777216 + b[at + 1]! * 65536 + b[at + 2]! * 256 + b[at + 3]!;
}

/** Chunk walker: verifies signature and per-chunk CRC, returns chunks. */
function walkChunks(png: Uint8Array): Chunk[] {
  expect([...png.slice(0, 8)]).toEqual([...PNG_SIGNATURE]);
  const chunks: Chunk[] = [];
  let pos = 8;
  while (pos < png.length) {
    const len = readU32BE(png, pos);
    const body = png.slice(pos + 4, pos + 8 + len);
    const type = String.fromCharCode(...body.slice(0, 4));
    const crc = readU32BE(png, pos + 8 + len);
    expect(crc).toBe(crc32(body));
    chunks.push({ type, data: body.slice(4), crc });
    pos += 12 + len;
  }
  expect(pos).toBe(png.length); // no trailing bytes
  return chunks;
}

/** Parse the zlib stream of an IDAT: stored blocks + adler check. */
function inflateStored(idat: Uint8Array): { stream: Uint8Array; blocks: number[] } {
  expect(idat[0]).toBe(0x78);
  expect(idat[1]).toBe(0x01);
  const parts: number[] = [];
  const blocks: number[] = [];
  let pos = 2;
  for (;;) {
    const bfinal = idat[pos]!;
    expect([0, 1]).toContain(bfinal);
    const len = idat[pos + 1]! + 256 * idat[pos + 2]!;
    const nlen = idat[pos + 3]! + 256 * idat[pos + 4]!;
    expect(nlen).toBe(len ^ 0xffff);
    blocks.push(len);
    for (let i = 0; i < len; i++) parts.push(idat[pos + 5 + i]!);
    pos += 5 + len;
    if (bfinal === 1) break;
    expect(len).toBe(STORED_BLOCK_MAX); // non-final blocks are full
  }
  const stream = Uint8Array.from(parts);
  expect(readU32BE(idat, pos)).toBe(adler32(stream));
  expect(pos + 4).toBe(idat.length);
  return { stream, blocks };
}

describe("encoder structure (design 06 §6 recipe)", () => {
  test("chunk layout: IHDR, one IDAT, IEND — nothing ancillary", () => {
    const png = encodePng(new Uint8Array(2 * 3 * 4), 2, 3);
    const chunks = walkChunks(png);
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    const ihdr = chunks[0]!.data;
    expect(ihdr.length).toBe(13);
    expect(readU32BE(ihdr, 0)).toBe(2);
    expect(readU32BE(ihdr, 4)).toBe(3);
    expect([...ihdr.slice(8)]).toEqual([8, 6, 0, 0, 0]); // depth 8, RGBA, 0, 0, 0
    expect(chunks[2]!.data.length).toBe(0);
  });

  test("scanlines carry filter byte 0 and the raw RGBA bytes", () => {
    const w = 3;
    const h = 2;
    const rgba = Uint8Array.from({ length: w * h * 4 }, (_, i) => (i * 7 + 1) % 256);
    const png = encodePng(rgba, w, h);
    const { stream } = inflateStored(walkChunks(png)[1]!.data);
    expect(stream.length).toBe(h * (1 + w * 4));
    for (let y = 0; y < h; y++) {
      const row = stream.slice(y * (1 + w * 4), (y + 1) * (1 + w * 4));
      expect(row[0]).toBe(0); // filter byte
      expect([...row.slice(1)]).toEqual([...rgba.slice(y * w * 4, (y + 1) * w * 4)]);
    }
  });

  test("multi-block split at 65535: a 300×60 buffer makes two stored blocks", () => {
    // Stream = 60·(1 + 1200) = 72060 bytes > 65535 → blocks 65535 + 6525.
    const rgba = lcgBytes(300 * 60 * 4, 7);
    const png = encodePng(rgba, 300, 60);
    const { stream, blocks } = inflateStored(walkChunks(png)[1]!.data);
    expect(blocks).toEqual([65535, 72060 - 65535]);
    expect(stream.length).toBe(72060);
    // Spot-check content across the split boundary.
    const rowBytes = 300 * 4;
    for (const y of [0, 30, 54, 59]) {
      expect(stream[y * (1 + rowBytes)]).toBe(0);
      expect(stream[y * (1 + rowBytes) + 1]).toBe(rgba[y * rowBytes]);
      expect(stream[(y + 1) * (1 + rowBytes) - 1]).toBe(rgba[(y + 1) * rowBytes - 1]);
    }
  });

  test("an exactly-65535-byte stream stays one final full block", () => {
    // h·(1 + w·4) = 65535 with w = 34, h = 481: 481·137 = 65897 — no.
    // Use w = 16, h = 1008…? 1008·65 = 65520. Simpler: w = 32766/…
    // Pick h = 15, w = 1092: 15·(1 + 4368) = 65535 exactly.
    const rgba = new Uint8Array(1092 * 15 * 4);
    const png = encodePng(rgba, 1092, 15);
    const { blocks } = inflateStored(walkChunks(png)[1]!.data);
    expect(blocks).toEqual([65535]);
  });

  test("determinism: two encodes are byte-identical", () => {
    const rgba = lcgBytes(32 * 32 * 4, 3);
    const a = encodePng(rgba, 32, 32);
    const b = encodePng(rgba, 32, 32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  test("traps: bad dimensions and buffer mismatches", () => {
    expect(() => encodePng(new Uint8Array(4), 0, 1)).toThrow(RangeError);
    expect(() => encodePng(new Uint8Array(4), 1, 0)).toThrow(RangeError);
    expect(() => encodePng(new Uint8Array(4), 1.5, 1)).toThrow(RangeError);
    expect(() => encodePng(new Uint8Array(8), 1, 1)).toThrow(RangeError);
    expect(() => encodePng(new Uint8Array(0), 1, 1)).toThrow(RangeError);
  });
});
