CREATE TABLE `bids` (
	`id` text PRIMARY KEY NOT NULL,
	`ladder_id` text NOT NULL,
	`sponsor_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`idempotency_key` text NOT NULL,
	`submitted_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`reviewed_at` integer,
	FOREIGN KEY (`ladder_id`) REFERENCES `ladders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sponsor_id`) REFERENCES `sponsors`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "bids_amount_positive" CHECK("bids"."amount_cents" > 0),
	CONSTRAINT "bids_currency_iso_length" CHECK(length("bids"."currency") = 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bids_idempotency_key_unique` ON `bids` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `bids_pending_sponsor_unique` ON `bids` (`ladder_id`,`sponsor_id`) WHERE "bids"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `bids_ladder_status_submitted_idx` ON `bids` (`ladder_id`,`status`,`submitted_at`);--> statement-breakpoint
CREATE INDEX `bids_sponsor_idx` ON `bids` (`sponsor_id`);--> statement-breakpoint
CREATE TABLE `ladders` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`minimum_bid_cents` integer DEFAULT 1000 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "ladders_minimum_bid_positive" CHECK("ladders"."minimum_bid_cents" > 0),
	CONSTRAINT "ladders_currency_iso_length" CHECK(length("ladders"."currency") = 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ladders_slug_unique` ON `ladders` (`slug`);--> statement-breakpoint
CREATE TABLE `placements` (
	`id` text PRIMARY KEY NOT NULL,
	`ladder_id` text NOT NULL,
	`sponsor_id` text NOT NULL,
	`current_bid_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`published_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`ladder_id`) REFERENCES `ladders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sponsor_id`) REFERENCES `sponsors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_bid_id`) REFERENCES `bids`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "placements_amount_positive" CHECK("placements"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `placements_ladder_sponsor_unique` ON `placements` (`ladder_id`,`sponsor_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `placements_current_bid_unique` ON `placements` (`current_bid_id`);--> statement-breakpoint
CREATE INDEX `placements_public_rank_idx` ON `placements` (`ladder_id`,`status`,`amount_cents`);--> statement-breakpoint
CREATE TABLE `sponsors` (
	`id` text PRIMARY KEY NOT NULL,
	`ladder_id` text NOT NULL,
	`name` text NOT NULL,
	`website_url` text NOT NULL,
	`website_host` text NOT NULL,
	`tagline` text NOT NULL,
	`logo_url` text,
	`contact_email` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`ladder_id`) REFERENCES `ladders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sponsors_ladder_host_unique` ON `sponsors` (`ladder_id`,`website_host`);--> statement-breakpoint
CREATE INDEX `sponsors_ladder_idx` ON `sponsors` (`ladder_id`);--> statement-breakpoint
INSERT INTO `ladders` (`id`, `slug`, `name`, `description`, `currency`, `minimum_bid_cents`, `status`)
VALUES (
	'ladder_default',
	'main',
	'BidLadder',
	'A transparent, bid-powered sponsored leaderboard.',
	'USD',
	1000,
	'active'
)
ON CONFLICT (`slug`) DO NOTHING;
