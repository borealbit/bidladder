# Deployment

BidLadder deploys as one Cloudflare Worker with one D1 database.

## Prerequisites

- Node.js 22.22 or newer
- pnpm 11.22
- A Cloudflare account with Workers and D1 access
- Wrangler authenticated with the target Cloudflare account
- A Stripe account and Stripe CLI for local webhook testing

```bash
corepack enable
pnpm install
pnpm exec wrangler login
```

## Stripe configuration

BidLadder uses Stripe-hosted Checkout for one-time payments. Create a restricted Stripe key for this installation. Grant only the resources used by the Worker:

- Checkout Sessions: write (creation and retrieval)
- Payment Intents: read
- Charges: read

Stripe's restricted-key interface can change, so verify the effective permissions with a test-mode checkout before using a live key. Keep test and live keys in separate deployments; never commit either one.

Create a Stripe webhook endpoint at your planned public URL:

```text
https://your-bidladder.example/api/v1/webhooks/stripe
```

Subscribe only to:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
charge.refunded
```

Copy its `whsec_...` signing secret. Webhook signing secrets are endpoint-specific and differ between test and live mode. The return page is not proof of payment; BidLadder publishes payment state only after a signed webhook or admin reconciliation.

Automatic tax is not enabled. Enable or extend tax behavior only after completing the registrations and product/tax-code configuration required for your business.

## First deployment

Run:

```bash
export STRIPE_API_KEY='rk_live_...'
export STRIPE_WEBHOOK_SECRET='whsec_...'
pnpm deploy:setup
```

Prefer loading these environment variables from a password manager or CI secret store instead of typing real values into shell history.

The script performs these steps:

1. verifies the active Cloudflare identity;
2. creates or reuses a D1 database named `bidladder`;
3. writes its database ID to `wrangler.jsonc` when needed;
4. builds the production application;
5. applies D1 migrations to the remote database;
6. generates an admin key;
7. uploads its SHA-256 hash plus the Stripe API and webhook secrets; and
8. deploys the Worker.

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

## Rules and operating timelines

The default ladder promises review within 3 business days and refund initiation within 5 business days after a pre-publication rejection. These values are stored in `ladders.review_window_business_days` and `ladders.refund_initiation_business_days` and are rendered directly on `/rules`.

If your operator capacity needs different timelines, change both values through a reviewed migration before accepting live payments. The Rules page also distinguishes refund initiation from settlement: Stripe, the card network, and the customer's bank control when returned funds appear. A post-publication policy takedown is not automatically refundable; review it case by case under the published rules, while any full or partial Stripe refund pauses the placement.

If Stripe credentials change, rotate them explicitly before the routine deploy:

```bash
pnpm exec wrangler secret put STRIPE_API_KEY
pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET
```

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
pnpm exec wrangler secret put STRIPE_API_KEY
pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET
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

Use a Stripe restricted **test** key in `.dev.vars`. In another terminal, forward Stripe events to the local port printed by Vite:

```bash
stripe listen --forward-to http://localhost:5173/api/v1/webhooks/stripe
```

Copy the CLI's `whsec_...` value to `.dev.vars` and restart the app. A webhook secret from the Stripe Dashboard will not verify events signed by the Stripe CLI.

`.dev.vars`, `.wrangler/`, and local database files are ignored by Git. Never commit a raw key, its production hash, Cloudflare credentials, or a production database export.

## Production verification

After every deployment, run the state-neutral verifier:

```bash
pnpm verify:deployment -- https://your-bidladder.example
```

It verifies health, security headers, server rendering, D1-backed leaderboard reads, JSON routing, the admin authentication boundary, rejection of unsigned webhooks, robots, and sitemap. It does not create bids, Checkout Sessions, payments, or refunds.

Then complete one Stripe **test-mode** end-to-end check on the exact deployed hostname:

1. submit a unique sponsor and confirm redirection to Stripe-hosted Checkout;
2. pay with a Stripe test card;
3. confirm the return page changes from processing to paid;
4. confirm Stripe reports a successful `checkout.session.completed` delivery;
5. confirm the admin screen shows `paid`, then approve the bid;
6. resend the same event from Stripe and confirm the state does not duplicate or regress;
7. issue a test refund and confirm the public placement disappears and payment becomes refunded; and
8. review Worker logs for `stripe_event_quarantined`, `stripe_event_processing_failed`, or rate-limit failures.

Before accepting live money, repeat the configuration review in live mode: exact hostname, live restricted key, live endpoint signing secret, subscribed events, remote migrations, currency/minimum contribution/increment, review and refund-initiation windows, the public `/rules` takedown policy, tax posture, and operator recovery procedure. A paid rejection requires the operator to initiate a full refund in Stripe within the published window.

## Abuse controls

`wrangler.jsonc` configures separate Cloudflare rate-limit bindings for public writes (12 per minute) and admin requests (60 per minute). Public keys are SHA-256 hashes of sponsor identity and, when Cloudflare supplies it, network identity; raw email/IP values are not sent as limiter keys. Placement click counting reuses the public limiter with a placement-specific hashed key to suppress rapid repeats without blocking the outbound redirect. These counters are local and eventually consistent, so they reduce abuse but are not billing or concurrency locks. D1 uniqueness, idempotency, Stripe event claims, and atomic click increments enforce persisted correctness.

Use distinct `namespace_id` values if you copy multiple environments into the same Cloudflare account. For high-risk public installations, add Cloudflare WAF/Turnstile and alerting appropriate to your traffic profile.

## Rollback notes

Worker code can be rolled back through Cloudflare's deployment history. D1 migrations are forward-only in this project: do not assume a code rollback reverses schema changes. For destructive or compatibility-sensitive migrations, design an explicit expand/migrate/contract sequence and take an appropriate backup before applying the migration.
