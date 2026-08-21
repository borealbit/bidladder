import { publicUrl } from "../../src/http/public-origin";
import { cloudflareRequestContext } from "../../src/http/react-router-context";
import { getPublicLeaderboard } from "../../src/modules/leaderboard/service";
import { createDatabase } from "../../src/platform/d1/client";
import { Brand } from "../components/brand";
import type { Route } from "./+types/rules";

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
  const title = `Rules — ${loaderData?.ladder.name ?? "BidLadder"}`;
  const description =
    "How sponsored placement, payments, moderation, refunds, click counts, and takedowns work.";
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
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { name: "twitter:card", content: "summary" },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareRequestContext);
  const leaderboard = await getPublicLeaderboard(createDatabase(env.DB), "main");
  return {
    ...leaderboard,
    canonicalUrl: publicUrl("/rules", request.url, env.PUBLIC_ORIGIN),
  };
}

function formatBusinessDays(days: number) {
  return `${days} business ${days === 1 ? "day" : "days"}`;
}

export default function Rules({ loaderData }: Route.ComponentProps) {
  const currency = new Intl.NumberFormat("en-US", {
    currency: loaderData.ladder.currency,
    style: "currency",
  });

  return (
    <div className="site-shell">
      <header className="site-header page-frame">
        <Brand name={loaderData.ladder.name} />
        <nav aria-label="Primary navigation">
          <a href="/">Leaderboard</a>
          <a aria-current="page" href="/rules">
            Rules
          </a>
          <a href="/deploy">
            Deploy your own <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>
      <main className="content-page page-frame">
        <article>
          <h1>Rules</h1>
          <p className="content-lead">
            {loaderData.ladder.name} is a public sponsored leaderboard. Placement is determined only
            by the lifetime amount paid for each product.
          </p>

          <h2>How ranking works</h2>
          <ul>
            <li>
              Each contribution must be at least{" "}
              {currency.format(loaderData.ladder.minimumBidCents / 100)} and follow increments of{" "}
              {currency.format(loaderData.ladder.bidIncrementCents / 100)}.
            </li>
            <li>Every approved payment is added to that product&apos;s lifetime total.</li>
            <li>
              Higher lifetime totals rank first. Equal totals keep the earlier position first.
            </li>
            <li>
              Reusing the same canonical product URL adds to the existing listing instead of
              creating a duplicate.
            </li>
          </ul>

          <h2>Canonical product identity</h2>
          <p>
            Tracking parameters and fragments are removed. App Store listings are matched by Apple
            app ID, GitHub projects by owner and repository, and other products by host and path.
          </p>

          <h2>Click counts and timestamps</h2>
          <p>
            A click is counted when a visitor follows a listing through BidLadder&apos;s outbound
            redirect. Known bots are excluded and repeated requests are rate limited. The number is
            a total of accepted click-throughs, not unique visitors, verified humans, sessions,
            downloads, or conversions. BidLadder stores the aggregate count without storing an IP
            address or a per-click history in D1. The updated time is the most recent approved
            placement update.
          </p>

          <h2>Data and privacy</h2>
          <p>
            A submission stores its public listing details, contact email, payment status, and
            moderation history in the operator&apos;s D1 database. The contact email is used for
            review and Stripe Checkout, but it is not shown on the public leaderboard. Card details
            are entered on Stripe&apos;s hosted checkout page rather than collected by BidLadder.
            Operators are responsible for publishing any additional privacy notice, contact method,
            retention period, and regional disclosures required for their installation.
          </p>

          <h2>What you can list</h2>
          <p>
            Listings must point to a real, public product or project. Malware, impersonation,
            deceptive downloads, illegal products, adult content, link shorteners, unrelated group
            chats, and misleading duplicate URLs are not permitted.
          </p>

          <h2>Payment, review, and refunds</h2>
          <p>
            Stripe confirms payment before moderation. A paid submission is not public until the
            operator approves it. Placement does not guarantee clicks, sales, reviews, downloads, or
            ranking on any third-party platform.
          </p>

          <h2>Operating timelines</h2>
          <ul>
            <li>
              Paid submissions are normally reviewed within{" "}
              {formatBusinessDays(loaderData.ladder.reviewWindowBusinessDays)} after payment is
              confirmed.
            </li>
            <li>
              If a paid submission is rejected before publication, the operator initiates a full
              refund within {formatBusinessDays(loaderData.ladder.refundInitiationBusinessDays)}{" "}
              after the rejection.
            </li>
            <li>
              Initiated means the refund request has been sent to Stripe. Stripe, the card network,
              and the customer&apos;s bank determine when the funds appear in the customer&apos;s
              account.
            </li>
          </ul>

          <h2>Takedowns after publication</h2>
          <p>
            The operator may pause a live listing immediately if it becomes unavailable, unsafe,
            deceptive, or otherwise violates these rules. A takedown and refund eligibility are
            separate decisions: rejection before publication receives a full refund; a
            post-publication takedown is reviewed case by case and is not automatically refundable.
            Any full or partial Stripe refund pauses the placement while the operator reviews it.
          </p>
        </article>
      </main>
      <footer className="site-footer page-frame">
        <Brand compact name={loaderData.ladder.name} />
        <p>
          <a href="/">Return to leaderboard</a>
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
