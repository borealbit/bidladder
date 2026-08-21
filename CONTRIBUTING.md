# Contributing to BidLadder

Thank you for helping improve BidLadder. Bug reports, documentation fixes, design feedback, tests, and focused pull requests are welcome.

## Before you start

- Search existing issues and pull requests before opening a duplicate.
- Use an issue to discuss large features, new infrastructure, payment behavior, or breaking API and schema changes before implementation.
- Keep sponsored placement explicit. Features must not present BidLadder as a way to manipulate search, marketplace, or App Store rankings.
- Never commit credentials, raw admin keys, Cloudflare tokens, `.dev.vars`, or production data.

## Local development

BidLadder requires Node.js 22.22 or newer and pnpm 11.22.

```bash
corepack enable
pnpm install
cp .dev.vars.example .dev.vars
node scripts/generate-admin-key.mjs
pnpm db:migrate:local
pnpm dev
```

Copy the generated hash into `.dev.vars`. Keep the generated raw key available for the local `/admin` screen.

## Making a change

1. Fork the repository and create a focused branch.
2. Add or update tests for behavior changes.
3. Update documentation when commands, configuration, APIs, or user-visible behavior change.
4. Run the full quality gate:

```bash
pnpm quality
```

5. Open a pull request that explains the problem, the chosen solution, and how it was verified.

## Database changes

`database/schema.ts` is the schema source of truth. Generate migrations with:

```bash
pnpm db:generate
```

Commit both the schema change and generated migration. Review generated SQL, rehearse it locally, and describe compatibility or backfill implications in the pull request. Do not rewrite a migration that may already have been applied by users; add a new forward migration instead.

## Pull request expectations

A reviewable pull request should:

- address one coherent concern;
- preserve the one-Worker, one-D1 deployment model unless a design discussion has approved a change;
- keep API errors stable and machine-readable;
- keep admin credentials server-side except for the raw key entered by the operator;
- include screenshots for meaningful UI changes; and
- pass checks, tests, and the production build.

By contributing, you agree that your contribution is licensed under the project's [MIT License](LICENSE).
