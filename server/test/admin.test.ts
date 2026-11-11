import { env, exports } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { buildMeasurement, fromHex, ScaleSession } from "@diascale/core";
import captures from "../../packages/core/test/fixtures/captures.json";

const KEY = env.ADMIN_KEY!;
const ADMIN = `/admin/${KEY}`;

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM measurements"),
    env.DB.prepare("DELETE FROM accounts"),
  ]);
});

function request(path: string, init?: RequestInit) {
  return exports.default.fetch(`https://archive.test${path}`, init);
}

function measurement(name: string, phone: string, measuredAt: string) {
  const session = new ScaleSession({
    heightCm: 147,
    lastWeightKg: 45.7,
    male: true,
    age: 19,
    userId: 0x0da5ca1e,
  });
  for (const packet of captures["device-test-b-handshake"]) {
    if (packet.dir !== "in") continue;
    for (const event of session.receive(fromHex(packet.hex)).events)
      if (event.type === "result")
        return buildMeasurement({
          measuredAt,
          profile: {
            name,
            phone,
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
  throw new Error("device test B has no result");
}

async function seed() {
  const accounts = [];
  for (const [name, phone, days] of [
    ["Ani", "081111", ["2026-11-01", "2026-11-03"]],
    ["=Budi", "082222", ["2026-11-02"]],
  ] as const) {
    const acc = (await (
      await request("/v1/accounts", { method: "POST" })
    ).json()) as { id: string; token: string };
    const ids = [];
    for (const day of days) {
      const m = measurement(name, phone, `${day}T03:00:00.000Z`);
      const res = await request("/v1/measurements", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${acc.token}`,
        },
        body: JSON.stringify(m),
      });
      expect(res.status).toBe(201);
      ids.push(m.id);
    }
    accounts.push({ ...acc, ids });
  }
  return accounts;
}

it("hides the whole admin tree behind the key", async () => {
  for (const path of [
    "/admin",
    "/admin/",
    "/admin/wrong-key-0123456789abcdefghijklmnop",
    `/admin/${KEY.slice(0, -1)}`,
    `/admin/${KEY}x/api/measurements`,
    `/admin/wrong/api/measurements`,
  ]) {
    const res = await request(path);
    expect(res.status, path).toBe(404);
  }
});

it("serves the panel page with no-store, no-referrer and noindex headers", async () => {
  const res = await request(ADMIN);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/^text\/html/);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  expect(res.headers.get("x-robots-tag")).toMatch(/noindex/);
  expect(res.headers.get("content-security-policy")).toMatch(
    /frame-ancestors 'none'/,
  );
  expect(await res.text()).toContain("DiaScale Admin");
});

it("lists and filters archived results", async () => {
  await seed();
  const all = (await (
    await request(`${ADMIN}/api/measurements`)
  ).json()) as any;
  expect(all.total).toBe(3);
  expect(all.rows.map((r: any) => r.measured_at.slice(0, 10))).toEqual([
    "2026-11-03",
    "2026-11-02",
    "2026-11-01",
  ]);
  expect(all.rows[0]).toMatchObject({ name: "Ani", phone: "081111", bmi: 21.1 });

  const byPhone = (await (
    await request(`${ADMIN}/api/measurements?q=0822`)
  ).json()) as any;
  expect(byPhone.rows.map((r: any) => r.name)).toEqual(["=Budi"]);

  const byDate = (await (
    await request(`${ADMIN}/api/measurements?from=2026-11-02&to=2026-11-02`)
  ).json()) as any;
  expect(byDate.total).toBe(1);

  const none = (await (
    await request(`${ADMIN}/api/measurements?category=Waspada`)
  ).json()) as any;
  expect(none.total).toBe(0);
  expect(none.rows).toEqual([]);
});

it("returns one full payload", async () => {
  const [ani] = await seed();
  const res = await request(`${ADMIN}/api/measurements/${ani.ids[0]}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.accountId).toBe(ani.id);
  expect(body.payload.profile.name).toBe("Ani");
  expect(body.payload.packets.length).toBeGreaterThan(0);
  expect((await request(`${ADMIN}/api/measurements/missing`)).status).toBe(404);
});

it("exports CSV with formula-looking text neutralised", async () => {
  await seed();
  const res = await request(`${ADMIN}/api/measurements.csv?q=Budi`);
  expect(res.headers.get("content-type")).toMatch(/^text\/csv/);
  expect(res.headers.get("content-disposition")).toMatch(/attachment/);
  const lines = (await res.text()).replace(/^﻿/, "").trim().split("\r\n");
  expect(lines).toHaveLength(2);
  expect(lines[0].split(",")).toContain("phone");
  expect(lines[1]).toContain(",'=Budi,082222,");
});

it("deletes one result", async () => {
  const [ani] = await seed();
  const del = await request(`${ADMIN}/api/measurements/${ani.ids[0]}`, {
    method: "DELETE",
  });
  expect(del.status).toBe(200);
  expect(
    (await request(`${ADMIN}/api/measurements/${ani.ids[0]}`, { method: "DELETE" }))
      .status,
  ).toBe(404);
});

it("deletes one person's results from a shared install, keeping others and the account", async () => {
  // One phone install = one account holding several local profiles.
  const acc = (await (
    await request("/v1/accounts", { method: "POST" })
  ).json()) as { id: string; token: string };
  const post = (name: string, phone: string, at: string) =>
    request("/v1/measurements", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${acc.token}`,
      },
      body: JSON.stringify(measurement(name, phone, at)),
    });
  await post("Ani", "081111", "2026-11-01T03:00:00.000Z");
  await post("Ani", "081111", "2026-11-02T03:00:00.000Z");
  await post("Budi", "082222", "2026-11-03T03:00:00.000Z");
  const [other] = await seed(); // another install with the same phone number

  const gone = await request(`${ADMIN}/api/accounts/${acc.id}/phones/081111`, {
    method: "DELETE",
  });
  expect(await gone.json()).toEqual({ deleted: { measurements: 2 } });
  const remaining = async (account: string) =>
    (
      await env.DB.prepare(
        "SELECT json_extract(payload, '$.profile.phone') AS phone FROM measurements WHERE account_id = ? ORDER BY phone",
      )
        .bind(account)
        .all<{ phone: string }>()
    ).results.map((r) => r.phone);
  expect(await remaining(acc.id)).toEqual(["082222"]);
  expect(await remaining(other.id)).toEqual(["081111", "081111"]);
  expect(
    (await request(`${ADMIN}/api/accounts/${acc.id}/phones/081111`, { method: "DELETE" }))
      .status,
  ).toBe(404);
  // The install keeps its account and can still upload.
  expect((await post("Ani", "081111", "2026-11-04T03:00:00.000Z")).status).toBe(201);
  // Deleting a whole account is no longer offered.
  expect(
    (await request(`${ADMIN}/api/accounts/${acc.id}`, { method: "DELETE" })).status,
  ).toBe(404);
});

it("refuses cross-site API requests but allows the panel's own origin", async () => {
  const [ani] = await seed();
  const evil = await request(`${ADMIN}/api/measurements/${ani.ids[0]}`, {
    method: "DELETE",
    headers: { Origin: "https://evil.example" },
  });
  expect(evil.status).toBe(403);
  expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  const own = await request(`${ADMIN}/api/measurements/${ani.ids[0]}`, {
    method: "DELETE",
    headers: { Origin: "https://archive.test" },
  });
  expect(own.status).toBe(200);
});
