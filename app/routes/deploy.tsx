import { publicUrl } from "../../src/http/public-origin";
import { cloudflareRequestContext } from "../../src/http/react-router-context";
import { Brand } from "../components/brand";
import type { Route } from "./+types/deploy";

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
  const title = "Deploy BidLadder — Open-source Sponsored Leaderboard";
  const description = "Deploy your own transparent sponsored leaderboard on Cloudflare.";
  return [
    { title },
    { name: "description", content: description },
    ...(loaderData?.canonicalUrl
      ? [
          { tagName: "link" as const, rel: "canonical", href: loaderData.canonicalUrl },
          { property: "og:url", content: loaderData.canonicalUrl },
        ]
      : []),
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "BidLadder" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { name: "twitter:card", content: "summary" },
  ];
}

export function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareRequestContext);
  return { canonicalUrl: publicUrl("/deploy", request.url, env.PUBLIC_ORIGIN) };
}

export default function Deploy() {
  return (
    <div className="site-shell deploy-page">
      <header className="site-header page-frame">
        <Brand />
        <nav aria-label="Primary navigation">
          <a href="/">Live demo</a>
          <a href="/rules">Rules</a>
          <a href="https://github.com/borealbit/bidladder" rel="noreferrer" target="_blank">
            GitHub <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>
      <main>
        <section className="deploy-hero page-frame">
          <h1>Own the whole ladder.</h1>
          <p>
            BidLadder is an open-source, self-hosted sponsored leaderboard for Cloudflare. Deploy it
            with your brand, your rules, and your Stripe account.
          </p>
          <div className="hero-actions">
            <a
              className="button button-primary"
              href="https://github.com/borealbit/bidladder"
              rel="noreferrer"
              target="_blank"
            >
              View on GitHub <span aria-hidden="true">↗</span>
            </a>
            <a
              className="button button-secondary"
              href="https://github.com/borealbit/bidladder/blob/main/docs/DEPLOYMENT.md"
              rel="noreferrer"
              target="_blank"
            >
              Deployment guide <span aria-hidden="true">↗</span>
            </a>
          </div>
        </section>

        <section className="deploy-details page-frame">
          <div>
            <span>01</span>
            <h2>One small stack</h2>
            <p>One Cloudflare Worker, one D1 database, React Router, and Stripe Checkout.</p>
          </div>
          <div>
            <span>02</span>
            <h2>Transparent by design</h2>
            <p>
              Public lifetime totals, deterministic ordering, moderation, and refund-aware pauses.
            </p>
          </div>
          <div>
            <span>03</span>
            <h2>Open to shape</h2>
            <p>MIT licensed. Change the brand, minimum contribution, rules, and presentation.</p>
          </div>
        </section>

        <section className="deploy-command page-frame">
          <div>
            <h2>From clone to live ladder.</h2>
            <p>
              The setup command provisions D1, applies migrations, uploads secrets, and deploys.
            </p>
          </div>
          <pre>
            <code>pnpm install{"\n"}pnpm deploy:setup</code>
          </pre>
        </section>
      </main>
      <footer className="site-footer page-frame">
        <Brand compact />
        <p>
          Open source under the{" "}
          <a href="https://github.com/borealbit/bidladder/blob/main/LICENSE">MIT License</a>
        </p>
        <p>
          Created by <strong>Dom Liu</strong> · Maintained by{" "}
          <a href="https://github.com/borealbit">
            <strong>BorealBit</strong>
          </a>
        </p>
      </footer>
    </div>
  );
}
