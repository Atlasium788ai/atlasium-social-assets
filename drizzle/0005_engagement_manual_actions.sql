CREATE TABLE `engagement_manual_actions` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `brand_id` text NOT NULL,
  `draft_id` text NOT NULL,
  `platform` text NOT NULL,
  `confirmation_source` text NOT NULL DEFAULT 'self_reported',
  `confirmed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_engagement_manual_draft`
  ON `engagement_manual_actions` (`workspace_id`,`brand_id`,`draft_id`);
--> statement-breakpoint
CREATE INDEX `idx_engagement_manual_brand_date`
  ON `engagement_manual_actions` (`workspace_id`,`brand_id`,`confirmed_at`);
