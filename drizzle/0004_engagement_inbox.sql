CREATE TABLE `engagement_inbox_accounts` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `brand_id` text NOT NULL,
  `platform` text NOT NULL,
  `provider_account_id` text NOT NULL,
  `status` text DEFAULT 'disabled' NOT NULL CHECK (`status` IN ('disabled', 'read_enabled')),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_engagement_inbox_account_ownership`
  ON `engagement_inbox_accounts` (`workspace_id`, `platform`, `provider_account_id`);
--> statement-breakpoint
CREATE INDEX `idx_engagement_inbox_account_brand`
  ON `engagement_inbox_accounts` (`workspace_id`, `brand_id`, `status`);
--> statement-breakpoint
CREATE TABLE `engagement_inbox_events` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `brand_id` text NOT NULL,
  `account_id` text NOT NULL,
  `platform` text NOT NULL,
  `kind` text NOT NULL CHECK (`kind` IN ('comment', 'dm')),
  `actor_key` text NOT NULL,
  `event_key` text NOT NULL,
  `category` text NOT NULL,
  `reply_text` text NOT NULL,
  `status` text DEFAULT 'pending_review' NOT NULL CHECK (`status` IN
    ('pending_review', 'approved_not_sent', 'rejected', 'suppressed')),
  `received_at` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_engagement_inbox_event_idempotency`
  ON `engagement_inbox_events` (`workspace_id`, `brand_id`, `account_id`, `event_key`);
--> statement-breakpoint
CREATE INDEX `idx_engagement_inbox_review`
  ON `engagement_inbox_events` (`workspace_id`, `brand_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE TABLE `engagement_inbox_suppressions` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `brand_id` text NOT NULL,
  `actor_key` text NOT NULL,
  `reason` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_engagement_inbox_suppression_actor`
  ON `engagement_inbox_suppressions` (`workspace_id`, `brand_id`, `actor_key`);
