import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const ladders = sqliteTable(
  "ladders",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    currency: text("currency").notNull().default("USD"),
    minimumBidCents: integer("minimum_bid_cents").notNull().default(1000),
    bidIncrementCents: integer("bid_increment_cents").notNull().default(100),
    reviewWindowBusinessDays: integer("review_window_business_days").notNull().default(3),
    refundInitiationBusinessDays: integer("refund_initiation_business_days").notNull().default(5),
    status: text("status", { enum: ["draft", "active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("ladders_slug_unique").on(table.slug),
    check("ladders_minimum_bid_positive", sql`${table.minimumBidCents} > 0`),
    check("ladders_bid_increment_positive", sql`${table.bidIncrementCents} > 0`),
    check("ladders_currency_iso_length", sql`length(${table.currency}) = 3`),
  ],
);

export const sponsors = sqliteTable(
  "sponsors",
  {
    id: text("id").primaryKey(),
    ladderId: text("ladder_id")
      .notNull()
      .references(() => ladders.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    websiteUrl: text("website_url").notNull(),
    websiteKey: text("website_host").notNull(),
    tagline: text("tagline").notNull(),
    logoUrl: text("logo_url"),
    contactEmail: text("contact_email").notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("sponsors_ladder_host_unique").on(table.ladderId, table.websiteKey),
    index("sponsors_ladder_idx").on(table.ladderId),
  ],
);

export const bids = sqliteTable(
  "bids",
  {
    id: text("id").primaryKey(),
    ladderId: text("ladder_id")
      .notNull()
      .references(() => ladders.id, { onDelete: "cascade" }),
    sponsorId: text("sponsor_id")
      .notNull()
      .references(() => sponsors.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    websiteUrl: text("website_url").notNull(),
    websiteKey: text("website_key").notNull(),
    tagline: text("tagline").notNull(),
    logoUrl: text("logo_url"),
    contactEmail: text("contact_email").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected"] })
      .notNull()
      .default("pending"),
    paymentStatus: text("payment_status", {
      enum: [
        "unpaid",
        "checkout_pending",
        "checkout_open",
        "processing",
        "paid",
        "partially_refunded",
        "refunded",
        "failed",
        "expired",
      ],
    })
      .notNull()
      .default("unpaid"),
    idempotencyKey: text("idempotency_key").notNull(),
    submittedAt: integer("submitted_at").notNull().default(sql`(unixepoch() * 1000)`),
    reviewedAt: integer("reviewed_at"),
    paidAt: integer("paid_at"),
    paymentUpdatedAt: integer("payment_updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("bids_idempotency_key_unique").on(table.idempotencyKey),
    uniqueIndex("bids_active_sponsor_unique")
      .on(table.ladderId, table.sponsorId)
      .where(
        sql`${table.status} = 'pending' AND ${table.paymentStatus} NOT IN ('refunded', 'failed', 'expired')`,
      ),
    index("bids_ladder_status_submitted_idx").on(table.ladderId, table.status, table.submittedAt),
    index("bids_sponsor_idx").on(table.sponsorId),
    index("bids_payment_status_idx").on(table.paymentStatus, table.paymentUpdatedAt),
    check("bids_amount_positive", sql`${table.amountCents} > 0`),
    check("bids_currency_iso_length", sql`length(${table.currency}) = 3`),
  ],
);

export const paymentAttempts = sqliteTable(
  "payment_attempts",
  {
    id: text("id").primaryKey(),
    bidId: text("bid_id")
      .notNull()
      .references(() => bids.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["stripe"] })
      .notNull()
      .default("stripe"),
    status: text("status", {
      enum: [
        "creating",
        "open",
        "processing",
        "paid",
        "partially_refunded",
        "refunded",
        "failed",
        "expired",
      ],
    })
      .notNull()
      .default("creating"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    providerCheckoutSessionId: text("provider_checkout_session_id"),
    providerPaymentIntentId: text("provider_payment_intent_id"),
    checkoutUrl: text("checkout_url"),
    expiresAt: integer("expires_at"),
    paidAt: integer("paid_at"),
    lastErrorCode: text("last_error_code"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("payment_attempts_checkout_session_unique").on(table.providerCheckoutSessionId),
    uniqueIndex("payment_attempts_payment_intent_unique").on(table.providerPaymentIntentId),
    uniqueIndex("payment_attempts_active_bid_unique")
      .on(table.bidId)
      .where(sql`${table.status} IN ('creating', 'open', 'processing')`),
    index("payment_attempts_bid_status_idx").on(table.bidId, table.status, table.createdAt),
    check("payment_attempts_amount_positive", sql`${table.amountCents} > 0`),
    check("payment_attempts_currency_iso_length", sql`length(${table.currency}) = 3`),
  ],
);

export const stripeEvents = sqliteTable(
  "stripe_events",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    livemode: integer("livemode", { mode: "boolean" }).notNull(),
    status: text("status", {
      enum: ["processing", "processed", "ignored", "failed", "quarantined"],
    })
      .notNull()
      .default("processing"),
    objectId: text("object_id"),
    paymentAttemptId: text("payment_attempt_id").references(() => paymentAttempts.id, {
      onDelete: "set null",
    }),
    failureCode: text("failure_code"),
    receivedAt: integer("received_at").notNull().default(sql`(unixepoch() * 1000)`),
    processedAt: integer("processed_at"),
  },
  (table) => [index("stripe_events_status_received_idx").on(table.status, table.receivedAt)],
);

export const paymentTransitions = sqliteTable(
  "payment_transitions",
  {
    id: text("id").primaryKey(),
    bidId: text("bid_id")
      .notNull()
      .references(() => bids.id, { onDelete: "cascade" }),
    paymentAttemptId: text("payment_attempt_id").references(() => paymentAttempts.id, {
      onDelete: "set null",
    }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    sourceType: text("source_type", {
      enum: ["checkout", "webhook", "reconciliation"],
    }).notNull(),
    sourceId: text("source_id").notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("payment_transitions_source_unique").on(
      table.sourceType,
      table.sourceId,
      table.toStatus,
    ),
    index("payment_transitions_bid_created_idx").on(table.bidId, table.createdAt),
  ],
);

export const placements = sqliteTable(
  "placements",
  {
    id: text("id").primaryKey(),
    ladderId: text("ladder_id")
      .notNull()
      .references(() => ladders.id, { onDelete: "cascade" }),
    sponsorId: text("sponsor_id")
      .notNull()
      .references(() => sponsors.id, { onDelete: "cascade" }),
    currentBidId: text("current_bid_id")
      .notNull()
      .references(() => bids.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    clickCount: integer("click_count").notNull().default(0),
    status: text("status", { enum: ["active", "paused"] })
      .notNull()
      .default("active"),
    publishedAt: integer("published_at").notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("placements_ladder_sponsor_unique").on(table.ladderId, table.sponsorId),
    uniqueIndex("placements_current_bid_unique").on(table.currentBidId),
    index("placements_public_rank_idx").on(table.ladderId, table.status, table.amountCents),
    check("placements_amount_positive", sql`${table.amountCents} > 0`),
  ],
);

export type Ladder = typeof ladders.$inferSelect;
export type Sponsor = typeof sponsors.$inferSelect;
export type Bid = typeof bids.$inferSelect;
export type Placement = typeof placements.$inferSelect;
export type PaymentAttempt = typeof paymentAttempts.$inferSelect;
export type StripeEvent = typeof stripeEvents.$inferSelect;
export type PaymentTransition = typeof paymentTransitions.$inferSelect;
