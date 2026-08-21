# BidLadder

> Deploy your own bid-powered sponsored leaderboard.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Code style: Biome](https://img.shields.io/badge/code_style-Biome-60A5FA)](https://biomejs.dev/)

BidLadder is an open-source, self-hosted sponsored leaderboard for Cloudflare Workers. Sponsors submit bids for clearly labeled placement; maintainers review each submission, and approved sponsors are ordered by bid amount.

**Self-hosted. MIT licensed. One Worker, one D1 database.**

## Features

- Public sponsored leaderboard with transparent bid amounts
- Sponsor submission form with idempotent API requests
- Key-protected moderation dashboard at `/admin`
- Approval and rejection workflow with retained bid history
- Server-rendered React Router application and versioned Hono API
- Cloudflare D1 schema and reviewed Drizzle migrations
- Security headers, stable JSON errors, health check, robots file, and sitemap
- One-command first deployment to Cloudflare

> [!IMPORTANT]
> BidLadder currently records and moderates bid proposals; it does not collect or settle payments. Add a payment provider and your own commercial, tax, refund, and compliance rules before treating an approved bid as a paid transaction.

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

Copy the generated `ADMIN_API_KEY_HASH` into `.dev.vars`, then initialize the local D1 database and start the app:

```bash
pnpm db:migrate:local
pnpm dev
```

Open the local URL printed by Vite. The public ladder is at `/`; moderation is at `/admin`. Enter the **raw admin key** printed by the generator in the admin screen. Only its SHA-256 hash is stored in the Worker secret.

## Deploy to Cloudflare

Authenticate Wrangler once, then run the setup deployment:

```bash
pnpm exec wrangler login
pnpm deploy:setup
```

The setup command creates or reuses the `bidladder` D1 database, updates the local binding, applies remote migrations, generates an admin key, uploads its hash as a Worker secret, and deploys the application. Save the raw admin key printed at the end; it cannot be recovered from Cloudflare.

For location selection, repeat deployments, key rotation, and manual deployment steps, read [Deployment](docs/DEPLOYMENT.md).

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the Worker and React Router app locally |
| `pnpm build` | Create a production build |
| `pnpm test` | Run integration tests in the Cloudflare Workers runtime |
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
| `POST` | `/api/v1/leaderboards/:slug/bids` | Public; requires `Idempotency-Key` |
| `GET` | `/api/v1/admin/bids?status=pending` | Admin bearer key |
| `POST` | `/api/v1/admin/bids/:bidId/decision` | Admin bearer key |
| `GET` | `/health` | Public |

The default migration creates the `main` ladder with USD as its currency and a minimum bid of $10. Change those values through a reviewed migration before deploying if your installation needs different defaults.

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
