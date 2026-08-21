import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { Route } from "./+types/root";
import { Brand } from "./components/brand";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600;700;800&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <meta content="#f5f3ee" name="theme-color" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;
  const details =
    import.meta.env.DEV && error instanceof Error
      ? error.message
      : isNotFound
        ? "The page you requested does not exist."
        : "The ladder hit an unexpected problem. Please try again.";

  return (
    <main className="error-page page-frame">
      <Brand />
      <div>
        <p>{isNotFound ? "404" : "Error"}</p>
        <h1>{isNotFound ? "This rung is missing." : "Something slipped."}</h1>
        <p>{details}</p>
        <a className="button button-primary" href="/">
          Return to the ladder
        </a>
      </div>
    </main>
  );
}
