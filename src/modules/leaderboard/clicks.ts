import { and, eq, sql } from "drizzle-orm";
import { isbot } from "isbot";

import { placements, sponsors } from "../../../database/schema";
import { HttpProblem } from "../../http/problem";
import { rateLimitKey, requestNetworkIdentity } from "../../http/rate-limit";
import type { Database } from "../../platform/d1/client";

export async function shouldCountPlacementClick(
  request: Request,
  rateLimiter: RateLimit,
  placementId: string,
) {
  if (isbot(request.headers.get("User-Agent"))) {
    return false;
  }

  const networkIdentity = requestNetworkIdentity(request);
  if (!networkIdentity) {
    return true;
  }

  try {
    const outcome = await rateLimiter.limit({
      key: await rateLimitKey(`click:${placementId}:${networkIdentity}`),
    });
    return outcome.success;
  } catch (error) {
    console.error(
      JSON.stringify({
        cause: error instanceof Error ? error.name : "UnknownError",
        code: "click_rate_limit_unavailable",
        placementId,
      }),
    );
    return false;
  }
}

export async function recordPlacementClick(
  database: Database,
  placementId: string,
  countClick: boolean,
) {
  const [placement] = await database
    .select({ websiteUrl: sponsors.websiteUrl })
    .from(placements)
    .innerJoin(sponsors, eq(placements.sponsorId, sponsors.id))
    .where(and(eq(placements.id, placementId), eq(placements.status, "active")))
    .limit(1);

  if (!placement) {
    throw new HttpProblem(404, "not_found", "Placement not found.");
  }

  if (countClick) {
    await database
      .update(placements)
      .set({ clickCount: sql`${placements.clickCount} + 1` })
      .where(and(eq(placements.id, placementId), eq(placements.status, "active")));
  }

  return placement.websiteUrl;
}
