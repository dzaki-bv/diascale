import { env, exports } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { LocalStore } from "../../app/src/storage.ts";
import { SyncEngine } from "../../app/src/sync.ts";
import {
  memoryDriver,
  measurement,
  profile,
} from "../../app/tests/support/records.ts";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM measurements"),
    env.DB.prepare("DELETE FROM accounts"),
  ]);
});

it("syncs an offline result after restart, and a lost response still creates exactly one D1 row", async () => {
  const driver = memoryDriver();
  const store = new LocalStore(driver);
  await store.load();
  await store.saveProfile(profile.phone, profile);
  const m = measurement();
  await store.saveMeasurement(profile.phone, m);
  let online = false;
  let now = 1000;
  let loseResponse = true;
  const requests: string[] = [];
  const engine = new SyncEngine(store, {
    url: "https://archive.test",
    online: () => online,
    now: () => now,
    random: () => 0,
    fetch: async (url, init) => {
      requests.push(String(url));
      const response = await exports.default.fetch(String(url), init);
      if (String(url).endsWith("/measurements") && loseResponse) {
        loseResponse = false;
        expect(response.status).toBe(201);
        throw new Error("connection lost after server committed");
      }
      return response;
    },
  });
  engine.start();
  await engine.flush();
  expect(requests).toHaveLength(0);
  online = true;
  await engine.flush();
  engine.stop();
  expect(store.snapshot().outgoing).toHaveLength(1);
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS n FROM measurements").first("n"),
  ).toBe(1);
  const credentials = store.snapshot().credentials;
  expect(credentials).not.toBeNull();

  const reopened = new LocalStore(driver);
  await reopened.load();
  now = 5000;
  const restarted = new SyncEngine(reopened, {
    url: "https://archive.test",
    online: () => true,
    now: () => now,
    fetch: async (url, init) => {
      expect(String(url)).toBe("https://archive.test/v1/measurements");
      const response = await exports.default.fetch(String(url), init);
      expect(response.status).toBe(200);
      return response;
    },
  });
  try {
    restarted.start();
    await restarted.flush();
    expect(reopened.snapshot().outgoing).toHaveLength(0);
    expect(reopened.snapshot().accounts[profile.phone].history).toEqual([m]);
    expect(reopened.snapshot().credentials).toEqual(credentials);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first("n"),
    ).toBe(1);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM measurements").first("n"),
    ).toBe(1);
    const payload = await env.DB.prepare(
      "SELECT payload FROM measurements",
    ).first<string>("payload");
    expect(JSON.parse(payload!)).toEqual(m);
  } finally {
    restarted.stop();
    engine.stop();
  }
});
