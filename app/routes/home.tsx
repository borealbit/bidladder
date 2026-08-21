import { cloudflareRequestContext } from "../../src/http/react-router-context";
import { getPublicLeaderboard } from "../../src/modules/leaderboard/service";
import { createDatabase } from "../../src/platform/d1/client";
import { Brand } from "../components/brand";
import { BidForm } from "../features/leaderboard/bid-form";
import { CheckoutNotice } from "../features/leaderboard/checkout-notice";
import { LeaderboardList } from "../features/leaderboard/leaderboard-list";
import type { Route } from "./+types/home";

function formatAmount(amountCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: 0,
    style: "currency",
  }).format(amountCents / 100);
}

export function meta(): Route.MetaDescriptors {
  return [
    { title: "BidLadder — Transparent Sponsored Leaderboard" },
    {
      name: "description",
      content: "A transparent, bid-powered sponsored leaderboard for products and projects.",
    },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareRequestContext);
  return getPublicLeaderboard(createDatabase(env.DB), "main");
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const topAmountCents = loaderData.placements[0]?.amountCents ?? 0;
  const suggestedAmountCents = Math.max(
    loaderData.ladder.minimumBidCents,
    topAmountCents + loaderData.ladder.bidIncrementCents,
  );

  return (
    <div className="site-shell">
      <header className="site-header page-frame">
        <Brand name={loaderData.ladder.name} />
        <nav aria-label="Primary navigation">
          <a href="#leaderboard">Leaderboard</a>
          <a href="/rules">Rules</a>
          <a href="/deploy">
            Deploy your own <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>

      <main>
        <CheckoutNotice />
        <section className="market-hero page-frame">
          <div className="market-hero-copy">
            <h1>
              Claim the #1 sponsored spot for{" "}
              <span>{formatAmount(suggestedAmountCents, loaderData.ladder.currency)}</span>
            </h1>
            <p>
              {loaderData.ladder.description} Every payment adds to the product&apos;s lifetime
              total. The highest total leads the ladder.
            </p>
            <ul className="market-facts" aria-label="Leaderboard facts">
              <li>
                <strong>{loaderData.placements.length}</strong> active sponsors
              </li>
              <li>
                <strong>
                  {formatAmount(loaderData.ladder.minimumBidCents, loaderData.ladder.currency)}
                </strong>{" "}
                minimum
              </li>
              <li>
                <strong>100%</strong> sponsored and transparent
              </li>
            </ul>
          </div>
          <BidForm
            bidIncrementCents={loaderData.ladder.bidIncrementCents}
            currency={loaderData.ladder.currency}
            minimumBidCents={loaderData.ladder.minimumBidCents}
            suggestedAmountCents={suggestedAmountCents}
          />
        </section>

        <div className="page-frame leaderboard-frame">
          <LeaderboardList data={loaderData} />
        </div>

        <section className="lower-grid page-frame">
          <section aria-labelledby="how-title" className="how-panel" id="how-it-works">
            <div>
              <h2 id="how-title">How it works</h2>
              <p>Transparent placement, reviewed by the people who run the ladder.</p>
            </div>
            <ol className="steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Submit</strong>
                  <p>Paste a product URL, choose a contribution, and preview the listing.</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Review</strong>
                  <p>Complete Stripe Checkout. The maintainer reviews every paid submission.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Climb</strong>
                  <p>Approval adds the payment to your lifetime total and recalculates the rank.</p>
                </div>
              </li>
            </ol>
          </section>
          <section aria-labelledby="deploy-title" className="deploy-panel">
            <div>
              <h2 id="deploy-title">Run your own ladder.</h2>
              <p>
                BidLadder is MIT licensed and self-hosted on one Cloudflare Worker with one D1
                database.
              </p>
            </div>
            <ul>
              <li>Stripe-hosted payments</li>
              <li>Built-in moderation</li>
              <li>Your brand and your rules</li>
            </ul>
            <a className="button button-inverse" href="/deploy">
              Deploy your own <span aria-hidden="true">→</span>
            </a>
          </section>
        </section>
      </main>

      <footer className="site-footer page-frame">
        <Brand compact name={loaderData.ladder.name} />
        <p>
          <a href="/rules">Rules</a> · Sponsored placements are reviewed before publication.
        </p>
        <p>
          Powered by{" "}
          <a href="/deploy">
            <strong>BidLadder</strong>
          </a>
        </p>
      </footer>
    </div>
  );
}
