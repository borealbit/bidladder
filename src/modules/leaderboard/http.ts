import { Hono } from "hono";

import { requireAdmin } from "../../http/admin-auth";
import { HttpProblem } from "../../http/problem";
import { createDatabase } from "../../platform/d1/client";
import { bidSubmissionSchema, decisionSchema } from "./contracts";
import { decideBid, getPublicLeaderboard, listBids, submitBid } from "./service";

type ApiEnvironment = {
  Bindings: Env;
};

async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpProblem(400, "bad_request", "Content-Type must be application/json.");
  }

  try {
    return await request.json();
  } catch {
    throw new HttpProblem(400, "bad_request", "Request body must contain valid JSON.");
  }
}

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
