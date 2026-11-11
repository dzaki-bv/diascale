import page from "./admin.html";

// The admin panel has no login: knowing ADMIN_KEY (a long random path segment) is the
// only credential. Without a sufficiently long key the whole /admin tree is a 404.
export interface AdminEnv {
  DB: D1Database;
  ADMIN_KEY?: string;
}

const KEY_PATTERN = /^[A-Za-z0-9_-]{32,}$/;
const PAGE_SIZE = 50;
const CATEGORIES = ["Aman", "Meningkat", "Waspada"];
const encoder = new TextEncoder();

const notFound = () => Response.json({ error: "not found" }, { status: 404 });
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};

async function sameKey(given: string, expected: string): Promise<boolean> {
  // Compare digests so timing reveals neither the key nor its length.
  const digest = (value: string) =>
    crypto.subtle.digest("SHA-256", encoder.encode(value));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

interface Filters {
  q: string | null;
  account: string | null;
  category: string | null;
  from: string | null;
  to: string | null;
}

function filters(params: URLSearchParams): Filters {
  const value = (name: string) => params.get(name)?.trim() || null;
  const day = (name: string) => {
    const v = value(name);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  };
  const category = value("category");
  return {
    q: value("q"),
    account: value("account"),
    category: category && CATEGORIES.includes(category) ? category : null,
    from: day("from"),
    to: day("to"),
  };
}

// Dates compare against the UTC calendar day of measured_at (the app sends ISO UTC).
const WHERE = `
  WHERE (?1 IS NULL OR account_id = ?1)
    AND (?2 IS NULL OR category = ?2)
    AND (?3 IS NULL OR substr(measured_at, 1, 10) >= ?3)
    AND (?4 IS NULL OR substr(measured_at, 1, 10) <= ?4)
    AND (?5 IS NULL
      OR json_extract(payload, '$.profile.name') LIKE '%' || ?5 || '%'
      OR json_extract(payload, '$.profile.phone') LIKE '%' || ?5 || '%')`;
const bindFilters = (f: Filters) => [f.account, f.category, f.from, f.to, f.q];

const COLUMNS = `
  id, account_id, measured_at, received_at, bmi, fat_mass_kg, visceral,
  muscle_kg, score, category, body_version, score_version,
  json_extract(payload, '$.profile.name') AS name,
  json_extract(payload, '$.profile.phone') AS phone,
  json_extract(payload, '$.profile.sex') AS sex,
  json_extract(payload, '$.profile.birthDate') AS birth_date,
  json_extract(payload, '$.profile.heightCm') AS height_cm,
  json_extract(payload, '$.inputs.weightKg') AS weight_kg,
  json_extract(payload, '$.fatPercent') AS fat_percent,
  json_extract(payload, '$.waistCm') AS waist_cm`;

async function list(db: D1Database, params: URLSearchParams) {
  const f = filters(params);
  const offset = Math.max(0, Math.trunc(Number(params.get("offset")) || 0));
  const [rows, count] = await db.batch([
    db
      .prepare(
        `SELECT ${COLUMNS} FROM measurements ${WHERE}
         ORDER BY measured_at DESC, id LIMIT ?6 OFFSET ?7`,
      )
      .bind(...bindFilters(f), PAGE_SIZE, offset),
    db
      .prepare(`SELECT COUNT(*) AS n FROM measurements ${WHERE}`)
      .bind(...bindFilters(f)),
  ]);
  return Response.json(
    {
      rows: rows.results,
      total: (count.results[0] as { n: number }).n,
      offset,
      pageSize: PAGE_SIZE,
    },
    { headers },
  );
}

const CSV_FIELDS = [
  "id",
  "account_id",
  "measured_at",
  "received_at",
  "name",
  "phone",
  "sex",
  "birth_date",
  "height_cm",
  "weight_kg",
  "bmi",
  "fat_mass_kg",
  "visceral",
  "muscle_kg",
  "fat_percent",
  "waist_cm",
  "score",
  "category",
  "body_version",
  "score_version",
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Neutralise spreadsheet formulas in user-entered text.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function exportCsv(db: D1Database, params: URLSearchParams) {
  const f = filters(params);
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM measurements ${WHERE} ORDER BY measured_at DESC, id`,
    )
    .bind(...bindFilters(f))
    .all<Record<string, unknown>>();
  const lines = [CSV_FIELDS.join(",")];
  for (const row of results)
    lines.push(CSV_FIELDS.map((k) => csvCell(row[k])).join(","));
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      ...headers,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="diascale-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

async function api(request: Request, db: D1Database, rest: string[], url: URL) {
  const [kind, id, extra] = rest;
  const method = request.method;
  if (kind === "measurements.csv" && rest.length === 1 && method === "GET")
    return exportCsv(db, url.searchParams);
  if (kind === "measurements" && rest.length === 1 && method === "GET")
    return list(db, url.searchParams);
  if (kind === "measurements" && id && extra === undefined) {
    if (method === "GET") {
      const row = await db
        .prepare(
          "SELECT id, account_id, received_at, payload FROM measurements WHERE id = ?",
        )
        .bind(id)
        .first<{ id: string; account_id: string; received_at: string; payload: string }>();
      if (!row) return notFound();
      return Response.json(
        {
          id: row.id,
          accountId: row.account_id,
          receivedAt: row.received_at,
          payload: JSON.parse(row.payload),
        },
        { headers },
      );
    }
    if (method === "DELETE") {
      const result = await db
        .prepare("DELETE FROM measurements WHERE id = ?")
        .bind(id)
        .run();
      if (!result.meta.changes) return notFound();
      return Response.json({ deleted: { measurements: 1 } }, { headers });
    }
  }
  const phone = rest[3];
  if (
    kind === "accounts" &&
    id &&
    extra === "phones" &&
    phone &&
    rest.length === 4 &&
    method === "DELETE"
  ) {
    // One account is one app install holding several local profiles keyed by phone;
    // delete only this person's results and keep the account so the app can still sync.
    const result = await db
      .prepare(
        "DELETE FROM measurements WHERE account_id = ? AND json_extract(payload, '$.profile.phone') = ?",
      )
      .bind(id, phone)
      .run();
    if (!result.meta.changes) return notFound();
    return Response.json(
      { deleted: { measurements: result.meta.changes } },
      { headers },
    );
  }
  return notFound();
}

/** Handles everything under /admin. Returns 404 unless the path starts with the key. */
export async function handleAdmin(
  request: Request,
  env: AdminEnv,
  url: URL,
): Promise<Response> {
  const [, , key, section, ...rest] = url.pathname.split("/");
  const expected = env.ADMIN_KEY ?? "";
  if (!KEY_PATTERN.test(expected) || !key || !(await sameKey(key, expected)))
    return notFound();
  // Only the panel itself may call the API; refuse cross-site requests outright.
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== url.origin)
    return Response.json({ error: "origin not allowed" }, { status: 403 });

  if (section === undefined) {
    if (request.method !== "GET") return notFound();
    return new Response(page, {
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    });
  }
  if (section !== "api") return notFound();
  try {
    return await api(request, env.DB, rest, url);
  } catch {
    return Response.json({ error: "internal server error" }, { status: 500 });
  }
}
