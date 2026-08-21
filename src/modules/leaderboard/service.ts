import { and, asc, desc, eq, sql } from "drizzle-orm";

import { bids, ladders, placements, sponsors } from "../../../database/schema";
import { HttpProblem, isUniqueConstraintError } from "../../http/problem";
import type { Database } from "../../platform/d1/client";
import type { BidDecision, BidSubmission, PublicLeaderboard } from "./contracts";

function canonicalizeWebsite(value: string) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/$/, "");
  }

  const appleAppId =
    url.hostname === "apps.apple.com" ? url.pathname.match(/\/id(\d+)/)?.[1] : null;
  const githubPath =
    url.hostname === "github.com"
      ? url.pathname
          .split("/")
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part.toLowerCase())
          .join("/")
      : null;

  return {
    host: url.host,
    key: appleAppId
      ? `apple:${appleAppId}`
      : githubPath
        ? `github:${githubPath}`
        : `url:${url.host}${url.pathname}`,
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
      clickCount: placements.clickCount,
      id: placements.id,
      logoUrl: sponsors.logoUrl,
      name: sponsors.name,
      publishedAt: placements.publishedAt,
      tagline: sponsors.tagline,
      updatedAt: placements.updatedAt,
      websiteUrl: sponsors.websiteUrl,
    })
    .from(placements)
    .innerJoin(sponsors, eq(placements.sponsorId, sponsors.id))
    .where(and(eq(placements.ladderId, ladder.id), eq(placements.status, "active")))
    .orderBy(desc(placements.amountCents), asc(placements.publishedAt));

  return {
    generatedAt: Date.now(),
    ladder: {
      bidIncrementCents: ladder.bidIncrementCents,
      currency: ladder.currency,
      description: ladder.description,
      minimumBidCents: ladder.minimumBidCents,
      name: ladder.name,
      refundInitiationBusinessDays: ladder.refundInitiationBusinessDays,
      reviewWindowBusinessDays: ladder.reviewWindowBusinessDays,
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
    return {
      bidId: existingBid.id,
      paymentStatus: existingBid.paymentStatus,
      replayed: true,
      status: existingBid.status,
    };
  }

  const website = canonicalizeWebsite(input.websiteUrl);
  const now = Date.now();
  const sponsorId = crypto.randomUUID();
  const [createdSponsor] = await database
    .insert(sponsors)
    .values({
      contactEmail: input.contactEmail.toLowerCase(),
      id: sponsorId,
      ladderId: ladder.id,
      logoUrl: input.logoUrl || null,
      name: input.name,
      tagline: input.tagline,
      updatedAt: now,
      websiteKey: website.key,
      websiteUrl: website.url,
    })
    .onConflictDoNothing()
    .returning({ id: sponsors.id, websiteKey: sponsors.websiteKey });

  let sponsor: { id: string; websiteKey: string } | undefined =
    createdSponsor ??
    (await database.query.sponsors.findFirst({
      where: and(eq(sponsors.ladderId, ladder.id), eq(sponsors.websiteKey, website.key)),
    }));

  sponsor ??= await database.query.sponsors.findFirst({
    where: and(eq(sponsors.ladderId, ladder.id), eq(sponsors.websiteKey, website.host)),
  });

  if (sponsor && sponsor.websiteKey !== website.key) {
    await database
      .update(sponsors)
      .set({ updatedAt: now, websiteKey: website.key })
      .where(eq(sponsors.id, sponsor.id));
  }

  if (!sponsor) {
    throw new Error("Sponsor upsert returned no row.");
  }

  const bidId = crypto.randomUUID();
  try {
    await database.insert(bids).values({
      amountCents,
      contactEmail: input.contactEmail.toLowerCase(),
      currency: ladder.currency,
      id: bidId,
      idempotencyKey,
      ladderId: ladder.id,
      logoUrl: input.logoUrl || null,
      name: input.name,
      paymentUpdatedAt: now,
      sponsorId: sponsor.id,
      submittedAt: now,
      tagline: input.tagline,
      websiteKey: website.key,
      websiteUrl: website.url,
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

  return {
    bidId,
    paymentStatus: "unpaid" as const,
    replayed: false,
    status: "pending" as const,
  };
}

export async function listBids(database: Database, status: "pending" | "approved" | "rejected") {
  return database
    .select({
      amountCents: bids.amountCents,
      contactEmail: bids.contactEmail,
      currency: bids.currency,
      id: bids.id,
      ladderName: ladders.name,
      logoUrl: bids.logoUrl,
      name: bids.name,
      paymentStatus: bids.paymentStatus,
      status: bids.status,
      submittedAt: bids.submittedAt,
      tagline: bids.tagline,
      websiteUrl: bids.websiteUrl,
    })
    .from(bids)
    .innerJoin(ladders, eq(bids.ladderId, ladders.id))
    .where(eq(bids.status, status))
    .orderBy(desc(bids.submittedAt));
}

export async function decideBid(database: Database, bidId: string, decision: BidDecision) {
  const [record] = await database
    .select({
      amountCents: bids.amountCents,
      contactEmail: bids.contactEmail,
      id: bids.id,
      ladderId: bids.ladderId,
      logoUrl: bids.logoUrl,
      name: bids.name,
      paymentStatus: bids.paymentStatus,
      sponsorId: bids.sponsorId,
      status: bids.status,
      tagline: bids.tagline,
      websiteKey: bids.websiteKey,
      websiteUrl: bids.websiteUrl,
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

  if (decision === "approved" && record.paymentStatus !== "paid") {
    throw new HttpProblem(409, "conflict", "Only a fully paid bid can be approved.");
  }

  const now = Date.now();
  if (decision === "rejected") {
    await database
      .update(bids)
      .set({ reviewedAt: now, status: "rejected" })
      .where(and(eq(bids.id, record.id), eq(bids.status, "pending")));
    return { bidId: record.id, status: "rejected" as const };
  }

  const currentPlacement = await database.query.placements.findFirst({
    where: and(
      eq(placements.ladderId, record.ladderId),
      eq(placements.sponsorId, record.sponsorId),
    ),
  });
  const lifetimeAmountCents = (currentPlacement?.amountCents ?? 0) + record.amountCents;
  const placementId = crypto.randomUUID();
  await database.batch([
    database
      .update(bids)
      .set({ reviewedAt: now, status: "approved" })
      .where(
        and(eq(bids.id, record.id), eq(bids.status, "pending"), eq(bids.paymentStatus, "paid")),
      ),
    database
      .update(sponsors)
      .set({
        contactEmail: record.contactEmail,
        logoUrl: record.logoUrl,
        name: record.name,
        tagline: record.tagline,
        updatedAt: now,
        websiteKey: record.websiteKey,
        websiteUrl: record.websiteUrl,
      })
      .where(eq(sponsors.id, record.sponsorId)),
    database
      .insert(placements)
      .select(
        database
          .select({
            id: sql<string>`${placementId}`.as("id"),
            ladderId: bids.ladderId,
            sponsorId: bids.sponsorId,
            currentBidId: bids.id,
            amountCents: sql<number>`${lifetimeAmountCents}`.as("amount_cents"),
            clickCount: sql<number>`0`.as("click_count"),
            status: sql<"active">`'active'`.as("status"),
            publishedAt: sql<number>`${now}`.as("published_at"),
            updatedAt: sql<number>`${now}`.as("updated_at"),
          })
          .from(bids)
          .where(
            and(
              eq(bids.id, record.id),
              eq(bids.status, "approved"),
              eq(bids.paymentStatus, "paid"),
            ),
          ),
      )
      .onConflictDoUpdate({
        target: [placements.ladderId, placements.sponsorId],
        set: {
          amountCents: lifetimeAmountCents,
          currentBidId: record.id,
          publishedAt: now,
          status: "active",
          updatedAt: now,
        },
      }),
  ]);

  const approved = await database.query.bids.findFirst({ where: eq(bids.id, record.id) });
  if (approved?.status !== "approved" || approved.paymentStatus !== "paid") {
    throw new HttpProblem(409, "conflict", "This bid is no longer eligible for approval.");
  }

  return { bidId: record.id, status: "approved" as const };
}
