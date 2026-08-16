export const WORKSPACE_ID = "workspace_atlasium";
export const OWNER_ID = "user_atlasium_owner";
export const ATLASIUM_BRAND_ID = "brand_atlasium_788_ai";

export type BufferDestination = {
  id: string;
  name?: string;
  displayName?: string;
  service: string;
  avatar?: string;
};

export type BrandProfileInput = {
  name: string;
  logoUrl?: string;
  website?: string;
  industry?: string;
  location?: string;
  timezone: string;
  whatItDoes?: string;
  targetAudience?: string;
  mainOffers?: string;
  primaryCta?: string;
  tone?: string;
  wordsUse?: string;
  wordsAvoid?: string;
  visualStyle?: string;
  instructions?: string;
  routingRules?: string;
  channelIds: string[];
};

export type BrandContext = BrandProfileInput & {
  id: string;
  workspaceId: string;
  slug: string;
  status: string;
  channels: BufferDestination[];
  draft?: { prompt: string; timing: string; selectedChannels: string[]; updatedAt: string };
};

type StoreEnv = {
  DB?: D1Database;
  UPLOADS: R2Bucket;
};

type CampaignIndexRecord = {
  id: string;
  brandId: string;
  workspaceId: string;
  prompt: string;
  timeZone: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  schedule?: { timing?: { label?: string } };
  items?: Array<{ id: string; itemIndex: number; concept: string; state: string; imageUrl?: string; hostedMediaUrl?: string; mediaType?: string; videoJobId?: string }>;
  results?: Array<{ id: string; itemId: string; channelId: string; status: string; postId?: string; bufferStatus?: string; externalLink?: string; error?: string }>;
};

const nowIso = () => new Date().toISOString();
const rowList = <T>(result: D1Result<T>) => result.results || [];
const value = (input: unknown) => String(input || "").trim();

function slugify(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || `brand-${crypto.randomUUID().slice(0, 8)}`;
}

function atlasiumChannel(channel: BufferDestination) {
  const service = channel.service.toLowerCase();
  const label = `${channel.displayName || ""} ${channel.name || ""}`.toLowerCase();
  if (service === "instagram") return label.includes("atlasium788ai");
  if (service === "tiktok") return label.includes("atlasium.788.ai") || label.includes("atlasium788ai");
  if (service === "facebook") return label.includes("atlasium");
  if (service === "linkedin") return label.includes("atlasium") || label.includes("blair ryan barton") || label.includes("personal");
  return false;
}

export async function ensureBrandSystem(env: StoreEnv) {
  if (!env.DB) return;
  const createdAt = nowIso();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, ?, ?)").bind(WORKSPACE_ID, "EchoFlow Social", createdAt),
    env.DB.prepare("INSERT OR IGNORE INTO users (id, email, display_name, created_at) VALUES (?, NULL, ?, ?)").bind(OWNER_ID, "Atlasium owner", createdAt),
    env.DB.prepare("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)").bind(WORKSPACE_ID, OWNER_ID, "owner", createdAt),
    env.DB.prepare("INSERT OR IGNORE INTO brands (id, workspace_id, slug, name, logo_url, website, industry, location, timezone, status, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'active', ?, ?)")
      .bind(ATLASIUM_BRAND_ID, WORKSPACE_ID, "atlasium-7-88-ai", "Atlasium 7/88 AI", "https://atlasium.ca", "AI revenue systems", "Toronto, Ontario", "America/Toronto", createdAt, createdAt),
    env.DB.prepare("INSERT OR IGNORE INTO brand_profiles (brand_id, what_it_does, target_audience, main_offers, primary_cta, tone, words_use, words_avoid, visual_style, instructions, routing_rules, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(ATLASIUM_BRAND_ID, "Builds practical AI-powered revenue and follow-up systems for businesses.", "Business owners and operators", "Revenue systems, automation and assessments", "Start a conversation with Atlasium", "Intelligent, direct, premium and modern", "clear, practical, revenue system", "generic AI hype, motivational fluff, cheesy slogans, unnecessary em dashes", "Dark, premium, black and gold, modern, clean", "Preserve facts. Never invent offers, proof, personal stories or claims.", JSON.stringify({ includePersonalLinkedIn: true, preferCompanyLinkedIn: true, tiktokRequiresCompatibleMedia: true }), createdAt),
  ]);
  await migrateLegacyCampaigns(env);
}

