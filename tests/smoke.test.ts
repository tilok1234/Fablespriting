import { expect, test } from "vitest";

import { GENERATOR_VERSION } from "../src/index.js";

test("toolchain smoke: src imports resolve and GENERATOR_VERSION is 2", () => {
  expect(GENERATOR_VERSION).toBe(2);
});
