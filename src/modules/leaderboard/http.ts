import { Hono } from "hono";

import { requireAdmin } from "../../http/admin-auth";
import { readJson } from "../../http/body";
import { HttpProblem } from "../../http/problem";
import { enforceRateLimit, rateLimitKey, requestNetworkIdentity } from "../../http/rate-limit";
import { createDatabase } from "../../platform/d1/client";
import { bidSubmissionSchema, decisionSchema } from "./contracts";
import { decideBid, getPublicLeaderboard, listBids, submitBid } from "./service";

type ApiEnvironment = {
  Bindings: Env;
};

export function createLeaderboardApi() {
  const api = new Hono<ApiEnvironment>();

  api.get("/leaderboards/:slug", async (context) => {
    const database = createDatabase(context.env.DB);
    const result = await getPublicLeaderboard(database, context.req.param("slug"));
    return context.json({ data: result });
  });

  api.post("/leaderboards/:slug/bids", async (context) => {
    const parsed = bidSubmissionSchema.safeParse(await readJson(context.req.raw));
    if (!parsed.success) {
      throw new HttpProblem(
        400,
        "bad_request",
        parsed.error.issues[0]?.message ?? "Bid submission is invalid.",
      );
    }

    const networkIdentity = requestNetworkIdentity(context.req.raw);
    if (networkIdentity) {
      await enforceRateLimit(
        context.env.PUBLIC_WRITE_RATE_LIMITER,
        await rateLimitKey(`network:${networkIdentity}`),
      );
    }
    await enforceRateLimit(
      context.env.PUBLIC_WRITE_RATE_LIMITER,
      await rateLimitKey(
        `bid:${context.req.param("slug")}:${parsed.data.contactEmail.toLowerCase()}:${new URL(parsed.data.websiteUrl).hostname.toLowerCase()}`,
      ),
    );

    const idempotencyKey = context.req.header("Idempotency-Key") ?? "";
    const database = createDatabase(context.env.DB);
    const result = await submitBid(
      database,
      context.req.param("slug"),
      parsed.data,
      idempotencyKey,
    );
    return context.json({ data: result }, result.replayed ? 200 : 202);
  });

  api.use("/admin/*", async (context, next) => {
    const identity =
      requestNetworkIdentity(context.req.raw) ?? context.req.header("Authorization") ?? "none";
    await enforceRateLimit(context.env.ADMIN_RATE_LIMITER, await rateLimitKey(`admin:${identity}`));
    await requireAdmin(context.req.raw, context.env.ADMIN_API_KEY_HASH);
    await next();
  });

  api.get("/admin/bids", async (context) => {
    const status = context.req.query("status") ?? "pending";
    if (status !== "pending" && status !== "approved" && status !== "rejected") {
      throw new HttpProblem(400, "bad_request", "Unsupported bid status filter.");
    }
    const database = createDatabase(context.env.DB);
    return context.json({ data: await listBids(database, status) });
  });

  api.post("/admin/bids/:bidId/decision", async (context) => {
    const parsed = decisionSchema.safeParse(await readJson(context.req.raw));
    if (!parsed.success) {
      throw new HttpProblem(400, "bad_request", "Decision must be approved or rejected.");
    }
    const database = createDatabase(context.env.DB);
    const result = await decideBid(database, context.req.param("bidId"), parsed.data.decision);
    return context.json({ data: result });
  });

  return api;
}
