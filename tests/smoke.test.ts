import { expect, test } from "vitest";

import { GENERATOR_VERSION } from "../src/index.js";

test("toolchain smoke: src imports resolve and GENERATOR_VERSION is 3", () => {
  expect(GENERATOR_VERSION).toBe(3);
});
