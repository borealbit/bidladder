# Architecture

BidLadder is intentionally small to operate: one Cloudflare Worker serves the UI and API, and one Cloudflare D1 database owns the installation's data.

## Request ownership

```text
Browser or API client
        |
        v
Cloudflare Worker
  |-- /health, /robots.txt, /sitemap.xml, /go/:placementId
  |-- /api/v1/* ----------------------> Hono API
  |      |-- public/admin rate-limit bindings
  |      |-- Cloudflare D1
  |      `-- Stripe Checkout API / signed webhook
  `-- all other routes ---------------> React Router SSR
```

`workers/app.ts` is a lifecycle-only entry point. It creates the React Router request handler, injects the Cloudflare environment into route context, and delegates request ownership to `src/server/app.ts`.

Hono owns operational and API routes. React Router owns public and admin pages. Unknown `/api/*` paths always return JSON rather than falling through to HTML rendering.

## Application layers

- `app/` contains React Router routes, components, and styling.
- `src/modules/leaderboard/` contains validation, HTTP handlers, and bid lifecycle behavior.
- `src/modules/payments/` owns Stripe Checkout, webhook projection, and reconciliation.
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
  |           |-- payment_attempts
  |           |     `-- stripe_events
  |           `-- payment_transitions
  `-- placements --> current approved bid + aggregate click count
```

A sponsor is unique by ladder and canonical product identity: Apple app ID for App Store listings, owner/repository for GitHub, and normalized host/path for other websites. Tracking parameters and fragments are removed. Bid history is retained. A partial unique index permits only one active pending bid for a sponsor on a ladder. A bid stores an immutable snapshot of the proposed public metadata, so an unpaid or unreviewed submission cannot change an existing placement. A bid can have multiple sequential payment attempts, while a partial unique index permits only one creating, open, or processing attempt at a time.

The ladder row also owns the review window and refund-initiation window displayed on the public Rules page. Keeping these operating promises in D1 lets each self-hosted installation publish timelines that match its actual moderation capacity.

Approval publishes the bid snapshot and adds the paid contribution to the sponsor's lifetime total. Public ordering is computed from active placements by lifetime total descending, then publication time ascending for a stable tie-break.

Public sponsor links use `/go/:placementId`. The Worker resolves the destination from D1, atomically increments the placement's aggregate click count, and returns a non-cacheable redirect. Known bot user agents are excluded, and repeated requests from the same available network identity are limited with a hashed key. The redirect still succeeds when a request is excluded from counting. BidLadder does not persist raw network identities, cookies, or a per-click event log; the public number is accepted click-throughs rather than unique visitors or conversions.

## Security boundaries

- Public users can read a ladder and submit a proposed bid.
- Admin endpoints require a bearer key at `/api/v1/admin/*`.
- The Worker stores only the SHA-256 hash of that key in `ADMIN_API_KEY_HASH` and compares hashes in constant time.
- The raw admin key is entered by the operator and kept in browser session storage by the current dashboard. It is not placed in source code or D1.
- Input contracts are validated with Zod; database constraints provide a second integrity boundary.
- JSON and Stripe webhook bodies have explicit byte limits.
- Public writes are limited by hashed sponsor identity and, when available, a hashed network identity. Admin routes use a separate limiter.
- Stripe webhook signatures are verified from the unmodified request body before D1 is touched.
- Request IDs and stable error codes make failures diagnosable without returning internal exception details.

The admin key is intentionally a simple operator credential for a single-installation, self-hosted project. Multi-user accounts, audit identities, and delegated roles require a real identity system and are outside the current scope.

Cloudflare rate-limit bindings are deliberately an abuse-control boundary, not an accounting system. Their counters can be eventually consistent, so payment and bid correctness always comes from D1 constraints and Stripe verification.

## Payment state machine

Moderation and payment are separate state machines. Payment success never auto-approves content, and moderation cannot approve a bid unless its payment state is exactly `paid`.

```text
unpaid -> checkout_pending -> checkout_open -> processing -> paid
              |                  |                |
              `--------------> failed / expired <-'

paid -> partially_refunded / refunded -> public placement paused
```

The browser return URL is only a user-experience signal. A signed Stripe event—or an explicit admin reconciliation against Stripe—is authoritative. The Worker validates the Checkout Session's bid ID, attempt ID, amount, and currency before projecting payment state.

Handled events are:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `charge.refunded`

Provider event IDs are claimed in `stripe_events`, so delivery retries are safe. `payment_transitions` is append-only and records checkout, webhook, and reconciliation projections without storing full Stripe payloads. Late failure or expiry events cannot roll a paid/refunded attempt backward. Partial or full refunds pause an existing placement for operator review.

## Stripe boundary

BidLadder sends the user to Stripe-hosted Checkout and never handles card data. It stores provider object IDs and local audit state, not full Stripe objects or webhook payloads. Checkout uses integer minor units, an idempotency key stable for each local attempt, and payment methods selected by Stripe configuration. Automatic tax is intentionally off until an operator has completed the appropriate registration and compliance setup.
