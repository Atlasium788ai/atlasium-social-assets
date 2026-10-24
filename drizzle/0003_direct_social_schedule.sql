CREATE TABLE `scheduled_social_posts` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `brand_id` text NOT NULL,
  `campaign_id` text NOT NULL,
  `post_id` text NOT NULL,
  `channel_id` text NOT NULL,
  `service` text NOT NULL,
  `caption` text NOT NULL,
  `image_url` text NOT NULL,
  `due_at` text NOT NULL,
  `state` text DEFAULT 'pending' NOT NULL,
  `provider_post_id` text,
  `error` text,
  `attempted_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_direct_schedule_idempotency` ON `scheduled_social_posts` (`brand_id`,`campaign_id`,`post_id`,`channel_id`,`due_at`);
--> statement-breakpoint
CREATE INDEX `idx_direct_schedule_due` ON `scheduled_social_posts` (`state`,`due_at`);
