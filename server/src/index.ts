import { measurementSchema } from "./measurement.ts";

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
}

const MAX_BODY_BYTES = 256 * 1024;
const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

async function hash(token: string): Promise<string> {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(token)),
    ),
  );
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(request: Request): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new HttpError(415, "expected application/json");
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES)
    throw new HttpError(413, "payload too large");
  // Count actual bytes too: Content-Length may be absent (chunked requests).
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "invalid JSON");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, "payload too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

async function route(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path !== "/v1/accounts" && path !== "/v1/measurements")
    throw new HttpError(404, "not found");
  if (request.method !== "POST")
    return Response.json(
      { error: "method not allowed" },
      { status: 405, headers: { Allow: "POST, OPTIONS" } },
    );

  if (path === "/v1/accounts") {
    const id = crypto.randomUUID();
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.prepare(
      "INSERT INTO accounts (id, token_hash, created_at) VALUES (?, ?, ?)",
    )
      .bind(id, await hash(token), new Date().toISOString())
      .run();
    return Response.json({ id, token }, { status: 201 });
  }

  const token = /^Bearer ([0-9a-f]{64})$/i.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  const account =
    token &&
    (await env.DB.prepare("SELECT id FROM accounts WHERE token_hash = ?")
      .bind(await hash(token))
      .first<{ id: string }>());
  if (!account)
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );

  const payload = await readJson(request);
  const parsed = measurementSchema.safeParse(payload);
  if (!parsed.success) throw new HttpError(422, "invalid measurement");
  const m = parsed.data;
  // A single atomic insert prevents duplicate rows even when retries race.
  const inserted = await env.DB.prepare(
    `
    INSERT INTO measurements
      (id, account_id, measured_at, bmi, fat_mass_kg, visceral, muscle_kg,
       score, category, body_version, score_version, payload, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING RETURNING id
  `,
  )
    .bind(
      m.id,
      account.id,
      m.measuredAt,
      m.numbers.bmi,
      m.numbers.fatMassKg,
      m.numbers.visceral,
      m.numbers.muscleKg,
      m.score.total,
      m.score.category,
      m.versions.body,
      m.versions.score,
      JSON.stringify(payload),
      new Date().toISOString(),
    )
    .first<{ id: string }>();
  if (inserted)
    return Response.json({ id: m.id, duplicate: false }, { status: 201 });
  const existing = await env.DB.prepare(
    "SELECT account_id FROM measurements WHERE id = ?",
  )
    .bind(m.id)
    .first<{ account_id: string }>();
  if (existing?.account_id !== account.id)
    throw new HttpError(409, "measurement id conflict");
  return Response.json({ id: m.id, duplicate: true });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin");
    const allowed =
      origin !== null && env.ALLOWED_ORIGINS.split(",").includes(origin);
    let response: Response;
    try {
      if (origin && !allowed) throw new HttpError(403, "origin not allowed");
      if (request.method === "OPTIONS") {
        const path = new URL(request.url).pathname;
        if (path !== "/v1/accounts" && path !== "/v1/measurements")
          throw new HttpError(404, "not found");
        response = new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
            "Access-Control-Max-Age": "86400",
          },
        });
      } else response = await route(request, env);
    } catch (error) {
      // Never include tokens, health records or database errors in responses/logs.
      response =
        error instanceof HttpError
          ? Response.json({ error: error.message }, { status: error.status })
          : Response.json({ error: "internal server error" }, { status: 500 });
    }
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Vary", "Origin");
    if (allowed) response.headers.set("Access-Control-Allow-Origin", origin);
    return response;
  },
} satisfies ExportedHandler<Env>;
