import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  displayName: text("display_name"),
  createdAt: text("created_at").notNull(),
});

export const workspaceMembers = sqliteTable("workspace_members", {
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_workspace_members_identity").on(table.workspaceId, table.userId),
]);

export const brands = sqliteTable("brands", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  website: text("website"),
  industry: text("industry"),
  location: text("location"),
  timezone: text("timezone").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_brands_workspace_slug").on(table.workspaceId, table.slug),
  index("idx_brands_workspace_status").on(table.workspaceId, table.status),
]);

export const brandProfiles = sqliteTable("brand_profiles", {
  brandId: text("brand_id").primaryKey(),
  whatItDoes: text("what_it_does").notNull().default(""),
  targetAudience: text("target_audience").notNull().default(""),
  mainOffers: text("main_offers").notNull().default(""),
  primaryCta: text("primary_cta").notNull().default(""),
  tone: text("tone").notNull().default(""),
  wordsUse: text("words_use").notNull().default(""),
  wordsAvoid: text("words_avoid").notNull().default(""),
  visualStyle: text("visual_style").notNull().default(""),
  instructions: text("instructions").notNull().default(""),
  routingRules: text("routing_rules").notNull().default("{}"),
  updatedAt: text("updated_at").notNull(),
});

export const brandAssets = sqliteTable("brand_assets", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  brandId: text("brand_id").notNull(),
  kind: text("kind").notNull(),
  url: text("url").notNull(),
  r2Key: text("r2_key").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_brand_assets_brand").on(table.brandId)]);

export const channelConnections = sqliteTable("channel_connections", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  brandId: text("brand_id").notNull(),
  provider: text("provider").notNull(),
  providerChannelId: text("provider_channel_id").notNull(),
  service: text("service").notNull(),
  accountName: text("account_name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  assignedAt: text("assigned_at").notNull(),
}, (table) => [
  uniqueIndex("idx_channel_provider_destination").on(table.provider, table.providerChannelId),
  index("idx_channel_brand_active").on(table.brandId, table.active),
]);

export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  brandId: text("brand_id").notNull(),
  r2Key: text("r2_key").notNull(),
  prompt: text("prompt").notNull().default(""),
  status: text("status").notNull(),
  timezone: text("timezone").notNull(),
  scheduleSummary: text("schedule_summary"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_campaigns_brand_updated").on(table.brandId, table.updatedAt)]);

export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  brandId: text("brand_id").notNull(),
  campaignId: text("campaign_id").notNull(),
  concept: text("concept").notNull(),
  itemIndex: integer("item_index").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_posts_campaign").on(table.campaignId, table.itemIndex)]);

export const mediaAssets = sqliteTable("media_assets", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  brandId: text("brand_id").notNull(),
  campaignId: text("campaign_id"),
  postId: text("post_id"),
  mediaType: text("media_type").notNull(),
  url: text("url").notNull(),
  r2Key: text("r2_key"),
  providerJobId: text("provider_job_id"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_media_assets_brand").on(table.brandId)]);

export const publishJobs = sqliteTable("publish_jobs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  brandId: text("brand_id").notNull(),
  campaignId: text("campaign_id").notNull(),
  postId: text("post_id").notNull(),
  destinationId: text("destination_id").notNull(),
  scheduledTime: text("scheduled_time").notNull(),
  provider: text("provider").notNull(),
  providerPostId: text("provider_post_id"),
  status: text("status").notNull(),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_publish_job_idempotency").on(table.brandId, table.campaignId, table.postId, table.destinationId, table.scheduledTime),
  index("idx_publish_jobs_campaign").on(table.campaignId),
]);

export const deliveryStatuses = sqliteTable("delivery_statuses", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  brandId: text("brand_id").notNull(),
  publishJobId: text("publish_job_id").notNull(),
  providerStatus: text("provider_status"),
  publicUrl: text("public_url"),
  error: text("error"),
  checkedAt: text("checked_at").notNull(),
}, (table) => [uniqueIndex("idx_delivery_publish_job").on(table.publishJobId)]);

export const brandDrafts = sqliteTable("brand_drafts", {
  brandId: text("brand_id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  prompt: text("prompt").notNull().default(""),
  timing: text("timing").notNull().default("auto"),
  selectedChannels: text("selected_channels").notNull().default("[]"),
  updatedAt: text("updated_at").notNull(),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  brandId: text("brand_id"),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  details: text("details").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_audit_workspace_created").on(table.workspaceId, table.createdAt)]);

export const advertisingAssets = sqliteTable("advertising_assets", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  brandId: text("brand_id").notNull(),
  sourceType: text("source_type").notNull(),
  label: text("label").notNull(),
  mediaType: text("media_type").notNull(),
  url: text("url").notNull(),
  r2Key: text("r2_key").notNull(),
  contentType: text("content_type").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_advertising_assets_brand_created").on(table.brandId, table.createdAt)]);

export const advertisingCampaignDrafts = sqliteTable("advertising_campaign_drafts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  brandId: text("brand_id").notNull(),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  status: text("status").notNull(),
  payload: text("payload").notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_advertising_drafts_brand_updated").on(table.brandId, table.updatedAt)]);

export const advertisingDryRuns = sqliteTable("advertising_dry_runs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  brandId: text("brand_id").notNull(),
  draftId: text("draft_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull(),
  result: text("result").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_advertising_dry_run_idempotency").on(table.brandId, table.idempotencyKey),
  index("idx_advertising_dry_runs_draft").on(table.draftId),
]);

export const advertisingStatusEvents = sqliteTable("advertising_status_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  brandId: text("brand_id").notNull(),
  draftId: text("draft_id").notNull(),
  providerId: text("provider_id"),
  status: text("status").notNull(),
  detail: text("detail").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_advertising_events_draft_created").on(table.draftId, table.createdAt)]);
