CREATE TABLE `payment_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`bid_id` text NOT NULL,
	`provider` text DEFAULT 'stripe' NOT NULL,
	`status` text DEFAULT 'creating' NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`provider_checkout_session_id` text,
	`provider_payment_intent_id` text,
	`checkout_url` text,
	`expires_at` integer,
	`paid_at` integer,
	`last_error_code` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`bid_id`) REFERENCES `bids`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payment_attempts_amount_positive" CHECK("payment_attempts"."amount_cents" > 0),
	CONSTRAINT "payment_attempts_currency_iso_length" CHECK(length("payment_attempts"."currency") = 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_attempts_checkout_session_unique` ON `payment_attempts` (`provider_checkout_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_attempts_payment_intent_unique` ON `payment_attempts` (`provider_payment_intent_id`);--> statement-breakpoint
CREATE INDEX `payment_attempts_bid_status_idx` ON `payment_attempts` (`bid_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `payment_transitions` (
	`id` text PRIMARY KEY NOT NULL,
	`bid_id` text NOT NULL,
	`payment_attempt_id` text,
	`from_status` text,
	`to_status` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`bid_id`) REFERENCES `bids`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_attempt_id`) REFERENCES `payment_attempts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_transitions_source_unique` ON `payment_transitions` (`source_type`,`source_id`,`to_status`);--> statement-breakpoint
CREATE INDEX `payment_transitions_bid_created_idx` ON `payment_transitions` (`bid_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `stripe_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`livemode` integer NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`object_id` text,
	`payment_attempt_id` text,
	`failure_code` text,
	`received_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`payment_attempt_id`) REFERENCES `payment_attempts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `stripe_events_status_received_idx` ON `stripe_events` (`status`,`received_at`);--> statement-breakpoint
DROP INDEX `bids_pending_sponsor_unique`;--> statement-breakpoint
ALTER TABLE `bids` ADD `payment_status` text DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
ALTER TABLE `bids` ADD `paid_at` integer;--> statement-breakpoint
ALTER TABLE `bids` ADD `payment_updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `bids_active_sponsor_unique` ON `bids` (`ladder_id`,`sponsor_id`) WHERE "bids"."status" = 'pending' AND "bids"."payment_status" NOT IN ('refunded', 'failed', 'expired');--> statement-breakpoint
CREATE INDEX `bids_payment_status_idx` ON `bids` (`payment_status`,`payment_updated_at`);