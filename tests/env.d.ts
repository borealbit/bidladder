import type { D1Migration } from "@cloudflare/vitest-plugin";

declare global {
  interface Env {
    TEST_MIGRATIONS: D1Migration[];
  }

  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
