import { data } from "react-router";

import { Brand } from "../components/brand";
import type { Route } from "./+types/not-found";

export function meta(): Route.MetaDescriptors {
  return [
    { title: "Page not found — BidLadder" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export function loader() {
  return data(null, { status: 404 });
}

export default function NotFound() {
  return (
    <main className="error-page page-frame">
      <Brand />
      <div>
        <p>404</p>
        <h1>This rung is missing.</h1>
        <p>The page you requested does not exist.</p>
        <a className="button button-primary" href="/">
          Return to the ladder
        </a>
      </div>
    </main>
  );
}
