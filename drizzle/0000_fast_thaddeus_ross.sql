CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`brand_id` text,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_workspace_created` ON `audit_logs` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `brand_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`kind` text NOT NULL,
	`url` text NOT NULL,
	`r2_key` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_brand_assets_brand` ON `brand_assets` (`brand_id`);--> statement-breakpoint
CREATE TABLE `brand_drafts` (
	`brand_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`prompt` text DEFAULT '' NOT NULL,
	`timing` text DEFAULT 'auto' NOT NULL,
	`selected_channels` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `brand_profiles` (
	`brand_id` text PRIMARY KEY NOT NULL,
	`what_it_does` text DEFAULT '' NOT NULL,
	`target_audience` text DEFAULT '' NOT NULL,
	`main_offers` text DEFAULT '' NOT NULL,
	`primary_cta` text DEFAULT '' NOT NULL,
	`tone` text DEFAULT '' NOT NULL,
	`words_use` text DEFAULT '' NOT NULL,
	`words_avoid` text DEFAULT '' NOT NULL,
	`visual_style` text DEFAULT '' NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`routing_rules` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `brands` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`logo_url` text,
	`website` text,
	`industry` text,
	`location` text,
	`timezone` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_brands_workspace_slug` ON `brands` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_brands_workspace_status` ON `brands` (`workspace_id`,`status`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`prompt` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`timezone` text NOT NULL,
	`schedule_summary` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_campaigns_brand_updated` ON `campaigns` (`brand_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `channel_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_channel_id` text NOT NULL,
	`service` text NOT NULL,
	`account_name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`assigned_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_channel_provider_destination` ON `channel_connections` (`provider`,`provider_channel_id`);--> statement-breakpoint
CREATE INDEX `idx_channel_brand_active` ON `channel_connections` (`brand_id`,`active`);--> statement-breakpoint
CREATE TABLE `delivery_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`publish_job_id` text NOT NULL,
	`provider_status` text,
	`public_url` text,
	`error` text,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_delivery_publish_job` ON `delivery_statuses` (`publish_job_id`);--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`campaign_id` text,
	`post_id` text,
	`media_type` text NOT NULL,
	`url` text NOT NULL,
	`r2_key` text,
	`provider_job_id` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_media_assets_brand` ON `media_assets` (`brand_id`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`concept` text NOT NULL,
	`item_index` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_posts_campaign` ON `posts` (`campaign_id`,`item_index`);--> statement-breakpoint
CREATE TABLE `publish_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`post_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`scheduled_time` text NOT NULL,
	`provider` text NOT NULL,
	`provider_post_id` text,
	`status` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_publish_job_idempotency` ON `publish_jobs` (`brand_id`,`campaign_id`,`post_id`,`destination_id`,`scheduled_time`);--> statement-breakpoint
CREATE INDEX `idx_publish_jobs_campaign` ON `publish_jobs` (`campaign_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`display_name` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workspace_members_identity` ON `workspace_members` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
PRAGMA optimize;
