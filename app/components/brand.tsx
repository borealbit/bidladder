import { Link } from "react-router";

export function LadderMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={compact ? "ladder-mark ladder-mark--compact" : "ladder-mark"}
    >
      <span />
      <span />
      <span />
    </span>
  );
}

export function Brand({
  compact = false,
  name = "BidLadder",
}: {
  compact?: boolean;
  name?: string;
}) {
  return (
    <Link aria-label={`${name} home`} className="brand" to="/">
      <LadderMark compact={compact} />
      <span>{name}</span>
    </Link>
  );
}
