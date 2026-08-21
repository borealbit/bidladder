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
    status: text("status", { enum: ["draft", "active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("ladders_slug_unique").on(table.slug),
    check("ladders_minimum_bid_positive", sql`${table.minimumBidCents} > 0`),
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
    websiteHost: text("website_host").notNull(),
    tagline: text("tagline").notNull(),
    logoUrl: text("logo_url"),
    contactEmail: text("contact_email").notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("sponsors_ladder_host_unique").on(table.ladderId, table.websiteHost),
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
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected"] })
      .notNull()
      .default("pending"),
    idempotencyKey: text("idempotency_key").notNull(),
    submittedAt: integer("submitted_at").notNull().default(sql`(unixepoch() * 1000)`),
    reviewedAt: integer("reviewed_at"),
  },
  (table) => [
    uniqueIndex("bids_idempotency_key_unique").on(table.idempotencyKey),
    uniqueIndex("bids_pending_sponsor_unique")
      .on(table.ladderId, table.sponsorId)
      .where(sql`${table.status} = 'pending'`),
    index("bids_ladder_status_submitted_idx").on(table.ladderId, table.status, table.submittedAt),
    index("bids_sponsor_idx").on(table.sponsorId),
    check("bids_amount_positive", sql`${table.amountCents} > 0`),
    check("bids_currency_iso_length", sql`length(${table.currency}) = 3`),
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
