# Architecture

BidLadder is intentionally small to operate: one Cloudflare Worker serves the UI and API, and one Cloudflare D1 database owns the installation's data.

## Request ownership

```text
Browser or API client
        |
        v
Cloudflare Worker
  |-- /health, /robots.txt, /sitemap.xml
  |-- /api/v1/* ----------------------> Hono API
  `-- all other routes ---------------> React Router SSR
                                            |
                                            v
                                      Cloudflare D1
```

`workers/app.ts` is a lifecycle-only entry point. It creates the React Router request handler, injects the Cloudflare environment into route context, and delegates request ownership to `src/server/app.ts`.

Hono owns operational and API routes. React Router owns public and admin pages. Unknown `/api/*` paths always return JSON rather than falling through to HTML rendering.

## Application layers

- `app/` contains React Router routes, components, and styling.
- `src/modules/leaderboard/` contains validation, HTTP handlers, and bid lifecycle behavior.
- `src/http/` contains shared HTTP errors, request context, and admin authentication.
- `src/platform/d1/` contains the D1/Drizzle adapter.
- `database/schema.ts` is the database schema source of truth.
- `migrations/` contains forward D1 migrations.
- `workers/app.ts` is the Cloudflare Worker entry point.

## Data ownership

```text
ladder
  |-- sponsors
  |     `-- bids
  `-- placements --> current approved bid
```

A sponsor is unique by ladder and website host. Bid history is retained. A partial unique index permits only one pending bid for a sponsor on a ladder. Approval updates the sponsor's public placement; it does not erase older bid records.

Public ordering is computed from active placements by bid amount descending, then publication time ascending for a stable tie-break.

## Security boundaries

- Public users can read a ladder and submit a proposed bid.
- Admin endpoints require a bearer key at `/api/v1/admin/*`.
- The Worker stores only the SHA-256 hash of that key in `ADMIN_API_KEY_HASH` and compares hashes in constant time.
- The raw admin key is entered by the operator and kept in browser session storage by the current dashboard. It is not placed in source code or D1.
- Input contracts are validated with Zod; database constraints provide a second integrity boundary.
- Request IDs and stable error codes make failures diagnosable without returning internal exception details.

The admin key is intentionally a simple operator credential for a single-installation, self-hosted project. Multi-user accounts, audit identities, and delegated roles require a real identity system and are outside the current scope.

## Payment boundary

BidLadder does not process payments. A bid is a proposal that enters moderation, and approval publishes a sponsored placement. Installations that collect money must add provider-side verification, signed webhooks, reconciliation, refund behavior, and applicable legal and tax controls before publishing paid placements.
