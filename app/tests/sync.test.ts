import { test } from "node:test";
import assert from "node:assert/strict";
import { SyncEngine } from "../src/sync.ts";
import { LocalStore } from "../src/storage.ts";
import { measurement, memoryDriver, profile } from "./support/records.ts";

const token = "a".repeat(64);
async function setup(
  t: { after: (fn: () => void) => void },
  respond: (
    url: string,
    init: RequestInit,
    store: LocalStore,
  ) => Promise<Response> | Response,
  initialCredentials = true,
) {
  const driver = memoryDriver();
  const store = new LocalStore(driver);
  await store.load();
  await store.saveProfile(profile.phone, profile);
  await store.saveMeasurement(profile.phone, measurement());
  if (initialCredentials)
    await store.update((data) => {
      data.credentials = { id: "account", token };
    });
  let now = 1000;
  let online = true;
  const calls: { url: string; init: RequestInit }[] = [];
  const engine = new SyncEngine(store, {
    url: "http://127.0.0.1:8787",
    now: () => now,
    random: () => 0,
    online: () => online,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return respond(String(url), init!, store);
    },
  });
  t.after(() => engine.stop());
  return {
    store,
    driver,
    engine,
    calls,
    setNow(value: number) {
      now = value;
    },
    setOnline(value: boolean) {
      online = value;
    },
  };
}
const accepted = (init: RequestInit, duplicate = false) =>
  Response.json(
    { id: JSON.parse(init.body as string).id, duplicate },
    { status: duplicate ? 200 : 201 },
  );

test("creates and durably stores one install account before sending any record", async (t) => {
  const app = await setup(
    t,
    (url, init, store) => {
      if (url.endsWith("/accounts"))
        return Response.json({ id: "new", token }, { status: 201 });
      assert.deepEqual(store.snapshot().credentials, { id: "new", token });
      assert.equal(
        (init.headers as Record<string, string>).Authorization,
        `Bearer ${token}`,
      );
      return accepted(init);
    },
    false,
  );
  app.engine.start();
  await app.engine.flush();
  assert.equal(app.calls.length, 2);
  assert.equal(app.store.snapshot().outgoing.length, 0);
  assert.equal(app.store.snapshot().accounts[profile.phone].history.length, 1);
  await app.engine.flush();
  assert.equal(app.calls.length, 2);
});

test("offline queue survives restart and a duplicate response only removes the queue entry", async (t) => {
  const app = await setup(t, (_url, init) => accepted(init, true));
  app.setOnline(false);
  app.engine.start();
  await app.engine.flush();
  assert.equal(app.calls.length, 0);
  const original = app.store.snapshot().outgoing[0].measurement;
  const reopened = new LocalStore(app.driver);
  await reopened.load();
  assert.deepEqual(reopened.snapshot().outgoing[0].measurement, original);
  app.setOnline(true);
  await app.engine.flush();
  assert.equal(app.store.snapshot().outgoing.length, 0);
  assert.deepEqual(app.store.snapshot().accounts[profile.phone].history, [
    original,
  ]);
});

test("network failure and retryable HTTP errors back off and resend the identical client ID", async (t) => {
  let attempt = 0;
  const app = await setup(t, (_url, init) => {
    attempt++;
    if (attempt === 1) throw new Error("offline");
    if (attempt === 2) return new Response(null, { status: 503 });
    return accepted(init);
  });
  app.engine.start();
  await app.engine.flush();
  assert.equal(app.store.snapshot().outgoing[0].nextAttemptAt, 2000);
  await app.engine.flush();
  assert.equal(app.calls.length, 1);
  app.setNow(2000);
  await app.engine.flush();
  assert.equal(app.store.snapshot().outgoing[0].nextAttemptAt, 4000);
  app.setNow(4000);
  await app.engine.flush();
  assert.equal(app.store.snapshot().outgoing.length, 0);
  assert.equal(
    new Set(app.calls.map((call) => JSON.parse(call.init.body as string).id))
      .size,
    1,
  );
});

test("permanent errors retain local history and queue entries without inventing a new identity", async (t) => {
  for (const status of [400, 401, 403, 409, 413, 415, 422]) {
    const app = await setup(t, () => new Response(null, { status }));
    app.engine.start();
    await app.engine.flush();
    assert.equal(app.store.snapshot().outgoing[0].blocked, true);
    app.setNow(999999);
    await app.engine.flush();
    assert.equal(app.calls.length, 1);
    assert.equal(app.store.snapshot().credentials?.id, "account");
    assert.equal(
      app.store.snapshot().accounts[profile.phone].history.length,
      1,
    );
    app.engine.stop();
  }
});

test("coalesces concurrent flushes and refuses mismatched success responses", async (t) => {
  const app = await setup(t, () =>
    Response.json({ id: "wrong", duplicate: false }, { status: 201 }),
  );
  app.engine.start();
  await Promise.all([
    app.engine.flush(),
    app.engine.flush(),
    app.engine.flush(),
  ]);
  assert.equal(app.calls.length, 1);
  assert.equal(app.store.snapshot().outgoing.length, 1);
  assert.equal(app.store.snapshot().outgoing[0].attempts, 1);
});

test("a failed local acknowledgment keeps the same queued result for an idempotent retry", async (t) => {
  let first = true;
  const app = await setup(t, (_url, init) => {
    if (first) {
      first = false;
      app.driver.fail = true;
    }
    return accepted(init, !app.driver.fail);
  });
  app.engine.start();
  await app.engine.flush();
  assert.equal(app.store.snapshot().outgoing.length, 1);
  app.driver.fail = false;
  app.setNow(5000);
  await app.engine.flush();
  assert.equal(app.store.snapshot().outgoing.length, 0);
});

test("an unconfigured archive makes no requests and leaves all data local", async (t) => {
  const store = new LocalStore(memoryDriver());
  await store.load();
  const engine = new SyncEngine(store, {
    url: "",
    fetch: async () => {
      throw new Error("should not fetch");
    },
  });
  t.after(() => engine.stop());
  engine.start();
  await engine.flush();
  assert.equal(store.snapshot().credentials, null);
  assert.throws(() => new SyncEngine(store, { url: "http://public.test" }));
});
