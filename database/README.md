# Database ownership

BidLadder uses one Cloudflare D1 database per deployment.

The ownership chain is explicit:

```text
ladder -> sponsor -> bid
       -> placement -> current bid
```

- A sponsor belongs to exactly one ladder.
- A bid belongs to the same ladder and sponsor selected by the service layer.
- A placement is the public, current projection of an approved bid.
- Bid rows retain moderation history; approving a newer bid updates the placement instead of deleting history.

The initial migration is additive. D1 migrations are applied locally with `pnpm db:migrate:local` and remotely with `pnpm db:migrate:remote`. Production schema changes must be generated, reviewed, and rehearsed before they are applied.
