import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { HttpProblem } from "../http/problem";
import type { WorkerExecutionContext } from "../http/react-router-context";
import { recordPlacementClick, shouldCountPlacementClick } from "../modules/leaderboard/clicks";
import { createLeaderboardApi } from "../modules/leaderboard/http";
import { createPaymentsApi } from "../modules/payments/http";
import { createDatabase } from "../platform/d1/client";

type ServerEnvironment = {
  Bindings: Env;
  Variables: {
    requestId: string;
  };
};

export type SsrHandler = (
  request: Request,
  environment: Env,
  executionContext: WorkerExecutionContext,
) => Promise<Response>;

export function createServer(ssrHandler: SsrHandler) {
  const app = new Hono<ServerEnvironment>();

  app.use("*", requestId());
  app.use(
    "*",
    secureHeaders({
      crossOriginResourcePolicy: "same-site",
      referrerPolicy: "strict-origin-when-cross-origin",
      strictTransportSecurity: "max-age=31536000; includeSubDomains",
      xContentTypeOptions: "nosniff",
      xFrameOptions: "DENY",
    }),
  );

  app.get("/health", (context) =>
    context.json({
      service: "bidladder",
      status: "ok",
      version: "0.1.0",
    }),
  );

  app.get("/robots.txt", (context) => {
    const origin = new URL(context.req.url).origin;
    return context.text(
      `User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${origin}/sitemap.xml\n`,
    );
  });

  app.get("/sitemap.xml", (context) => {
    const origin = new URL(context.req.url).origin;
    const pages = ["/", "/rules", "/deploy"]
      .map((path) => `<url><loc>${new URL(path, origin).href}</loc></url>`)
      .join("");
    return context.body(
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages}</urlset>`,
      200,
      { "Content-Type": "application/xml; charset=utf-8" },
    );
  });

  app.get("/go/:placementId", async (context) => {
    const placementId = context.req.param("placementId");
    const countClick = await shouldCountPlacementClick(
      context.req.raw,
      context.env.PUBLIC_WRITE_RATE_LIMITER,
      placementId,
    );
    const destination = await recordPlacementClick(
      createDatabase(context.env.DB),
      placementId,
      countClick,
    );
    context.header("Cache-Control", "private, no-store");
    context.header("X-Robots-Tag", "noindex, nofollow");
    return context.redirect(destination, 302);
  });

  app.route("/api/v1", createLeaderboardApi());
  app.route("/api/v1", createPaymentsApi());
  app.all("/api/*", (context) =>
    context.json(
      {
        error: {
          code: "not_found",
          message: "API route not found.",
          requestId: context.get("requestId"),
        },
      },
      404,
    ),
  );

  app.onError((error, context) => {
    const problem =
      error instanceof HttpProblem
        ? error
        : new HttpProblem(500, "internal_error", "An unexpected error occurred.");

    if (problem.status >= 500) {
      console.error(
        JSON.stringify({
          code: problem.code,
          cause: error instanceof Error ? error.name : "UnknownError",
          message: problem.message,
          requestId: context.get("requestId"),
        }),
      );
    }

    if (problem.status === 429) {
      context.header("Retry-After", "60");
    }

    return context.json(
      {
        error: {
          code: problem.code,
          message: problem.message,
          requestId: context.get("requestId"),
        },
      },
      problem.status as 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 503,
    );
  });

  app.all("*", (context) => ssrHandler(context.req.raw, context.env, context.executionCtx));

  return app;
}
