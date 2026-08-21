import type { PublicLeaderboard } from "../../../src/modules/leaderboard/contracts";

function formatAmount(amountCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(amountCents / 100);
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
        <span className="sort-label">Sorted by bid amount</span>
      </div>

      <div className="leaderboard-head" aria-hidden="true">
        <span>Rank</span>
        <span>Sponsor</span>
        <span>Tagline</span>
        <span>Bid amount</span>
      </div>

      {data.placements.length > 0 ? (
        <ol className="leaderboard-rows">
          {data.placements.map((placement, index) => (
            <li className="leaderboard-row" key={placement.id}>
              <span className="rank">{String(index + 1).padStart(2, "0")}</span>
              <a
                className="sponsor-cell"
                href={placement.websiteUrl}
                rel="noreferrer sponsored"
                target="_blank"
              >
                <SponsorAvatar logoUrl={placement.logoUrl} name={placement.name} />
                <strong>{placement.name}</strong>
              </a>
              <span className="tagline">{placement.tagline}</span>
              <strong className="amount">
                {formatAmount(placement.amountCents, data.ladder.currency)}
              </strong>
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
