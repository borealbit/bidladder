import type { PublicLeaderboard } from "../../../src/modules/leaderboard/contracts";

function formatAmount(amountCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    style: "currency",
  }).format(amountCents / 100);
}

function formatUpdatedAt(updatedAt: number, generatedAt: number) {
  const elapsedMs = Math.max(0, generatedAt - updatedAt);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) {
    return "updated just now";
  }
  if (elapsedMinutes < 60) {
    return `updated ${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `updated ${elapsedHours}h ago`;
  }

  return `updated ${Math.floor(elapsedHours / 24)}d ago`;
}

function SponsorAvatar({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  if (logoUrl) {
    return (
      <img alt="" className="sponsor-avatar" height="40" loading="lazy" src={logoUrl} width="40" />
    );
  }

  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return <span className="sponsor-avatar sponsor-avatar--fallback">{initials}</span>;
}

export function LeaderboardList({ data }: { data: PublicLeaderboard }) {
  return (
    <section aria-labelledby="leaderboard-title" className="leaderboard" id="leaderboard">
      <div className="section-heading-row">
        <h2 id="leaderboard-title">Live leaderboard</h2>
        <span className="sort-label">Sorted by lifetime total</span>
      </div>

      <div className="leaderboard-head" aria-hidden="true">
        <span>Rank</span>
        <span>Sponsor</span>
        <span>Tagline</span>
        <span>Lifetime total</span>
        <span>Take position</span>
      </div>

      {data.placements.length > 0 ? (
        <ol className="leaderboard-rows">
          {data.placements.map((placement, index) => (
            <li className="leaderboard-row" key={placement.id}>
              <span className="rank">{String(index + 1).padStart(2, "0")}</span>
              <a
                className="sponsor-cell"
                href={`/go/${encodeURIComponent(placement.id)}`}
                rel="noreferrer sponsored"
                target="_blank"
              >
                <SponsorAvatar logoUrl={placement.logoUrl} name={placement.name} />
                <strong>{placement.name}</strong>
              </a>
              <div className="tagline">
                <span>{placement.tagline}</span>
                <span
                  className="placement-metrics"
                  title="Accepted non-bot outbound redirects; repeated requests are rate limited."
                >
                  {placement.clickCount.toLocaleString("en-US")}{" "}
                  {placement.clickCount === 1 ? "click" : "clicks"}
                  <span aria-hidden="true"> · </span>
                  <time dateTime={new Date(placement.updatedAt).toISOString()}>
                    {formatUpdatedAt(placement.updatedAt, data.generatedAt)}
                  </time>
                </span>
              </div>
              <strong className="amount">
                {formatAmount(placement.amountCents, data.ladder.currency)} <small>lifetime</small>
              </strong>
              <button
                className="rank-action"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("bidladder:prefill-bid", {
                      detail: {
                        amountCents: placement.amountCents + data.ladder.bidIncrementCents,
                      },
                    }),
                  );
                  document.getElementById("place-bid")?.scrollIntoView({ behavior: "smooth" });
                }}
                type="button"
              >
                Beat for{" "}
                {formatAmount(
                  placement.amountCents + data.ladder.bidIncrementCents,
                  data.ladder.currency,
                )}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="leaderboard-empty">
          <strong>The ladder is open</strong>
          <p>Be the first sponsor to claim the top spot.</p>
          <a href="#place-bid">Place the first bid</a>
        </div>
      )}
    </section>
  );
}
