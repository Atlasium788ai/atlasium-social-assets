CREATE TABLE `advertising_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`source_type` text NOT NULL,
	`label` text NOT NULL,
	`media_type` text NOT NULL,
	`url` text NOT NULL,
	`r2_key` text NOT NULL,
	`content_type` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_advertising_assets_brand_created` ON `advertising_assets` (`brand_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `advertising_campaign_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_advertising_drafts_brand_updated` ON `advertising_campaign_drafts` (`brand_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `advertising_dry_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_advertising_dry_run_idempotency` ON `advertising_dry_runs` (`brand_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_advertising_dry_runs_draft` ON `advertising_dry_runs` (`draft_id`);--> statement-breakpoint
CREATE TABLE `advertising_status_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`provider_id` text,
	`status` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_advertising_events_draft_created` ON `advertising_status_events` (`draft_id`,`created_at`);