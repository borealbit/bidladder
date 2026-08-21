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

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link aria-label="BidLadder home" className="brand" to="/">
      <LadderMark compact={compact} />
      <span>BidLadder</span>
    </Link>
  );
}
