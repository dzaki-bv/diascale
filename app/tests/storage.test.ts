import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalStore } from "../src/storage.ts";
import { measurement, memoryDriver, profile } from "./support/records.ts";

test("profile, raw history, outgoing queue and install identity survive reopening", async () => {
  const driver = memoryDriver();
  const store = new LocalStore(driver);
  await store.load();
  await store.saveProfile(profile.phone, profile);
  const m = measurement();
  await store.saveMeasurement(profile.phone, m);
  await store.update((data) => {
    data.credentials = { id: "account", token: "secret" };
  });
  const reopened = new LocalStore(driver);
  await reopened.load();
  assert.deepEqual(reopened.snapshot(), store.snapshot());
  assert.deepEqual(reopened.snapshot().accounts[profile.phone].history, [m]);
  assert.equal(reopened.snapshot().outgoing[0].measurement.id, m.id);
});

test("history and queue are saved atomically and a failed write can be retried", async () => {
  const driver = memoryDriver();
  const store = new LocalStore(driver);
  await store.load();
  await store.saveProfile(profile.phone, profile);
  const before = driver.value;
  const m = measurement();
  driver.fail = true;
  await assert.rejects(store.saveMeasurement(profile.phone, m), /disk full/);
  assert.equal(driver.value, before);
  assert.equal(store.snapshot().outgoing.length, 0);
  assert.equal(store.snapshot().accounts[profile.phone].history.length, 0);
  driver.fail = false;
  await store.saveMeasurement(profile.phone, m);
  await store.saveMeasurement(profile.phone, m);
  assert.equal(store.snapshot().outgoing.length, 1);
  assert.equal(store.snapshot().accounts[profile.phone].history.length, 1);
});

test("concurrent writes preserve both results and a later profile update never rewrites snapshots", async () => {
  const store = new LocalStore(memoryDriver());
  await store.load();
  await store.saveProfile(profile.phone, profile);
  const first = measurement();
  const second = measurement();
  await Promise.all([
    store.saveMeasurement(profile.phone, first),
    store.saveMeasurement(profile.phone, second),
    store.saveProfile(profile.phone, {
      ...profile,
      heightCm: 180,
      antihypertensive: true,
    }),
  ]);
  const data = store.snapshot();
  assert.equal(data.outgoing.length, 2);
  assert.deepEqual(data.accounts[profile.phone].history, [second, first]);
  assert.equal(data.accounts[profile.phone].profile.heightCm, 180);
  assert.equal(data.accounts[profile.phone].history[0].profile.heightCm, 147);
});

test("corrupt or unknown storage is preserved instead of reset", async () => {
  for (const original of ["{", JSON.stringify({ version: 2 })]) {
    const driver = memoryDriver(original);
    const store = new LocalStore(driver);
    await assert.rejects(store.load());
    assert.equal(driver.value, original);
  }
});

test("opening upgrades older scores in history and queue once, keeping everything else", async () => {
  const driver = memoryDriver();
  const store = new LocalStore(driver);
  await store.load();
  await store.saveProfile(profile.phone, profile);
  const current = measurement();
  await store.saveMeasurement(profile.phone, current);
  const old = JSON.parse(driver.value!);
  for (const m of [
    old.accounts[profile.phone].history[0],
    old.outgoing[0].measurement,
  ]) {
    m.score = { points: { visceral: 0, fat: 5, bmi: 0, muscle: 7, antihypertensive: 0 }, total: 12, category: "Aman" };
    m.versions.score = "diascale@1";
  }
  driver.value = JSON.stringify(old);

  const reopened = new LocalStore(driver);
  await reopened.load();
  const data = reopened.snapshot();
  assert.deepEqual(data.accounts[profile.phone].history, [current]);
  assert.deepEqual(data.outgoing[0].measurement, current);
  assert.deepEqual(JSON.parse(driver.value!), data, "the upgrade is saved");
  const saved = driver.value;
  await new LocalStore(driver).load();
  assert.equal(driver.value, saved, "an upgraded document is not rewritten");
});
