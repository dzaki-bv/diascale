import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calcBody, fma } from "../src/body.ts";

// Exported from research/scale/tools/wla43_clean.py by export_body_vectors.py.
const vectors = JSON.parse(readFileSync(new URL("./fixtures/body.json", import.meta.url), "utf8"));

test("fma rounds once like a fused multiply-add", () => {
  // a*a = 1 + 2^-29 + 2^-60 loses 2^-60 when rounded before the add; fused keeps it.
  const a = 1 + 2 ** -30;
  assert.equal(a * a - 1, 2 ** -29);
  assert.equal(fma(a, a, -1), 2 ** -29 + 2 ** -60);
  assert.equal(fma(2, 3, 4), 10);
  assert.equal(fma(0.1, 10, -1), 5.551115123125783e-17);
});

test("matches every golden vector of the reference implementation exactly", () => {
  assert.equal(vectors.length, 500);
  for (const [i, { input, output }] of vectors.entries()) assert.deepEqual(calcBody(input), output, `vector ${i}`);
});
