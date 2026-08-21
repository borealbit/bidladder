# BidLadder

> Deploy your own bid-powered sponsored leaderboard.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Code style: Biome](https://img.shields.io/badge/code_style-Biome-60A5FA)](https://biomejs.dev/)

BidLadder is an open-source, self-hosted sponsored leaderboard for Cloudflare Workers. Sponsors contribute to clearly labeled placements; maintainers review each paid submission, and approved products are ordered by their lifetime sponsored total.

**Self-hosted. MIT licensed. One Worker, one D1 database.**

## Features

- Public sponsored leaderboard with transparent lifetime totals and deterministic ordering
- Privacy-friendly outbound click counts with bot filtering and rate-limit protection
- URL-first two-step sponsorship flow with per-rank calls to action
- Canonical App Store, GitHub, and website identities with tracking parameters removed
- Sponsor submission form with idempotent API requests
- Stripe-hosted Checkout with signed, replay-safe webhook fulfillment
- Explicit payment state machine with refund-aware placement pausing
- Key-protected moderation dashboard at `/admin`
- Approval and rejection workflow; unpaid bids cannot be approved
- Public, configurable review and refund-initiation timelines
- Cloudflare binding-based write and admin rate limits
- Server-rendered React Router application and versioned Hono API
- Cloudflare D1 schema and reviewed Drizzle migrations
- Security headers, stable JSON errors, health check, robots file, and sitemap
- One-command first deployment and a state-neutral production verifier

> [!IMPORTANT]
> BidLadder integrates Stripe Checkout for one-time sponsorship payments. Self-hosters remain responsible for configuring Stripe, taxes, refunds, privacy disclosures, sanctions controls, and other obligations that apply to their business and market. Automatic tax collection is not enabled by default.

## Stack

- React 19 and React Router 8
- Cloudflare Workers, Vite Plugin, and D1
- Hono for HTTP and API routing
- Drizzle ORM and Drizzle Kit
- Tailwind CSS 4
- TypeScript, Vitest, and Biome

The entire application runs in one Worker and uses one D1 database per deployment. See [Architecture](docs/ARCHITECTURE.md) for the request and data boundaries.

## Quick start

Requirements:

- Node.js 22.22 or newer
- pnpm 11.22 (Corepack can select the version declared in `package.json`)

```bash
git clone https://github.com/borealbit/bidladder.git
cd bidladder
corepack enable
pnpm install
cp .dev.vars.example .dev.vars
node scripts/generate-admin-key.mjs
```

Copy the generated `ADMIN_API_KEY_HASH` into `.dev.vars`, then add a Stripe restricted test key and a local webhook signing secret. Initialize D1 and start the app:

```bash
pnpm db:migrate:local
pnpm dev
```

In another terminal, forward Stripe test events to the local Worker (replace the port with the one printed by Vite):

```bash
stripe listen --forward-to http://localhost:5173/api/v1/webhooks/stripe
```

Copy the resulting `whsec_...` value into `.dev.vars` as `STRIPE_WEBHOOK_SECRET`, then restart the development server. See [Deployment](docs/DEPLOYMENT.md) for the required Stripe permissions and event list.

Open the local URL printed by Vite. The public ladder is at `/`, its commercial rules are at `/rules`, the open-source deployment page is at `/deploy`, and moderation is at `/admin`. Enter the **raw admin key** printed by the generator in the admin screen. Only its SHA-256 hash is stored in the Worker secret.

## Deploy to Cloudflare

Authenticate Wrangler once, then run the setup deployment:

```bash
pnpm exec wrangler login
export STRIPE_API_KEY='rk_live_...'
export STRIPE_WEBHOOK_SECRET='whsec_...'
pnpm deploy:setup
```

The setup command creates or reuses the `bidladder` D1 database, applies remote migrations, generates an admin key, uploads all required Worker secrets, and deploys the application. Save the raw admin key printed at the end; it cannot be recovered from Cloudflare. After deployment, run the state-neutral verifier:

```bash
pnpm verify:deployment -- https://your-bidladder.example
```

For location selection, repeat deployments, key rotation, and manual deployment steps, read [Deployment](docs/DEPLOYMENT.md).

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the Worker and React Router app locally |
| `pnpm build` | Create a production build |
| `pnpm test` | Run integration tests in the Cloudflare Workers runtime |
| `pnpm verify:deployment -- URL` | Verify a deployed installation without creating bids or payments |
| `pnpm check` | Run type generation, TypeScript, and Biome checks |
| `pnpm quality` | Run all checks, tests, and the production build |
| `pnpm db:generate` | Generate a migration from the Drizzle schema |
| `pnpm db:migrate:local` | Apply migrations to local D1 |
| `pnpm db:migrate:remote` | Apply migrations to remote D1 |
| `pnpm deploy:setup` | Provision and deploy a new installation |
| `pnpm deploy` | Build and deploy an already configured installation |

## API

All API responses are JSON under `/api/v1`.

| Method | Endpoint | Access |
| --- | --- | --- |
| `GET` | `/api/v1/leaderboards/:slug` | Public |
| `GET` | `/go/:placementId` | Public outbound redirect; records accepted click-throughs |
| `POST` | `/api/v1/leaderboards/:slug/bids` | Public; requires `Idempotency-Key` |
| `POST` | `/api/v1/bids/:bidId/checkout` | Public; creates or resumes Stripe Checkout |
| `GET` | `/api/v1/bids/:bidId/payment` | Public; payment and moderation status |
| `POST` | `/api/v1/webhooks/stripe` | Stripe signature required |
| `GET` | `/api/v1/admin/bids?status=pending` | Admin bearer key |
| `POST` | `/api/v1/admin/bids/:bidId/decision` | Admin bearer key |
| `POST` | `/api/v1/admin/payments/:bidId/reconcile` | Admin bearer key |
| `GET` | `/health` | Public |

The default migration creates the `main` ladder with USD as its currency, a $10 minimum contribution, $1 increments, a 3-business-day review window, and a 5-business-day refund-initiation window. Change those values through a reviewed migration before deploying if your installation needs different defaults.

## Documentation

- [Architecture and security boundaries](docs/ARCHITECTURE.md)
- [Deployment and admin-key management](docs/DEPLOYMENT.md)
- [Database ownership and migration rules](database/README.md)
- [Project identity and stewardship](docs/PROJECT_IDENTITY.md)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [MIT License](LICENSE)

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before changing application behavior or the database schema. Run `pnpm quality` before opening a pull request.

## Security

Please do not publish suspected vulnerabilities in a public issue. Follow the private reporting process in [SECURITY.md](SECURITY.md).

## License

BidLadder is open-source software released under the [MIT License](LICENSE).

Copyright (c) 2026 Borealbit Technology Limited.

The license covers the software, not permission to use the BidLadder or BorealBit names and logos as trademarks.

## Authors and maintainers

Created by **Dom Liu**. Maintained by **BorealBit Technology Limited**.

Canonical repository: [`borealbit/bidladder`](https://github.com/borealbit/bidladder)
