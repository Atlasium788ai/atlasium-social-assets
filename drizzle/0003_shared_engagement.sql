CREATE TABLE `engagement_drafts` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `brand_id` text NOT NULL,
  `platform` text NOT NULL,
  `source_kind` text NOT NULL,
  `source_url` text NOT NULL,
  `context` text NOT NULL,
  `suggested_reply` text NOT NULL,
  `source_provenance` text NOT NULL,
  `identity_key` text NOT NULL,
  `status` text DEFAULT 'pending_review' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_engagement_draft_brand_identity`
  ON `engagement_drafts` (`workspace_id`,`brand_id`,`identity_key`);
--> statement-breakpoint
CREATE INDEX `idx_engagement_drafts_brand_status`
  ON `engagement_drafts` (`workspace_id`,`brand_id`,`status`,`created_at`);
