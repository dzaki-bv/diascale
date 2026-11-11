import { env, exports } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import {
  buildMeasurement,
  fromHex,
  ScaleSession,
  type Measurement,
} from "@diascale/core";
import captures from "../../packages/core/test/fixtures/captures.json";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM measurements"),
    env.DB.prepare("DELETE FROM accounts"),
  ]);
});

function request(path: string, init?: RequestInit) {
  return exports.default.fetch(`https://archive.test${path}`, init);
}

async function account() {
  const response = await request("/v1/accounts", { method: "POST" });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; token: string };
}

function measurement(): Measurement {
  const session = new ScaleSession({
    heightCm: 147,
    lastWeightKg: 45.7,
    male: true,
    age: 19,
    userId: 0x0da5ca1e,
  });
  for (const packet of captures["device-test-b-handshake"]) {
    if (packet.dir !== "in") continue;
    for (const event of session.receive(fromHex(packet.hex)).events) {
      if (event.type === "result")
        return buildMeasurement({
          measuredAt: "2026-11-01T03:10:00.000Z",
          profile: {
            name: "Uji B",
            phone: "081200000000",
            birthDate: "2007-03-01",
            sex: "male",
            heightCm: 147,
            antihypertensive: false,
            familyHistory: true,
            highGlucose: false,
          },
          record: event.record,
          packets: session.packets,
        });
    }
  }
  throw new Error("device test B has no result");
}

function send(token: string, payload: unknown = measurement(), headers = {}) {
  return request("/v1/measurements", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

it("issues independent random accounts and stores only SHA-256 token hashes", async () => {
  const a = await account();
  const b = await account();
  expect(a.id).not.toBe(b.id);
  expect(a.token).toMatch(/^[0-9a-f]{64}$/);
  expect(a.token).not.toBe(b.token);
  const row = await env.DB.prepare("SELECT * FROM accounts WHERE id = ?")
    .bind(a.id)
    .first();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(a.token),
  );
  const expected = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  expect(row).toEqual({
    id: a.id,
    token_hash: expected,
    created_at: expect.any(String),
  });
  expect(JSON.stringify(row)).not.toContain(a.token);
});

it("archives a real core measurement and all original JSON alongside searchable columns", async () => {
  const a = await account();
  const m = { ...measurement(), extra: { preserved: true } };
  const response = await send(a.token, m);
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ id: m.id, duplicate: false });
  const row = await env.DB.prepare("SELECT * FROM measurements WHERE id = ?")
    .bind(m.id)
    .first();
  expect(row).toMatchObject({
    account_id: a.id,
    measured_at: m.measuredAt,
    bmi: 21.1,
    fat_mass_kg: 10.9,
    visceral: 67.3,
    muscle_kg: 16,
    score: 16,
    category: "Aman",
    body_version: "wla43@1",
    score_version: "diascale@2",
    received_at: expect.any(String),
  });
  expect(JSON.parse(row!.payload as string)).toEqual(m);
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("keeps the first snapshot unchanged on retries, even if the repeated payload differs", async () => {
  const a = await account();
  const m = measurement();
  expect((await send(a.token, m)).status).toBe(201);
  const retry = await send(a.token, {
    ...m,
    profile: { ...m.profile, name: "Changed" },
  });
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({ id: m.id, duplicate: true });
  const row = await env.DB.prepare(
    "SELECT payload FROM measurements WHERE id = ?",
  )
    .bind(m.id)
    .first<{ payload: string }>();
  expect(JSON.parse(row!.payload)).toEqual(m);
});

it("inserts exactly one record when requests for the same id race", async () => {
  const a = await account();
  const m = measurement();
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => send(a.token, m)),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([
    200, 200, 200, 200, 201,
  ]);
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS n FROM measurements").first("n"),
  ).toBe(1);
});

it("rejects another account's id collision without revealing or replacing its record", async () => {
  const a = await account();
  const b = await account();
  const m = measurement();
  await send(a.token, m);
  const response = await send(b.token, m);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "measurement id conflict" });
  expect(
    await env.DB.prepare("SELECT account_id FROM measurements WHERE id = ?")
      .bind(m.id)
      .first("account_id"),
  ).toBe(a.id);
});

