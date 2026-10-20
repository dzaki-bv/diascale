import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

globalThis.location = new URL("https://diascale.test/");
const {
  state,
  sampleProfile,
  createExampleRecord,
  emptyProfile,
  normalizePhone,
  saveAccount,
  clearAccount,
  openAccount,
  demoHistory,
} = await import("../src/model.js");
beforeEach(() => clearAccount());

test("Indonesian mobile number formats normalize to the same account key", () => {
  assert.equal(normalizePhone("081234567890"), "81234567890");
  assert.equal(normalizePhone("+62 812 3456 7890"), "81234567890");
  assert.equal(normalizePhone("6281234567890"), "81234567890");
});

test("example record keeps raw measurement units and a coherent score", () => {
  const record = createExampleRecord(sampleProfile, "DS-008");
  assert.equal(record.bmi, 24.5);
  assert.equal(record.score, 51);
  assert.equal(record.device, "DS-008");
  assert.deepEqual(
    record.contributions.map((row) => row.value),
    ["12 level", "28,4%", "24,5 kg/m²", "24,1 kg", "Tidak"],
  );
});

test("antihypertensive answer is captured with its own contribution", () => {
  const record = createExampleRecord(
    { ...sampleProfile, meds: "Ya" },
    "DS-001",
  );
  assert.equal(record.score, 56);
  assert.deepEqual(record.contributions.at(-1), {
    label: "Obat antihipertensi",
    value: "Ya",
    points: 5,
  });
});

test("editing the current profile does not rewrite an existing result", () => {
  const profile = { ...sampleProfile };
  const record = createExampleRecord(profile, "DS-001");
  profile.meds = "Ya";
  profile.waist = "95";
  profile.height = "180";
  assert.equal(record.profile.waist, "84");
  assert.equal(record.profile.meds, "Tidak");
  assert.equal(record.bmi, 24.5);
  assert.equal(record.score, 51);
});

test("logout clears all visible account data", () => {
  state.profile = { ...sampleProfile };
  state.phone = "81211111111";
  state.history = [createExampleRecord(state.profile, "DS-001")];
  state.selected = state.history[0];
  clearAccount();
  assert.deepEqual(state.profile, emptyProfile());
  assert.deepEqual(state.history, []);
  assert.equal(state.selected, null);
  assert.equal(state.phone, "");
});

test("saved accounts are separated by phone and restored using normalized numbers", () => {
  state.phone = "81222222222";
  state.profile = { ...sampleProfile, name: "Akun A" };
  state.history = [createExampleRecord(state.profile, "DS-008")];
  saveAccount();
  clearAccount();
  openAccount("81233333333", "signup");
  assert.equal(state.profile.name, "");
  assert.equal(state.history.length, 0);
  openAccount("+62 812 2222 2222", "login");
  assert.equal(state.profile.name, "Akun A");
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].device, "DS-008");
});

test("restored history is a copy, including its contribution snapshot", () => {
  state.phone = "81244444444";
  state.profile = { ...sampleProfile };
  state.history = [createExampleRecord(state.profile, "DS-001")];
  saveAccount();
  state.history[0].profile.waist = "200";
  state.history[0].contributions[0].points = 99;
  openAccount("81244444444", "login");
  assert.equal(state.history[0].profile.waist, "84");
  assert.equal(state.history[0].contributions[0].points, 30);
});

test("demo history is recent and each risk total agrees with its contribution rows", () => {
  const records = demoHistory();
  assert.equal(records.length, 4);
  assert.deepEqual(
    records.map((record) => record.score),
    [51, 55, 58, 61],
  );
  assert.ok(Date.now() - records[0].date.getTime() < 60000);
  for (const record of records)
    assert.equal(
      record.contributions.reduce((sum, row) => sum + row.points, 0),
      record.score,
    );
});
