# Security policy

## Reporting a vulnerability

Please do not report suspected vulnerabilities in a public GitHub issue, discussion, or pull request.

Use [GitHub's private vulnerability reporting for BidLadder](https://github.com/borealbit/bidladder/security/advisories/new). Include the affected version or commit, impact, reproduction steps, and any suggested mitigation. If private reporting is unavailable, contact the repository maintainers through the BorealBit GitHub organization without publishing exploit details.

Maintainers will acknowledge a complete report as soon as practical, investigate it, coordinate a fix, and credit the reporter when requested and appropriate. Please allow time for a patch before public disclosure.

## Supported versions

BidLadder is pre-1.0 software under active development. Security fixes target the latest release and the current default branch. Older deployments should update to the newest release before requesting a backport.

## Operator responsibilities

Self-hosting transfers deployment security to the operator. In particular:

- protect the raw admin key and Cloudflare credentials;
- store only the SHA-256 admin-key hash in `ADMIN_API_KEY_HASH`;
- use a least-privilege Stripe restricted key and protect both Stripe Worker secrets;
- keep Stripe test/live keys and webhook endpoint secrets aligned with the deployment environment;
- restrict access to Cloudflare accounts and D1 data;
- review dependencies and migrations before deployment;
- configure appropriate tax, refund, legal, privacy, sanctions, and abuse controls before accepting payments; and
- rotate the admin key immediately if it may have been disclosed.

BidLadder verifies Stripe signatures against the raw request body and claims provider event IDs before processing. Do not bypass those boundaries or treat the Checkout return URL as payment proof. Refund events intentionally pause public placement; operators should reconcile Stripe and D1 before restoring disputed state.

See [Deployment](docs/DEPLOYMENT.md) for key rotation instructions and [Architecture](docs/ARCHITECTURE.md) for trust boundaries.
