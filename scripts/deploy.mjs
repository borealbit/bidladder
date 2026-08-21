import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const projectRoot = process.cwd();
const configPath = path.join(projectRoot, "wrangler.jsonc");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const databaseName = "bidladder";
const allowedLocations = new Set(["weur", "eeur", "apac", "oc", "wnam", "enam"]);
const location = process.env.BIDLADDER_D1_LOCATION ?? "apac";

if (!allowedLocations.has(location)) {
  throw new Error(`Unsupported BIDLADDER_D1_LOCATION: ${location}`);
}

function run(args, options = {}) {
  const result = spawnSync(pnpm, args, {
    cwd: projectRoot,
    encoding: "utf8",
    input: options.input,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout}` : "";
    throw new Error(`Command failed: pnpm ${args.join(" ")}${detail}`);
  }
  return result.stdout ?? "";
}

function parseJsonArray(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start === -1 || end === -1) {
    throw new Error("Wrangler did not return the expected D1 database list.");
  }
  return JSON.parse(output.slice(start, end + 1));
}

async function ensureDatabaseBinding() {
  let config = await readFile(configPath, "utf8");
  if (/"database_id"\s*:/.test(config)) {
    return;
  }

  const databases = parseJsonArray(
    run(["exec", "wrangler", "d1", "list", "--json"], { capture: true }),
  );
  const existing = databases.find((database) => database.name === databaseName);

  if (!existing) {
    run([
      "exec",
      "wrangler",
      "d1",
      "create",
      databaseName,
      "--location",
      location,
      "--update-config",
      "--binding",
      "DB",
    ]);
    return;
  }

  const databaseId = existing.uuid ?? existing.database_id;
  if (typeof databaseId !== "string" || databaseId.length === 0) {
    throw new Error("The existing D1 database did not include a usable ID.");
  }

  const databaseNamePattern = /("database_name"\s*:\s*"bidladder"\s*,?)/;
  if (!databaseNamePattern.test(config)) {
    throw new Error("Could not find the bidladder D1 binding in wrangler.jsonc.");
  }

  config = config.replace(databaseNamePattern, (match) => {
    const normalized = match.trimEnd().endsWith(",") ? match : `${match},`;
    return `${normalized}\n      "database_id": "${databaseId}",`;
  });
  await writeFile(configPath, config, "utf8");
  console.log(`Reused D1 database ${databaseName} (${databaseId}).`);
}

function createAdminCredentials() {
  const rawKey = process.env.BIDLADDER_ADMIN_KEY ?? randomBytes(32).toString("base64url");
  if (rawKey.length < 32) {
    throw new Error("BIDLADDER_ADMIN_KEY must contain at least 32 characters.");
  }
  return {
    hash: createHash("sha256").update(rawKey, "utf8").digest("hex"),
    rawKey,
  };
}

function requireStripeSecret(name, pattern) {
  const value = process.env[name];
  if (!value || !pattern.test(value) || value.includes("\n") || value.includes("\r")) {
    throw new Error(
      `${name} is required and must be a valid Stripe secret. See docs/DEPLOYMENT.md.`,
    );
  }
  return value;
}

const stripeApiKey = requireStripeSecret("STRIPE_API_KEY", /^(rk|sk)_(test|live)_/);
const stripeWebhookSecret = requireStripeSecret("STRIPE_WEBHOOK_SECRET", /^whsec_/);

console.log("Checking the active Cloudflare account...");
run(["exec", "wrangler", "whoami"]);
await ensureDatabaseBinding();

console.log("Building BidLadder...");
run(["build"]);

console.log("Applying remote D1 migrations...");
run(["db:migrate:remote"]);

const credentials = createAdminCredentials();
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "bidladder-deploy-"));
const secretsPath = path.join(temporaryDirectory, ".env");

try {
  await writeFile(
    secretsPath,
    [
      `ADMIN_API_KEY_HASH=${credentials.hash}`,
      `STRIPE_API_KEY=${stripeApiKey}`,
      `STRIPE_WEBHOOK_SECRET=${stripeWebhookSecret}`,
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );
  console.log("Deploying the Worker and required secrets...");
  run(["exec", "wrangler", "deploy", "--secrets-file", secretsPath]);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}

console.log("\nBidLadder deployed successfully.");
console.log("Save this raw admin key now; it cannot be recovered from Cloudflare:\n");
console.log(credentials.rawKey);
