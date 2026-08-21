# Database ownership

BidLadder uses one Cloudflare D1 database per deployment.

The ownership chain is explicit:

```text
ladder -> sponsor -> bid
                    |-> payment attempt -> Stripe event claim
                    `-> payment transition history
       -> placement -> current approved bid + lifetime total + aggregate click count
```

- A sponsor belongs to exactly one ladder.
- A ladder owns the public review and refund-initiation windows shown in its rules.
- A bid belongs to the same ladder and sponsor selected by the service layer.
- A placement is the public projection of the current approved bid and the sum of approved contributions.
- A placement stores an aggregate count of accepted non-bot outbound redirects. Raw IP addresses and per-click events are not stored in D1.
- A payment attempt is one immutable amount/currency checkout attempt for a bid.
- Stripe event IDs are unique replay claims; payment transitions are append-only audit records.
- Bid rows retain immutable submitted metadata and moderation history; approving a newer bid updates public sponsor metadata and adds its contribution to the placement instead of deleting history.

Payment and moderation are deliberately separate columns. Only `payment_status = 'paid'` is eligible for approval. Refund projections pause placements rather than deleting commercial history. Full Stripe payloads, card data, and raw credentials do not belong in D1.

The initial migration is additive. D1 migrations are applied locally with `pnpm db:migrate:local` and remotely with `pnpm db:migrate:remote`. Production schema changes must be generated, reviewed, and rehearsed before they are applied. Change ladder policy windows through a reviewed migration so the database configuration and public Rules page remain aligned.
