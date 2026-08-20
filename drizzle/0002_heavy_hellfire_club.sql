CREATE TABLE `echo_content_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`content_type` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`prompt` text DEFAULT '' NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`featured_image_url` text,
	`source_draft_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_echo_content_brand_updated` ON `echo_content_drafts` (`brand_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_echo_content_brand_type_status` ON `echo_content_drafts` (`brand_id`,`content_type`,`status`);--> statement-breakpoint
CREATE TABLE `echo_content_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`operation` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_echo_revisions_draft_created` ON `echo_content_revisions` (`draft_id`,`created_at`);