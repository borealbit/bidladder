ALTER TABLE `bids` ADD `name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `bids` ADD `website_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `bids` ADD `website_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `bids` ADD `tagline` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `bids` ADD `logo_url` text;--> statement-breakpoint
ALTER TABLE `bids` ADD `contact_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `bids`
SET
	`name` = (SELECT `name` FROM `sponsors` WHERE `sponsors`.`id` = `bids`.`sponsor_id`),
	`website_url` = (SELECT `website_url` FROM `sponsors` WHERE `sponsors`.`id` = `bids`.`sponsor_id`),
	`website_key` = (SELECT `website_host` FROM `sponsors` WHERE `sponsors`.`id` = `bids`.`sponsor_id`),
	`tagline` = (SELECT `tagline` FROM `sponsors` WHERE `sponsors`.`id` = `bids`.`sponsor_id`),
	`logo_url` = (SELECT `logo_url` FROM `sponsors` WHERE `sponsors`.`id` = `bids`.`sponsor_id`),
	`contact_email` = (SELECT `contact_email` FROM `sponsors` WHERE `sponsors`.`id` = `bids`.`sponsor_id`);--> statement-breakpoint
ALTER TABLE `ladders` ADD `bid_increment_cents` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ladders` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`minimum_bid_cents` integer DEFAULT 1000 NOT NULL,
	`bid_increment_cents` integer DEFAULT 100 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "ladders_minimum_bid_positive" CHECK("__new_ladders"."minimum_bid_cents" > 0),
	CONSTRAINT "ladders_bid_increment_positive" CHECK("__new_ladders"."bid_increment_cents" > 0),
	CONSTRAINT "ladders_currency_iso_length" CHECK(length("__new_ladders"."currency") = 3)
);
--> statement-breakpoint
INSERT INTO `__new_ladders`("id", "slug", "name", "description", "currency", "minimum_bid_cents", "bid_increment_cents", "status", "created_at", "updated_at") SELECT "id", "slug", "name", "description", "currency", "minimum_bid_cents", "bid_increment_cents", "status", "created_at", "updated_at" FROM `ladders`;--> statement-breakpoint
DROP TABLE `ladders`;--> statement-breakpoint
ALTER TABLE `__new_ladders` RENAME TO `ladders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `ladders_slug_unique` ON `ladders` (`slug`);