async function migrateLegacyCampaigns(env: StoreEnv) {
  if (!env.DB || typeof env.UPLOADS.list !== "function") return;
  const already = await env.DB.prepare("SELECT id FROM audit_logs WHERE workspace_id = ? AND action = ? LIMIT 1").bind(WORKSPACE_ID, "legacy_campaign_migration_complete").first();
  if (already) return;
  let cursor: string | undefined;
  let migrated = 0;
  do {
    const page = await env.UPLOADS.list({ prefix: ".atlasium-campaigns/", ...(cursor ? { cursor } : {}) });
    for (const object of page.objects) {
      const stored = await env.UPLOADS.get(object.key);
      if (!stored) continue;
      try {
        const campaign = await new Response(stored.body).json() as Partial<CampaignIndexRecord>;
        const id = value(campaign.id) || object.key.slice(object.key.lastIndexOf("/") + 1).replace(/\.json$/, "");
        const createdAt = value(campaign.createdAt) || nowIso();
        const updatedAt = value(campaign.updatedAt) || createdAt;
        await env.DB.prepare("INSERT OR IGNORE INTO campaigns (id, workspace_id, brand_id, r2_key, prompt, status, timezone, schedule_summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(id, WORKSPACE_ID, ATLASIUM_BRAND_ID, object.key, value(campaign.prompt), value(campaign.message) || "preserved", value(campaign.timeZone) || "America/Toronto", value(campaign.schedule?.timing?.label), createdAt, updatedAt).run();
        migrated += 1;
      } catch {
        // Invalid legacy metadata stays untouched in R2 and is never resubmitted.
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  await audit(env, ATLASIUM_BRAND_ID, "legacy_campaign_migration_complete", { migrated, source: ".atlasium-campaigns", publishingTriggered: false });
}

export async function syncAtlasiumChannels(env: StoreEnv, channels: BufferDestination[]) {
  if (!env.DB) return;
  const assignedAt = nowIso();
  for (const channel of channels.filter(atlasiumChannel)) {
    await env.DB.prepare("INSERT OR IGNORE INTO channel_connections (id, workspace_id, brand_id, provider, provider_channel_id, service, account_name, active, assigned_at) VALUES (?, ?, ?, 'buffer', ?, ?, ?, 1, ?)")
      .bind(`channel_buffer_${channel.id}`, WORKSPACE_ID, ATLASIUM_BRAND_ID, channel.id, channel.service.toLowerCase(), channel.displayName || channel.name || channel.id, assignedAt).run();
  }
}

function brandFromRow(row: Record<string, unknown>, channels: BufferDestination[] = []): BrandContext {
  let selectedChannels: string[] = [];
  try { selectedChannels = JSON.parse(value(row.draft_selected_channels) || "[]"); } catch { selectedChannels = []; }
  return {
    id: value(row.id),
    workspaceId: value(row.workspace_id),
    slug: value(row.slug),
    name: value(row.name),
    logoUrl: value(row.logo_url),
    website: value(row.website),
    industry: value(row.industry),
    location: value(row.location),
    timezone: value(row.timezone) || "America/Toronto",
    status: value(row.status),
    whatItDoes: value(row.what_it_does),
    targetAudience: value(row.target_audience),
    mainOffers: value(row.main_offers),
    primaryCta: value(row.primary_cta),
    tone: value(row.tone),
    wordsUse: value(row.words_use),
    wordsAvoid: value(row.words_avoid),
    visualStyle: value(row.visual_style),
    instructions: value(row.instructions),
    routingRules: value(row.routing_rules),
    channelIds: channels.map((channel) => channel.id),
    channels,
    draft: row.draft_updated_at ? { prompt: value(row.draft_prompt), timing: value(row.draft_timing) || "auto", selectedChannels, updatedAt: value(row.draft_updated_at) } : undefined,
  };
}

const brandSelect = `SELECT b.*, p.what_it_does, p.target_audience, p.main_offers, p.primary_cta, p.tone, p.words_use, p.words_avoid, p.visual_style, p.instructions, p.routing_rules,
  d.prompt AS draft_prompt, d.timing AS draft_timing, d.selected_channels AS draft_selected_channels, d.updated_at AS draft_updated_at
  FROM brands b JOIN brand_profiles p ON p.brand_id = b.id LEFT JOIN brand_drafts d ON d.brand_id = b.id`;

export async function getBrand(env: StoreEnv, brandId: string): Promise<BrandContext | null> {
  if (!env.DB) return brandId && brandId !== ATLASIUM_BRAND_ID ? null : legacyAtlasium();
  await ensureBrandSystem(env);
  const membership = await env.DB.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ? LIMIT 1").bind(WORKSPACE_ID, OWNER_ID).first<Record<string, unknown>>();
  if (!membership) return null;
  const row = await env.DB.prepare(`${brandSelect} WHERE b.id = ? AND b.workspace_id = ? LIMIT 1`).bind(brandId, WORKSPACE_ID).first<Record<string, unknown>>();
  if (!row) return null;
  const channelRows = rowList(await env.DB.prepare("SELECT provider_channel_id AS id, service, account_name AS displayName FROM channel_connections WHERE brand_id = ? AND active = 1 ORDER BY service, account_name").bind(brandId).all<Record<string, unknown>>());
  return brandFromRow(row, channelRows.map((channel) => ({ id: value(channel.id), service: value(channel.service), displayName: value(channel.displayName) })));
}

export async function requireBrand(env: StoreEnv, brandId?: string | null) {
  const id = value(brandId) || ATLASIUM_BRAND_ID;
  const brand = await getBrand(env, id);
  if (!brand || brand.status !== "active") throw new Error("This brand is unavailable or you do not have access.");
  return brand;
}

export async function workspaceSnapshot(env: StoreEnv, connected: BufferDestination[]) {
  if (!env.DB) {
    const brand = legacyAtlasium();
    brand.channels = connected;
    brand.channelIds = connected.map((channel) => channel.id);
    return { workspace: { id: WORKSPACE_ID, name: "EchoFlow Social", role: "owner" }, brands: [brand], connectedChannels: connected.map((channel) => ({ ...channel, assignedBrandId: ATLASIUM_BRAND_ID, assignedBrandName: brand.name })), publishingProviders: providerFlags(), migration: { legacyCampaignsPreserved: true } };
  }
  await ensureBrandSystem(env);
  await syncAtlasiumChannels(env, connected);
  const brandRows = rowList(await env.DB.prepare(`${brandSelect} WHERE b.workspace_id = ? AND b.status != 'archived' ORDER BY CASE WHEN b.id = ? THEN 0 ELSE 1 END, b.created_at`).bind(WORKSPACE_ID, ATLASIUM_BRAND_ID).all<Record<string, unknown>>());
  const channelRows = rowList(await env.DB.prepare("SELECT c.provider_channel_id AS id, c.service, c.account_name AS displayName, c.brand_id, b.name AS brand_name FROM channel_connections c JOIN brands b ON b.id = c.brand_id WHERE c.workspace_id = ? AND c.active = 1").bind(WORKSPACE_ID).all<Record<string, unknown>>());
  const brands = brandRows.map((row) => {
    const channels = channelRows.filter((channel) => value(channel.brand_id) === value(row.id)).map((channel) => ({ id: value(channel.id), service: value(channel.service), displayName: value(channel.displayName) }));
    return brandFromRow(row, channels);
  });
  const connectionMap = new Map(channelRows.map((row) => [value(row.id), row]));
  const connectedChannels = connected.map((channel) => {
    const assignment = connectionMap.get(channel.id);
    return { ...channel, assignedBrandId: assignment ? value(assignment.brand_id) : null, assignedBrandName: assignment ? value(assignment.brand_name) : null };
  });
  const recentCampaigns = rowList(await env.DB.prepare("SELECT id, brand_id AS brandId, prompt, status, timezone AS timeZone, schedule_summary AS scheduleSummary, created_at AS createdAt, updated_at AS updatedAt FROM campaigns WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 30").bind(WORKSPACE_ID).all<Record<string, unknown>>());
  return { workspace: { id: WORKSPACE_ID, name: "EchoFlow Social", role: "owner" }, brands, connectedChannels, recentCampaigns, publishingProviders: providerFlags(), migration: { legacyCampaignsPreserved: true } };
}

export async function createBrand(env: StoreEnv, input: BrandProfileInput, connected: BufferDestination[], logo?: { url: string; r2Key: string } | null, brandId?: string) {
  if (!env.DB) throw new Error("Brand storage is not available yet.");
  await ensureBrandSystem(env);
  const name = value(input.name).slice(0, 100);
  if (!name) throw new Error("Enter the brand name.");
  const channelIds = [...new Set(input.channelIds.map(value).filter(Boolean))];
  if (!channelIds.length) throw new Error("Assign at least one social destination before creating the brand.");
  const selected = connected.filter((channel) => channelIds.includes(channel.id));
  if (selected.length !== channelIds.length) throw new Error("One or more selected social destinations are unavailable.");
  for (const channel of selected) {
    const assigned = await env.DB.prepare("SELECT brand_id FROM channel_connections WHERE provider = 'buffer' AND provider_channel_id = ? AND active = 1 LIMIT 1").bind(channel.id).first<Record<string, unknown>>();
    if (assigned) throw new Error(`${channel.displayName || channel.name || channel.id} is already assigned to another brand.`);
  }
  const id = brandId || `brand_${crypto.randomUUID()}`;
  const createdAt = nowIso();
  const slug = `${slugify(name)}-${id.slice(-6)}`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO brands (id, workspace_id, slug, name, logo_url, website, industry, location, timezone, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)")
      .bind(id, WORKSPACE_ID, slug, name, logo?.url || value(input.logoUrl), value(input.website), value(input.industry), value(input.location), value(input.timezone) || "America/Toronto", createdAt, createdAt),
    env.DB.prepare("INSERT INTO brand_profiles (brand_id, what_it_does, target_audience, main_offers, primary_cta, tone, words_use, words_avoid, visual_style, instructions, routing_rules, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, value(input.whatItDoes), value(input.targetAudience), value(input.mainOffers), value(input.primaryCta), value(input.tone), value(input.wordsUse), value(input.wordsAvoid), value(input.visualStyle), value(input.instructions), value(input.routingRules) || "{}", createdAt),
    ...selected.map((channel) => env.DB!.prepare("INSERT INTO channel_connections (id, workspace_id, brand_id, provider, provider_channel_id, service, account_name, active, assigned_at) VALUES (?, ?, ?, 'buffer', ?, ?, ?, 1, ?)")
      .bind(`channel_buffer_${channel.id}`, WORKSPACE_ID, id, channel.id, channel.service.toLowerCase(), channel.displayName || channel.name || channel.id, createdAt)),
    ...(logo ? [env.DB.prepare("INSERT INTO brand_assets (id, workspace_id, brand_id, kind, url, r2_key, created_at) VALUES (?, ?, ?, 'logo', ?, ?, ?)").bind(`asset_${crypto.randomUUID()}`, WORKSPACE_ID, id, logo.url, logo.r2Key, createdAt)] : []),
  ]);
  await audit(env, id, "brand_created", { name, channelIds, logoUploaded: Boolean(logo) });
  return requireBrand(env, id);
}

export async function updateBrand(env: StoreEnv, brandId: string, input: BrandProfileInput, connected: BufferDestination[], logo?: { url: string; r2Key: string } | null) {
  if (!env.DB) throw new Error("Brand storage is not available yet.");
  await requireBrand(env, brandId);
  const name = value(input.name).slice(0, 100);
  const channelIds = [...new Set(input.channelIds.map(value).filter(Boolean))];
  if (!name) throw new Error("Enter the brand name.");
  if (!channelIds.length) throw new Error("Keep at least one social destination assigned to this brand.");
  const selected = connected.filter((channel) => channelIds.includes(channel.id));
  if (selected.length !== channelIds.length) throw new Error("One or more selected social destinations are unavailable.");
  for (const channel of selected) {
    const assigned = await env.DB.prepare("SELECT brand_id FROM channel_connections WHERE provider = 'buffer' AND provider_channel_id = ? AND active = 1 LIMIT 1").bind(channel.id).first<Record<string, unknown>>();
    if (assigned && value(assigned.brand_id) !== brandId) throw new Error(`${channel.displayName || channel.name || channel.id} is already assigned to another brand.`);
  }
  const updatedAt = nowIso();
  const statements = [
    env.DB.prepare("UPDATE brands SET name = ?, logo_url = COALESCE(?, logo_url), website = ?, industry = ?, location = ?, timezone = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
      .bind(name, logo?.url || value(input.logoUrl) || null, value(input.website), value(input.industry), value(input.location), value(input.timezone) || "America/Toronto", updatedAt, brandId, WORKSPACE_ID),
    env.DB.prepare("UPDATE brand_profiles SET what_it_does = ?, target_audience = ?, main_offers = ?, primary_cta = ?, tone = ?, words_use = ?, words_avoid = ?, visual_style = ?, instructions = ?, routing_rules = ?, updated_at = ? WHERE brand_id = ?")
      .bind(value(input.whatItDoes), value(input.targetAudience), value(input.mainOffers), value(input.primaryCta), value(input.tone), value(input.wordsUse), value(input.wordsAvoid), value(input.visualStyle), value(input.instructions), value(input.routingRules) || "{}", updatedAt, brandId),
    env.DB.prepare("UPDATE channel_connections SET active = 0 WHERE brand_id = ? AND provider = 'buffer'").bind(brandId),
    ...selected.map((channel) => env.DB!.prepare("INSERT INTO channel_connections (id, workspace_id, brand_id, provider, provider_channel_id, service, account_name, active, assigned_at) VALUES (?, ?, ?, 'buffer', ?, ?, ?, 1, ?) ON CONFLICT(provider, provider_channel_id) DO UPDATE SET active = 1, account_name = excluded.account_name, service = excluded.service")
      .bind(`channel_buffer_${channel.id}`, WORKSPACE_ID, brandId, channel.id, channel.service.toLowerCase(), channel.displayName || channel.name || channel.id, updatedAt)),
    ...(logo ? [env.DB.prepare("INSERT INTO brand_assets (id, workspace_id, brand_id, kind, url, r2_key, created_at) VALUES (?, ?, ?, 'logo', ?, ?, ?)").bind(`asset_${crypto.randomUUID()}`, WORKSPACE_ID, brandId, logo.url, logo.r2Key, updatedAt)] : []),
  ];
  await env.DB.batch(statements);
  await audit(env, brandId, "brand_updated", { name, channelIds, logoUploaded: Boolean(logo) });
  return requireBrand(env, brandId);
}

export async function saveDraft(env: StoreEnv, brandId: string, draft: { prompt: string; timing: string; selectedChannels: string[] }) {
  if (!env.DB) return;
  await requireBrand(env, brandId);
  await env.DB.prepare("INSERT INTO brand_drafts (brand_id, workspace_id, prompt, timing, selected_channels, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(brand_id) DO UPDATE SET prompt = excluded.prompt, timing = excluded.timing, selected_channels = excluded.selected_channels, updated_at = excluded.updated_at")
    .bind(brandId, WORKSPACE_ID, draft.prompt.slice(0, 4000), draft.timing, JSON.stringify(draft.selectedChannels), nowIso()).run();
}

export async function indexCampaign(env: StoreEnv, campaign: CampaignIndexRecord, r2Key: string) {
  if (!env.DB) return;
  const status = campaign.results?.some((result) => result.status === "FAILED") ? "failed" : campaign.results?.some((result) => ["PROCESSING MOTION", "SCHEDULING"].includes(result.status)) ? "processing" : campaign.message || "scheduled";
  const statements = [
    env.DB.prepare("INSERT INTO campaigns (id, workspace_id, brand_id, r2_key, prompt, status, timezone, schedule_summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at")
      .bind(campaign.id, campaign.workspaceId, campaign.brandId, r2Key, campaign.prompt, status, campaign.timeZone, campaign.schedule?.timing?.label || "", campaign.createdAt, campaign.updatedAt),
    ...(campaign.items || []).map((item) => env.DB!.prepare("INSERT INTO posts (id, workspace_id, brand_id, campaign_id, concept, item_index, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at")
      .bind(item.id, campaign.workspaceId, campaign.brandId, campaign.id, item.concept, item.itemIndex, item.state, campaign.createdAt, campaign.updatedAt)),
    ...(campaign.items || []).filter((item) => item.imageUrl).map((item) => env.DB!.prepare("INSERT INTO media_assets (id, workspace_id, brand_id, campaign_id, post_id, media_type, url, r2_key, provider_job_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'image', ?, ?, NULL, ?, ?) ON CONFLICT(id) DO UPDATE SET url = excluded.url, status = excluded.status")
      .bind(`media_${item.id}_image`, campaign.workspaceId, campaign.brandId, campaign.id, item.id, item.imageUrl, mediaKey(item.imageUrl!), item.state, campaign.createdAt)),
    ...(campaign.items || []).filter((item) => item.hostedMediaUrl && item.hostedMediaUrl !== item.imageUrl).map((item) => env.DB!.prepare("INSERT INTO media_assets (id, workspace_id, brand_id, campaign_id, post_id, media_type, url, r2_key, provider_job_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET url = excluded.url, provider_job_id = excluded.provider_job_id, status = excluded.status")
      .bind(`media_${item.id}_motion`, campaign.workspaceId, campaign.brandId, campaign.id, item.id, item.mediaType || "video", item.hostedMediaUrl, mediaKey(item.hostedMediaUrl!), item.videoJobId || null, item.state, campaign.createdAt)),
  ];
  await env.DB.batch(statements);
}

function mediaKey(url: string) {
  try { const parsed = new URL(url); return decodeURIComponent(parsed.pathname.replace(/^\/i\//, "")); }
  catch { return ""; }
}

export async function campaignOwner(env: StoreEnv, campaignId: string) {
  if (!env.DB) return ATLASIUM_BRAND_ID;
  await ensureBrandSystem(env);
  const row = await env.DB.prepare("SELECT brand_id FROM campaigns WHERE id = ? AND workspace_id = ? LIMIT 1").bind(campaignId, WORKSPACE_ID).first<Record<string, unknown>>();
  return row ? value(row.brand_id) : null;
}

export async function reservePublishJob(env: StoreEnv, input: { id: string; brandId: string; campaignId: string; postId: string; destinationId: string; scheduledTime: string; provider: string }) {
  if (!env.DB) return true;
  const createdAt = nowIso();
  const result = await env.DB.prepare("INSERT OR IGNORE INTO publish_jobs (id, workspace_id, brand_id, campaign_id, post_id, destination_id, scheduled_time, provider, provider_post_id, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'submitting', NULL, ?, ?)")
    .bind(input.id, WORKSPACE_ID, input.brandId, input.campaignId, input.postId, input.destinationId, input.scheduledTime, input.provider, createdAt, createdAt).run();
  return Number(result.meta?.changes || 0) > 0;
}

export async function finishPublishJob(env: StoreEnv, id: string, status: string, providerPostId?: string | null, error?: string | null) {
  if (!env.DB) return;
  await env.DB.prepare("UPDATE publish_jobs SET status = ?, provider_post_id = COALESCE(?, provider_post_id), error = ?, updated_at = ? WHERE id = ?")
    .bind(status, providerPostId || null, error || null, nowIso(), id).run();
}

export async function recordDelivery(env: StoreEnv, input: { publishJobId: string; brandId: string; providerStatus?: string | null; publicUrl?: string | null; error?: string | null }) {
  if (!env.DB) return;
  await env.DB.prepare("INSERT INTO delivery_statuses (id, workspace_id, brand_id, publish_job_id, provider_status, public_url, error, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(publish_job_id) DO UPDATE SET provider_status = excluded.provider_status, public_url = excluded.public_url, error = excluded.error, checked_at = excluded.checked_at")
    .bind(`delivery_${input.publishJobId}`, WORKSPACE_ID, input.brandId, input.publishJobId, input.providerStatus || null, input.publicUrl || null, input.error || null, nowIso()).run();
}

export async function archiveBrand(env: StoreEnv, brandId: string) {
  if (!env.DB) throw new Error("Brand storage is not available yet.");
  if (brandId === ATLASIUM_BRAND_ID) throw new Error("The default Atlasium brand cannot be archived.");
  await requireBrand(env, brandId);
  await env.DB.prepare("UPDATE brands SET status = 'archived', updated_at = ? WHERE id = ? AND workspace_id = ?").bind(nowIso(), brandId, WORKSPACE_ID).run();
  await audit(env, brandId, "brand_archived", { hardDelete: false });
}

export async function audit(env: StoreEnv, brandId: string | null, action: string, details: Record<string, unknown>) {
  if (!env.DB) return;
  await env.DB.prepare("INSERT INTO audit_logs (id, workspace_id, brand_id, actor_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(`audit_${crypto.randomUUID()}`, WORKSPACE_ID, brandId, OWNER_ID, action, JSON.stringify(details), nowIso()).run();
}

function providerFlags() {
  return [
    { id: "buffer", name: "Buffer", status: "ACTIVE" },
    { id: "meta-direct", name: "Facebook & Instagram direct", status: "APPROVAL PENDING" },
    { id: "linkedin-direct", name: "LinkedIn direct", status: "APPROVAL PENDING" },
    { id: "tiktok-direct", name: "TikTok direct", status: "APPROVAL PENDING" },
  ];
}

function legacyAtlasium(): BrandContext {
  return {
    id: ATLASIUM_BRAND_ID,
    workspaceId: WORKSPACE_ID,
    slug: "atlasium-7-88-ai",
    name: "Atlasium 7/88 AI",
    website: "https://atlasium.ca",
    industry: "AI revenue systems",
    location: "Toronto, Ontario",
    timezone: "America/Toronto",
    status: "active",
    whatItDoes: "Builds practical AI-powered revenue and follow-up systems for businesses.",
    targetAudience: "Business owners and operators",
    mainOffers: "Revenue systems, automation and assessments",
    primaryCta: "Start a conversation with Atlasium",
    tone: "Intelligent, direct, premium and modern",
    wordsUse: "clear, practical, revenue system",
    wordsAvoid: "generic AI hype, motivational fluff, cheesy slogans, unnecessary em dashes",
    visualStyle: "Dark, premium, black and gold, modern, clean",
    instructions: "Preserve facts. Never invent offers, proof, personal stories or claims.",
    routingRules: JSON.stringify({ includePersonalLinkedIn: true, preferCompanyLinkedIn: true, tiktokRequiresCompatibleMedia: true }),
    channelIds: [],
    channels: [],
  };
}