it("authenticates before parsing measurement data", async () => {
  for (const authorization of [
    undefined,
    "Basic abc",
    `Bearer ${"a".repeat(64)}`,
  ]) {
    const response = await request("/v1/measurements", {
      method: "POST",
      headers: authorization ? { Authorization: authorization } : {},
      body: "invalid JSON",
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  }
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS n FROM measurements").first("n"),
  ).toBe(0);
});

it.each([
  ["null", () => null],
  ["missing profile", (m: Measurement) => ({ ...m, profile: undefined })],
  [
    "impossible date",
    (m: Measurement) => ({ ...m, measuredAt: "2026-02-30T00:00:00Z" }),
  ],
  ["minor", (m: Measurement) => ({ ...m, inputs: { ...m.inputs, age: 17 } })],
  [
    "missing impedance",
    (m: Measurement) => ({ ...m, inputs: { ...m.inputs, impedances: [1, 2] } }),
  ],
  [
    "zero impedance",
    (m: Measurement) => ({
      ...m,
      inputs: { ...m.inputs, impedances: Array(10).fill(0) },
    }),
  ],
  [
    "profile mismatch",
    (m: Measurement) => ({ ...m, profile: { ...m.profile, sex: "female" } }),
  ],
  [
    "invalid score category",
    (m: Measurement) => ({ ...m, score: { ...m.score, category: "Safe" } }),
  ],
  [
    "body failure",
    (m: Measurement) => ({
      ...m,
      comparison: { ...m.comparison, body: { error: 1 } },
    }),
  ],
  [
    "invalid packets",
    (m: Measurement) => ({ ...m, packets: [{ dir: "in", hex: "ZZ" }] }),
  ],
  ["empty id", (m: Measurement) => ({ ...m, id: " " })],
  ["non-finite number", (m: Measurement) => ({ ...m, fatPercent: Infinity })],
] as const)("rejects malformed measurements: %s", async (_label, invalid) => {
  const a = await account();
  expect((await send(a.token, invalid(measurement()))).status).toBe(422);
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS n FROM measurements").first("n"),
  ).toBe(0);
});

it("distinguishes JSON syntax errors and unsupported content types", async () => {
  const a = await account();
  const response = await request("/v1/measurements", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${a.token}`,
      "Content-Type": "application/json",
    },
    body: "{",
  });
  expect(response.status).toBe(400);
  expect(
    (await send(a.token, measurement(), { "Content-Type": "text/plain" }))
      .status,
  ).toBe(415);
});

it("limits actual body bytes even when Content-Length is missing", async () => {
  const a = await account();
  expect(
    (await send(a.token, { ...measurement(), extra: "a".repeat(256 * 1024) }))
      .status,
  ).toBe(413);
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS n FROM measurements").first("n"),
  ).toBe(0);
});

it("allows Capacitor CORS preflight and includes CORS on authentication errors", async () => {
  const origin = "capacitor://localhost";
  const preflight = await request("/v1/measurements", {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
  expect(preflight.headers.get("access-control-allow-headers")).toContain(
    "Authorization",
  );
  const denied = await request("/v1/measurements", {
    method: "POST",
    headers: { Origin: origin },
  });
  expect(denied.status).toBe(401);
  expect(denied.headers.get("access-control-allow-origin")).toBe(origin);
  const forbidden = await request("/v1/accounts", {
    method: "POST",
    headers: { Origin: "https://untrusted.test" },
  });
  expect(forbidden.status).toBe(403);
  expect(forbidden.headers.has("access-control-allow-origin")).toBe(false);
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first("n"),
  ).toBe(0);
});

it("exposes no history read endpoint", async () => {
  expect((await request("/v1/measurements")).status).toBe(405);
  expect((await request("/v1/accounts")).status).toBe(405);
  expect((await request("/v1/unknown")).status).toBe(404);
});
