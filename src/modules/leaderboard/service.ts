import { and, asc, desc, eq } from "drizzle-orm";

import { bids, ladders, placements, sponsors } from "../../../database/schema";
import { HttpProblem, isUniqueConstraintError } from "../../http/problem";
import type { Database } from "../../platform/d1/client";
import type { BidDecision, BidSubmission, PublicLeaderboard } from "./contracts";

function canonicalizeWebsite(value: string) {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }
  return {
    host: url.host,
    url: url.toString(),
  };
}

export async function getPublicLeaderboard(
  database: Database,
  slug: string,
): Promise<PublicLeaderboard> {
  const ladder = await database.query.ladders.findFirst({
    where: and(eq(ladders.slug, slug), eq(ladders.status, "active")),
  });

  if (!ladder) {
    throw new HttpProblem(404, "not_found", "Leaderboard not found.");
  }

  const rows = await database
    .select({
      amountCents: placements.amountCents,
      id: placements.id,
      logoUrl: sponsors.logoUrl,
      name: sponsors.name,
      publishedAt: placements.publishedAt,
      tagline: sponsors.tagline,
      websiteUrl: sponsors.websiteUrl,
    })
    .from(placements)
    .innerJoin(sponsors, eq(placements.sponsorId, sponsors.id))
    .where(and(eq(placements.ladderId, ladder.id), eq(placements.status, "active")))
    .orderBy(desc(placements.amountCents), asc(placements.publishedAt));

  return {
    ladder: {
      currency: ladder.currency,
      description: ladder.description,
      minimumBidCents: ladder.minimumBidCents,
      name: ladder.name,
      slug: ladder.slug,
    },
    placements: rows,
  };
}

export async function submitBid(
  database: Database,
  slug: string,
  input: BidSubmission,
  idempotencyKey: string,
) {
  if (idempotencyKey.length < 16 || idempotencyKey.length > 128) {
    throw new HttpProblem(
      400,
      "bad_request",
      "Idempotency-Key must contain between 16 and 128 characters.",
    );
  }

  const ladder = await database.query.ladders.findFirst({
    where: and(eq(ladders.slug, slug), eq(ladders.status, "active")),
  });
  if (!ladder) {
    throw new HttpProblem(404, "not_found", "Leaderboard not found.");
  }

  const amountCents = Math.round(input.amount * 100);
  if (amountCents < ladder.minimumBidCents) {
    throw new HttpProblem(
      400,
      "bad_request",
      `The minimum bid is ${(ladder.minimumBidCents / 100).toFixed(2)} ${ladder.currency}.`,
    );
  }

  const existingBid = await database.query.bids.findFirst({
    where: eq(bids.idempotencyKey, idempotencyKey),
  });
  if (existingBid) {
    return { bidId: existingBid.id, replayed: true, status: existingBid.status };
  }

  const website = canonicalizeWebsite(input.websiteUrl);
  const now = Date.now();
  const sponsorId = crypto.randomUUID();
  const [sponsor] = await database
    .insert(sponsors)
    .values({
      contactEmail: input.contactEmail.toLowerCase(),
      id: sponsorId,
      ladderId: ladder.id,
      logoUrl: input.logoUrl || null,
      name: input.name,
      tagline: input.tagline,
      updatedAt: now,
      websiteHost: website.host,
      websiteUrl: website.url,
    })
    .onConflictDoUpdate({
      target: [sponsors.ladderId, sponsors.websiteHost],
      set: {
        contactEmail: input.contactEmail.toLowerCase(),
        logoUrl: input.logoUrl || null,
        name: input.name,
        tagline: input.tagline,
        updatedAt: now,
        websiteUrl: website.url,
      },
    })
    .returning({ id: sponsors.id });

  if (!sponsor) {
    throw new Error("Sponsor upsert returned no row.");
  }

  const bidId = crypto.randomUUID();
  try {
    await database.insert(bids).values({
      amountCents,
      currency: ladder.currency,
      id: bidId,
      idempotencyKey,
      ladderId: ladder.id,
      sponsorId: sponsor.id,
      submittedAt: now,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HttpProblem(
        409,
        "conflict",
        "This sponsor already has a pending bid or the request was already submitted.",
      );
    }
    throw error;
  }

  return { bidId, replayed: false, status: "pending" as const };
}

export async function listBids(database: Database, status: "pending" | "approved" | "rejected") {
  return database
    .select({
      amountCents: bids.amountCents,
      contactEmail: sponsors.contactEmail,
      currency: bids.currency,
      id: bids.id,
      ladderName: ladders.name,
      logoUrl: sponsors.logoUrl,
      name: sponsors.name,
      status: bids.status,
      submittedAt: bids.submittedAt,
      tagline: sponsors.tagline,
      websiteUrl: sponsors.websiteUrl,
    })
    .from(bids)
    .innerJoin(sponsors, eq(bids.sponsorId, sponsors.id))
    .innerJoin(ladders, eq(bids.ladderId, ladders.id))
    .where(eq(bids.status, status))
    .orderBy(desc(bids.submittedAt));
}

export async function decideBid(database: Database, bidId: string, decision: BidDecision) {
  const [record] = await database
    .select({
      amountCents: bids.amountCents,
      id: bids.id,
      ladderId: bids.ladderId,
      sponsorId: bids.sponsorId,
      status: bids.status,
    })
    .from(bids)
    .where(eq(bids.id, bidId))
    .limit(1);

  if (!record) {
    throw new HttpProblem(404, "not_found", "Bid not found.");
  }
  if (record.status !== "pending") {
    if (record.status === decision) {
      return { bidId: record.id, status: record.status };
    }
    throw new HttpProblem(409, "conflict", `This bid is already ${record.status}.`);
  }

  const now = Date.now();
  if (decision === "rejected") {
    await database
      .update(bids)
      .set({ reviewedAt: now, status: "rejected" })
      .where(and(eq(bids.id, record.id), eq(bids.status, "pending")));
    return { bidId: record.id, status: "rejected" as const };
  }

  const placementId = crypto.randomUUID();
  await database.batch([
    database
      .update(bids)
      .set({ reviewedAt: now, status: "approved" })
      .where(and(eq(bids.id, record.id), eq(bids.status, "pending"))),
    database
      .insert(placements)
      .values({
        amountCents: record.amountCents,
        currentBidId: record.id,
        id: placementId,
        ladderId: record.ladderId,
        publishedAt: now,
        sponsorId: record.sponsorId,
        status: "active",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [placements.ladderId, placements.sponsorId],
        set: {
          amountCents: record.amountCents,
          currentBidId: record.id,
          publishedAt: now,
          status: "active",
          updatedAt: now,
        },
      }),
  ]);

  return { bidId: record.id, status: "approved" as const };
}
