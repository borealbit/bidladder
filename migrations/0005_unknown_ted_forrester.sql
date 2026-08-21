ALTER TABLE `ladders` ADD `review_window_business_days` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `ladders` ADD `refund_initiation_business_days` integer DEFAULT 5 NOT NULL;