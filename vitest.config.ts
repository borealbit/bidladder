import path from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const testAdminKeyHash = "1fe10a54de393db20cdb36c24c907d0eec8be007d32635798a32794096fd5a69";
const testStripeApiKey = "rk_test_bidladder_integration_tests";
const testStripeWebhookSecret = "whsec_bidladder_integration_tests";

export default defineConfig(async () => {
  process.env.ADMIN_API_KEY_HASH = testAdminKeyHash;
  process.env.STRIPE_API_KEY = testStripeApiKey;
  process.env.STRIPE_WEBHOOK_SECRET = testStripeWebhookSecret;
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

  return {
    plugins: [
      cloudflareTest({
        main: "./tests/worker-harness.ts",
        miniflare: {
          bindings: {
            ADMIN_API_KEY_HASH: testAdminKeyHash,
            STRIPE_API_KEY: testStripeApiKey,
            STRIPE_WEBHOOK_SECRET: testStripeWebhookSecret,
            TEST_MIGRATIONS: migrations,
          },
        },
        wrangler: {
          configPath: "./wrangler.jsonc",
        },
      }),
    ],
    test: {
      setupFiles: ["./tests/setup.ts"],
    },
  };
});
