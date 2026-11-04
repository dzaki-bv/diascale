# DiaScale archive

Cloudflare Worker + D1 for Phase 4 of `docs/scale-integration-plan.md`. Local implementation is complete; no remote database or deployment has been created. Phase 5 is implemented: set the app build-time `VITE_ARCHIVE_URL` to enable account creation and queued delivery. It is empty by default, so the default app remains local-only.

## Local development

From the repository root:

```sh
npm install
npm run db:migrate -w server
npm run dev -w server
```

Wrangler serves the API at `http://localhost:8787`. Local SQLite state is in the ignored `server/.wrangler/` directory.

```sh
npm test -w server
npm run check -w server
npm run build -w server
```

Tests run the actual Worker handler and D1 migrations in the Workers runtime using the [Cloudflare Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/). They use a measurement built by `@diascale/core` from captured device test B. `build` only bundles a dry run; it does not deploy.

## API

All responses use JSON (except preflight), `Cache-Control: no-store`, and CORS for origins listed in `ALLOWED_ORIGINS` in `wrangler.jsonc`. Capacitor's Android and iOS localhost origins and Vite's local port 4173 are included. Requests without an Origin header also work. Authentication is required independently of CORS.

`POST /v1/accounts`, with no body, returns HTTP 201:

```json
{ "id": "random-account-uuid", "token": "64-lowercase-hex-characters" }
```

The token contains 32 cryptographically random bytes. Only its SHA-256 hash is stored. The app must store the returned credentials locally; the API provides no token recovery, login or history retrieval. Each request creates a new account, so the app should reuse credentials after receiving them.

`POST /v1/measurements` requires `Authorization: Bearer <token>` and `Content-Type: application/json`. The body is the complete `Measurement` exported by `@diascale/core`, with at most 256 KiB of UTF-8 JSON. Validation requires the profile, adult raw inputs, ten positive impedances, four numbers, score, comparison values, nonempty hex packets and version strings. Profile sex and height must agree with raw inputs. The server validates structure and numeric bounds; it does not recompute body composition or score, verify BLE packet provenance, or establish clinical accuracy. The original payload is archived, including additional fields and the original algorithm versions.

| Status | Meaning                                                                     | Sync action                                 |
| ------ | --------------------------------------------------------------------------- | ------------------------------------------- |
| 201    | Stored: `{ "id": "client-id", "duplicate": false }`                         | Remove from queue                           |
| 200    | Already stored for this account: `{ "id": "client-id", "duplicate": true }` | Remove from queue                           |
| 400    | Invalid JSON or UTF-8                                                       | Fix payload                                 |
| 401    | Missing or invalid token                                                    | Check locally stored credentials            |
| 403    | Origin outside configured allowlist                                         | Check app origin/configuration              |
| 409    | ID already belongs to another account                                       | Keep as a conflict; do not treat as success |
| 413    | Body exceeds byte limit                                                     | Fix payload                                 |
| 415    | Wrong content type                                                          | Send JSON                                   |
| 422    | Invalid measurement structure or bounds                                     | Fix payload                                 |
| 500    | Internal failure                                                            | Retry later with the same client ID         |

The first successful insert is immutable. Retrying a client ID for the same account succeeds without overwriting its original snapshot, even if the new body differs. Concurrent inserts use `ON CONFLICT(id) DO NOTHING`; another account receives only a generic conflict. Indexed columns retain the four numbers, score, category, algorithm versions and timestamps alongside the full JSON.

## Manual deployment

Run these steps only when ready to deploy to the Dzakihamalafirdaus account:

1. Run `npx wrangler login`, then `npx wrangler whoami` from `server/` and verify the intended account. Set its `account_id` in `wrangler.jsonc` if the login can access multiple accounts.
2. Run `npx wrangler d1 create diascale-archive` from `server/` and replace the zero placeholder `database_id` in `wrangler.jsonc` with the returned ID.
3. Review `ALLOWED_ORIGINS` for the installed app. Run `npx wrangler d1 migrations apply DB --remote` from `server/`.
4. From the repository root, run `npm run deploy -w server`. Save the Worker HTTPS URL for the app's Phase 5 configuration.

Remote migration and deployment have not been tested. The app store and sync engine are covered against this Worker and local D1, including offline restart and a response lost after commit; exactly one row remains after retry. A separate HTTP smoke test also passed against `wrangler dev`. Delivery from physical Android/iPhone to a deployed archive remains Phase 6 acceptance work.
