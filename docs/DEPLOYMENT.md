# Deployment

BidLadder deploys as one Cloudflare Worker with one D1 database.

## Prerequisites

- Node.js 22.22 or newer
- pnpm 11.22
- A Cloudflare account with Workers and D1 access
- Wrangler authenticated with the target Cloudflare account

```bash
corepack enable
pnpm install
pnpm exec wrangler login
```

## First deployment

Run:

```bash
pnpm deploy:setup
```

The script performs these steps:

1. verifies the active Cloudflare identity;
2. creates or reuses a D1 database named `bidladder`;
3. writes its database ID to `wrangler.jsonc` when needed;
4. builds the production application;
5. applies D1 migrations to the remote database;
6. generates an admin key and uploads only its SHA-256 hash; and
7. deploys the Worker.

The raw admin key is printed once after a successful deployment. Store it in a password manager. BidLadder cannot recover it from the stored hash.

The default D1 location hint is Asia Pacific. Choose another supported location for a new database with an environment variable:

```bash
BIDLADDER_D1_LOCATION=weur pnpm deploy:setup
```

Supported hints are `weur`, `eeur`, `apac`, `oc`, `wnam`, and `enam`. A location hint is only used when creating the database.

## Subsequent deployments

Review and apply new database migrations before deploying application code that depends on them:

```bash
pnpm quality
pnpm db:migrate:remote
pnpm deploy
```

`pnpm deploy:setup` is also safe to rerun, but it rotates the admin key unless `BIDLADDER_ADMIN_KEY` is supplied. Routine application deployments should use `pnpm deploy`.

## Admin-key rotation

Generate a new raw key and hash:

```bash
node scripts/generate-admin-key.mjs
```

Copy the generated hash—not the raw key—into the Wrangler prompt:

```bash
pnpm exec wrangler secret put ADMIN_API_KEY_HASH
```

After the command succeeds, existing admin sessions must use the new raw key. Store it securely and discard the previous key.

For automated setup, provide a secret manager value without putting it in shell history:

```bash
BIDLADDER_ADMIN_KEY="$(your-secret-manager read bidladder-admin-key)" pnpm deploy:setup
```

The supplied raw key must contain at least 32 characters.

## Manual provisioning

If you prefer to inspect each remote action:

```bash
pnpm exec wrangler d1 create bidladder --location apac --update-config --binding DB
pnpm db:migrate:remote
node scripts/generate-admin-key.mjs
pnpm exec wrangler secret put ADMIN_API_KEY_HASH
pnpm deploy
```

## Local development

Create `.dev.vars` from the provided example and set the generated hash:

```bash
cp .dev.vars.example .dev.vars
node scripts/generate-admin-key.mjs
pnpm db:migrate:local
pnpm dev
```

`.dev.vars`, `.wrangler/`, and local database files are ignored by Git. Never commit a raw key, its production hash, Cloudflare credentials, or a production database export.

## Rollback notes

Worker code can be rolled back through Cloudflare's deployment history. D1 migrations are forward-only in this project: do not assume a code rollback reverses schema changes. For destructive or compatibility-sensitive migrations, design an explicit expand/migrate/contract sequence and take an appropriate backup before applying the migration.
