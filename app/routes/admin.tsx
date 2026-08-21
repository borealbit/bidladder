import { Link } from "react-router";

import { Brand } from "../components/brand";
import { AdminDashboard } from "../features/admin/admin-dashboard";
import type { Route } from "./+types/admin";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Review bids — BidLadder" }, { name: "robots", content: "noindex, nofollow" }];
}

export default function Admin() {
  return (
    <div className="admin-page page-frame">
      <header className="admin-header">
        <Brand />
        <Link to="/">← Back to leaderboard</Link>
      </header>
      <main>
        <div className="admin-title">
          <h1>Review bids</h1>
          <p>Approve the sponsors that belong on your ladder.</p>
        </div>
        <AdminDashboard />
      </main>
      <footer className="admin-footer">Admin access is protected by your deployment key.</footer>
    </div>
  );
}
