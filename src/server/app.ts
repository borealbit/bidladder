import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { HttpProblem } from "../http/problem";
import type { WorkerExecutionContext } from "../http/react-router-context";
import { createLeaderboardApi } from "../modules/leaderboard/http";

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
    const escapedOrigin = origin.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
    return context.body(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escapedOrigin}/</loc></url></urlset>`,
      200,
      { "Content-Type": "application/xml; charset=utf-8" },
    );
  });

  app.route("/api/v1", createLeaderboardApi());
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

    return context.json(
      {
        error: {
          code: problem.code,
          message: problem.message,
          requestId: context.get("requestId"),
        },
      },
      problem.status as 400 | 401 | 403 | 404 | 409 | 500 | 503,
    );
  });

  app.all("*", (context) => ssrHandler(context.req.raw, context.env, context.executionCtx));

  return app;
}
