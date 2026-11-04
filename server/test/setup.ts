import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import type { Env as ServerEnv } from "../src/index.ts";

declare global {
  namespace Cloudflare {
    interface Env extends ServerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
    interface GlobalProps {
      mainModule: typeof import("../src/index.ts");
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
