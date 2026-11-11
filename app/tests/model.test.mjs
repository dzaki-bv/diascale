import { test } from "node:test";
import assert from "node:assert/strict";
import { isAdult, normalizePhone, viewMeasurement } from "../src/model.js";
import { measurement } from "./support/records.ts";
test("Indonesian phone formats normalize consistently", () => {
  for (const phone of ["081234567890", "+62 812 3456 7890", "6281234567890"])
    assert.equal(normalizePhone(phone), "81234567890");
});
test("adult validation handles exact birthdays and rejects invalid dates", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  assert.equal(isAdult("2008-11-01", now), true);
  assert.equal(isAdult("2008-11-02", now), false);
  assert.equal(isAdult("2000-02-30", now), false);
  assert.equal(isAdult("2026-01-01", now), false);
});
test("result presentation uses the archived score and profile rather than current form values", () => {
  const raw = measurement();
  const view = viewMeasurement(raw);
  assert.equal(view.score, 16);
  assert.equal(view.risk, "Aman");
  assert.equal(
    view.contributions.reduce((sum, row) => sum + row.points, 0),
    16,
  );
  assert.equal(view.profile.height, "147");
  assert.equal(view.raw, raw);
});
