import { cloudflareRequestContext } from "../../src/http/react-router-context";
import { getPublicLeaderboard } from "../../src/modules/leaderboard/service";
import { createDatabase } from "../../src/platform/d1/client";
import { Brand } from "../components/brand";
import { BidForm } from "../features/leaderboard/bid-form";
import { LeaderboardList } from "../features/leaderboard/leaderboard-list";
import type { Route } from "./+types/home";

export function meta(): Route.MetaDescriptors {
  return [
    { title: "BidLadder — Deploy Your Own Sponsored Leaderboard" },
    {
      name: "description",
      content: "An open-source, bid-powered sponsored leaderboard for Cloudflare Workers.",
    },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareRequestContext);
  return getPublicLeaderboard(createDatabase(env.DB), "main");
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <div className="site-shell">
      <header className="site-header page-frame">
        <Brand />
        <nav aria-label="Primary navigation">
          <a href="#leaderboard">Leaderboard</a>
          <a href="#how-it-works">How it works</a>
          <a href="https://github.com/borealbit/bidladder" rel="noreferrer" target="_blank">
            GitHub <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>

      <main>
        <section className="hero page-frame">
          <div className="hero-copy">
            <h1>Climb the ladder. Sponsor what matters.</h1>
            <p>A transparent, bid-powered leaderboard you can deploy on Cloudflare in minutes.</p>
            <div className="hero-actions">
              <a className="button button-primary" href="#place-bid">
                Place a bid <span aria-hidden="true">→</span>
              </a>
              <a
                className="button button-secondary"
                href="https://github.com/borealbit/bidladder"
                rel="noreferrer"
                target="_blank"
              >
                View on GitHub <span aria-hidden="true">↗</span>
              </a>
            </div>
          </div>
          <LeaderboardList data={loaderData} />
        </section>

        <section className="lower-grid page-frame">
          <BidForm
            currency={loaderData.ladder.currency}
            minimumBidCents={loaderData.ladder.minimumBidCents}
          />
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
                  <p>Choose your bid amount and share your sponsor details.</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Review</strong>
                  <p>The maintainer reviews each submission to keep the ladder useful.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Climb</strong>
                  <p>Once approved, your position follows your current bid.</p>
                </div>
              </li>
            </ol>
            <div className="open-source-note">
              <strong>Own the whole ladder.</strong>
              <p>Fork it, shape the rules, and deploy one Worker with one D1 database.</p>
            </div>
          </section>
        </section>
      </main>

      <footer className="site-footer page-frame">
        <Brand compact />
        <p>
          Open source under the{" "}
          <a href="https://github.com/borealbit/bidladder/blob/main/LICENSE">MIT License</a>
        </p>
        <p>
          Created by <strong>Dom Liu</strong> · Maintained by <strong>BorealBit</strong>
        </p>
      </footer>
    </div>
  );
}
