import { ATLASIUM_BRAND_ID, WORKSPACE_ID, ensureBrandSystem, requireBrand, type BrandContext } from "./brand-store";

export type AmplifyEnv = {
  DB?: D1Database;
  UPLOADS: R2Bucket;
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MODEL?: string;
  AMPLIFY_ENABLED?: string;
  AMPLIFY_DRY_RUN_ENABLED?: string;
  AMPLIFY_LIVE_SUBMISSION_ENABLED?: string;
};

type JsonRecord = Record<string, unknown>;

const nowIso = () => new Date().toISOString();
const value = (input: unknown) => String(input ?? "").trim();
const rowList = <T>(result: D1Result<T>) => result.results || [];

const AMPLIFY_PROVIDERS = new Set(["meta", "google_ads", "linkedin", "tiktok", "x", "pinterest", "snapchat"]);
const GOALS = new Set(["leads", "bookings", "calls_messages", "website_sales", "website_traffic", "awareness", "promote_post"]);
const URL_DESTINATIONS = new Set(["website", "landing_page", "booking_page", "app"]);
const RESTRICTED_CATEGORIES = new Set(["housing", "employment", "credit", "financial_services", "politics"]);

export function amplifyFeatureFlags(env: AmplifyEnv) {
  return {
    interfaceEnabled: env.AMPLIFY_ENABLED !== "false",
    dryRunEnabled: env.AMPLIFY_DRY_RUN_ENABLED !== "false",
    liveSubmissionEnabled: env.AMPLIFY_LIVE_SUBMISSION_ENABLED === "true" && false,
  };
}

export async function ensureAmplifySystem(env: AmplifyEnv) {
  if (!env.DB) return;
  await ensureBrandSystem(env);
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS advertising_assets (id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, brand_id TEXT NOT NULL, source_type TEXT NOT NULL, label TEXT NOT NULL, media_type TEXT NOT NULL, url TEXT NOT NULL, r2_key TEXT NOT NULL, content_type TEXT NOT NULL, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_advertising_assets_brand_created ON advertising_assets (brand_id, created_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS advertising_campaign_drafts (id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, brand_id TEXT NOT NULL, name TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, revision INTEGER DEFAULT 1 NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_advertising_drafts_brand_updated ON advertising_campaign_drafts (brand_id, updated_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS advertising_dry_runs (id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, brand_id TEXT NOT NULL, draft_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, status TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_advertising_dry_run_idempotency ON advertising_dry_runs (brand_id, idempotency_key)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_advertising_dry_runs_draft ON advertising_dry_runs (draft_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS advertising_status_events (id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, brand_id TEXT NOT NULL, draft_id TEXT NOT NULL, provider_id TEXT, status TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_advertising_events_draft_created ON advertising_status_events (draft_id, created_at)"),
  ]);
}

function safeJson<T>(input: unknown, fallback: T): T {
  try { return JSON.parse(value(input)) as T; }
  catch { return fallback; }
}

function draftFromRow(row: Record<string, unknown>) {
  const payload = safeJson<JsonRecord>(row.payload, {});
  const providerIds = Array.isArray(payload.providerIds) ? payload.providerIds.map(value) : [];
  return {
    id: value(row.id), brandId: value(row.brand_id), name: value(row.name), status: value(row.status), prompt: value(row.prompt), payload,
    revision: Number(row.revision || 1), createdAt: value(row.created_at), updatedAt: value(row.updated_at),
    platformStatuses: providerIds.map((providerId) => ({ providerId, status: value(row.status), detail: value(row.status) === "dry_test_passed" ? "Dry test passed. Platform submission remains disabled." : "Draft only. No platform submission." })),
  };
}

async function brandDirectory(env: AmplifyEnv) {
  if (!env.DB) {
    const brand = await requireBrand(env, ATLASIUM_BRAND_ID);
    return [brand];
  }
  const rows = rowList(await env.DB.prepare(`SELECT b.id, b.name, b.logo_url, b.timezone, b.industry, b.location, p.main_offers, p.target_audience, p.primary_cta
    FROM brands b JOIN brand_profiles p ON p.brand_id = b.id
    WHERE b.workspace_id = ? AND b.status = 'active' ORDER BY b.created_at`).bind(WORKSPACE_ID).all<Record<string, unknown>>());
  return rows.map((row) => ({ id: value(row.id), name: value(row.name), logoUrl: value(row.logo_url), timezone: value(row.timezone), industry: value(row.industry), location: value(row.location), mainOffers: value(row.main_offers), targetAudience: value(row.target_audience), primaryCta: value(row.primary_cta) }));
}

async function creativeSources(env: AmplifyEnv, brandId: string) {
  if (!env.DB) return [];
  const [media, flowPosts, brandAssets, uploads] = await Promise.all([
    env.DB.prepare(`SELECT m.id, m.media_type, m.url, m.post_id, p.concept
      FROM media_assets m LEFT JOIN posts p ON p.id = m.post_id AND p.brand_id = m.brand_id
      WHERE m.workspace_id = ? AND m.brand_id = ? ORDER BY m.created_at DESC LIMIT 30`).bind(WORKSPACE_ID, brandId).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT j.id, j.post_id, j.destination_id, j.scheduled_time, p.concept, m.url, m.media_type
      FROM publish_jobs j JOIN posts p ON p.id = j.post_id AND p.brand_id = j.brand_id
      LEFT JOIN media_assets m ON m.post_id = p.id AND m.brand_id = p.brand_id
      WHERE j.workspace_id = ? AND j.brand_id = ? AND j.status IN ('confirmed','scheduled','published')
      GROUP BY j.post_id ORDER BY j.updated_at DESC LIMIT 30`).bind(WORKSPACE_ID, brandId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT id, kind, url FROM brand_assets WHERE workspace_id = ? AND brand_id = ? ORDER BY created_at DESC LIMIT 20").bind(WORKSPACE_ID, brandId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT id, source_type, label, media_type, url FROM advertising_assets WHERE workspace_id = ? AND brand_id = ? ORDER BY created_at DESC LIMIT 20").bind(WORKSPACE_ID, brandId).all<Record<string, unknown>>(),
  ]);
  const echo = rowList(media).map((row) => ({ id: value(row.id), brandId, sourceType: value(row.media_type) === "video" ? "motion_asset" : "echo_asset", label: value(row.concept) || "ECHO creative", mediaType: value(row.media_type) === "video" ? "video" : "image", url: value(row.url), detail: "Original ECHO asset. AMPLIFY will not change it.", originalId: value(row.post_id) }));
  const flow = rowList(flowPosts).map((row) => ({ id: `flow_${value(row.post_id)}`, brandId, sourceType: "flow_post", label: value(row.concept) || "FLOW post", mediaType: "post", url: value(row.url), detail: `Existing organic post · ${value(row.scheduled_time)}`, originalId: value(row.post_id) }));
  const assets = rowList(brandAssets).map((row) => ({ id: value(row.id), brandId, sourceType: "brand_asset", label: value(row.kind) || "Brand asset", mediaType: "image", url: value(row.url), detail: "Brand-owned creative asset" }));
  const uploaded = rowList(uploads).map((row) => ({ id: value(row.id), brandId, sourceType: value(row.source_type), label: value(row.label), mediaType: value(row.media_type), url: value(row.url), detail: "Uploaded for AMPLIFY" }));
  return [...uploaded, ...echo, ...flow, ...assets];
}

export async function loadAmplifyWorkspace(env: AmplifyEnv, brandId: string) {
  if (!amplifyFeatureFlags(env).interfaceEnabled) throw new Error("AMPLIFY is not enabled on this server.");
  await ensureAmplifySystem(env);
  const activeBrand = await requireBrand(env, brandId);
  const draftRowsPromise = env.DB
    ? env.DB.prepare("SELECT * FROM advertising_campaign_drafts WHERE workspace_id = ? AND brand_id = ? ORDER BY updated_at DESC LIMIT 50").bind(WORKSPACE_ID, activeBrand.id).all<Record<string, unknown>>().then(rowList)
    : Promise.resolve([] as Record<string, unknown>[]);
  const [brands, sources, draftRows] = await Promise.all([
    brandDirectory(env),
    creativeSources(env, activeBrand.id),
    draftRowsPromise,
  ]);
  return {
    brands,
    activeBrand: { id: activeBrand.id, name: activeBrand.name, logoUrl: activeBrand.logoUrl, timezone: activeBrand.timezone, industry: activeBrand.industry, location: activeBrand.location, mainOffers: activeBrand.mainOffers, targetAudience: activeBrand.targetAudience, primaryCta: activeBrand.primaryCta },
    creativeSources: sources,
    drafts: draftRows.map(draftFromRow),
    featureFlags: amplifyFeatureFlags(env),
  };
}

function destinationIsValid(type: string, destination: string) {
  if (!destination) return false;
  if (!URL_DESTINATIONS.has(type)) return true;
  try { const url = new URL(destination); return url.protocol === "https:" || url.protocol === "http:"; }
  catch { return false; }
}

function scheduleIsValid(schedule: JsonRecord) {
  const start = value(schedule.startAt);
  const end = value(schedule.endAt);
  const timezone = value(schedule.timezone);
  if (!start || !end || end <= start || !timezone) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date()); return true; }
  catch { return false; }
}

function maximumSpend(budget: JsonRecord, schedule: JsonRecord) {
  const amount = Number(budget.amount || 0);
  if (value(budget.type) === "lifetime") return Math.round(amount * 100) / 100;
  const start = new Date(`${value(schedule.startAt).slice(0, 10)}T00:00:00Z`).getTime();
  const end = new Date(`${value(schedule.endAt).slice(0, 10)}T00:00:00Z`).getTime();
  const days = Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
  return Math.round(amount * days * 100) / 100;
}

async function assertCreativeOwnership(env: AmplifyEnv, brandId: string, source: JsonRecord) {
  if (!env.DB) return;
  const sourceId = value(source.id);
  const sourceType = value(source.sourceType);
  if (!sourceId || !sourceType) throw new Error("Choose a creative source before preparing the advertisement.");
  let found: Record<string, unknown> | null = null;
  if (["echo_asset", "motion_asset"].includes(sourceType)) found = await env.DB.prepare("SELECT id FROM media_assets WHERE id = ? AND workspace_id = ? AND brand_id = ? LIMIT 1").bind(sourceId, WORKSPACE_ID, brandId).first<Record<string, unknown>>();
  else if (sourceType === "flow_post" || sourceType === "organic_post") found = await env.DB.prepare("SELECT id FROM posts WHERE id = ? AND workspace_id = ? AND brand_id = ? LIMIT 1").bind(value(source.originalId) || sourceId.replace(/^flow_/, ""), WORKSPACE_ID, brandId).first<Record<string, unknown>>();
  else if (sourceType === "brand_asset") found = await env.DB.prepare("SELECT id FROM brand_assets WHERE id = ? AND workspace_id = ? AND brand_id = ? LIMIT 1").bind(sourceId, WORKSPACE_ID, brandId).first<Record<string, unknown>>();
  else if (["uploaded_image", "uploaded_video"].includes(sourceType)) found = await env.DB.prepare("SELECT id FROM advertising_assets WHERE id = ? AND workspace_id = ? AND brand_id = ? LIMIT 1").bind(sourceId, WORKSPACE_ID, brandId).first<Record<string, unknown>>();
  if (!found) throw new Error("That creative does not belong to the selected brand.");
}

function responseText(data: { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }) {
  for (const output of data.output || []) for (const item of output.content || []) if (item.type === "output_text" && item.text) return item.text;
  return "";
}

async function generateAdvertisingCopy(env: AmplifyEnv, brand: BrandContext, input: JsonRecord, providerIds: string[]) {
  if (!env.OPENAI_API_KEY) throw new Error("AI draft generation is not configured on this server.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_TEXT_MODEL || "gpt-4.1",
      input: [
        { role: "system", content: `You prepare paid-advertising drafts for ${brand.name}. Preserve the user's facts and intent. Never invent proof, offers, destinations, discounts, results, personal stories or performance forecasts. Use a direct, premium business tone. Return strict JSON with campaignName and variations. variations must contain exactly one object per requested provider with providerId, headline, body, callToAction, placement and format.` },
        { role: "user", content: JSON.stringify({ brand: { name: brand.name, industry: brand.industry, location: brand.location, mainOffers: brand.mainOffers, targetAudience: brand.targetAudience, primaryCta: brand.primaryCta, tone: brand.tone, wordsAvoid: brand.wordsAvoid }, campaign: { prompt: input.prompt, offer: input.offer, goal: input.goal, destinationType: input.destinationType, destination: input.destination, callToAction: input.callToAction, audience: input.audience, providers: providerIds, creative: input.creativeSource } }) },
      ],
      text: { format: { type: "json_schema", name: "amplify_campaign_draft", strict: true, schema: { type: "object", additionalProperties: false, properties: { campaignName: { type: "string" }, variations: { type: "array", minItems: providerIds.length, maxItems: providerIds.length, items: { type: "object", additionalProperties: false, properties: { providerId: { type: "string", enum: providerIds }, headline: { type: "string" }, body: { type: "string" }, callToAction: { type: "string" }, placement: { type: "string" }, format: { type: "string" } }, required: ["providerId", "headline", "body", "callToAction", "placement", "format"] } } }, required: ["campaignName", "variations"] } } },
    }),
  });
  const data = await response.json() as { error?: { message?: string }; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (!response.ok) throw new Error(data.error?.message || "Advertising copy generation failed.");
  const generated = JSON.parse(responseText(data)) as { campaignName?: string; variations?: JsonRecord[] };
  const byProvider = new Map((generated.variations || []).map((variation) => [value(variation.providerId), variation]));
  if (providerIds.some((providerId) => !byProvider.has(providerId))) throw new Error("The AI draft did not return every selected platform variation.");
  return {
    campaignName: value(generated.campaignName).slice(0, 120) || `${brand.name} advertising draft`,
    variations: providerIds.map((providerId) => {
      const variation = byProvider.get(providerId)!;
      return { providerId, headline: value(variation.headline).slice(0, 160), body: value(variation.body).slice(0, 1800), callToAction: value(variation.callToAction).slice(0, 80), placement: value(variation.placement).slice(0, 120), format: value(variation.format).slice(0, 80), mediaSourceId: value((input.creativeSource as JsonRecord)?.id) };
    }),
  };
}

export async function createAmplifyDraft(env: AmplifyEnv, brandId: string, rawInput: JsonRecord) {
  const flags = amplifyFeatureFlags(env);
  if (!flags.interfaceEnabled) throw new Error("AMPLIFY is not enabled on this server.");
  await ensureAmplifySystem(env);
  if (!env.DB) throw new Error("AMPLIFY draft storage is unavailable.");
  const brand = await requireBrand(env, brandId);
  const prompt = value(rawInput.prompt).slice(0, 5000);
  const offer = value(rawInput.offer).slice(0, 500);
  const goal = value(rawInput.goal);
  const destinationType = value(rawInput.destinationType);
  const destination = value(rawInput.destination).slice(0, 2000);
  const callToAction = value(rawInput.callToAction).slice(0, 120);
  const providerIds = [...new Set((Array.isArray(rawInput.providerIds) ? rawInput.providerIds : []).map(value))];
  const audience = (rawInput.audience || {}) as JsonRecord;
  const budget = (rawInput.budget || {}) as JsonRecord;
  const schedule = (rawInput.schedule || {}) as JsonRecord;
  const creativeSource = (rawInput.creativeSource || {}) as JsonRecord;
  if (!prompt) throw new Error("Describe what you want to promote.");
  if (!offer) throw new Error("Name the offer or item being promoted.");
  if (!GOALS.has(goal)) throw new Error("Choose a supported campaign goal.");
  if (!destinationIsValid(destinationType, destination)) throw new Error("Add a valid campaign destination. EchoFlow will never invent one.");
  if (!callToAction) throw new Error("Choose a call to action.");
  if (!providerIds.length || providerIds.some((id) => !AMPLIFY_PROVIDERS.has(id))) throw new Error("Choose at least one supported advertising platform.");
  if (!value(audience.location) || !value(audience.summary)) throw new Error("Add a plain-language audience and location.");
  if (RESTRICTED_CATEGORIES.has(value(audience.restrictedCategory))) { audience.ageMin = 18; audience.ageMax = 65; audience.interests = ""; }
  if (!scheduleIsValid(schedule)) throw new Error("Choose a valid start, end and time zone.");
  if (!Number.isFinite(Number(budget.amount)) || Number(budget.amount) <= 0 || !["daily", "lifetime"].includes(value(budget.type))) throw new Error("Enter a valid daily or lifetime budget.");
  await assertCreativeOwnership(env, brandId, creativeSource);
  budget.maximumSpend = maximumSpend(budget, schedule);
  const generated = await generateAdvertisingCopy(env, brand, rawInput, providerIds);
  const createdAt = nowIso();
  const id = `ad_draft_${crypto.randomUUID()}`;
  const payload = { ...rawInput, prompt, offer, goal, destinationType, destination, callToAction, providerIds, audience, budget, schedule, creativeSource, campaignName: generated.campaignName, variations: generated.variations, explicitConfirmation: false };
  await env.DB.batch([
    env.DB.prepare("INSERT INTO advertising_campaign_drafts (id, workspace_id, brand_id, name, prompt, status, payload, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ready_for_review', ?, 1, ?, ?)").bind(id, WORKSPACE_ID, brandId, generated.campaignName, prompt, JSON.stringify(payload), createdAt, createdAt),
    env.DB.prepare("INSERT INTO advertising_status_events (id, workspace_id, brand_id, draft_id, provider_id, status, detail, created_at) VALUES (?, ?, ?, ?, NULL, 'ready_for_review', 'Draft prepared. No advertising platform contacted.', ?)").bind(`ad_event_${crypto.randomUUID()}`, WORKSPACE_ID, brandId, id, createdAt),
  ]);
  const row = await env.DB.prepare("SELECT * FROM advertising_campaign_drafts WHERE id = ? AND workspace_id = ? AND brand_id = ? LIMIT 1").bind(id, WORKSPACE_ID, brandId).first<Record<string, unknown>>();
  return draftFromRow(row!);
}

export async function updateAmplifyDraft(env: AmplifyEnv, brandId: string, draftId: string, payload: JsonRecord) {
  await ensureAmplifySystem(env);
  if (!env.DB) throw new Error("AMPLIFY draft storage is unavailable.");
  await requireBrand(env, brandId);
  const existing = await env.DB.prepare("SELECT * FROM advertising_campaign_drafts WHERE id = ? AND workspace_id = ? AND brand_id = ? LIMIT 1").bind(draftId, WORKSPACE_ID, brandId).first<Record<string, unknown>>();
  if (!existing) throw new Error("That advertising draft is unavailable for this brand.");
  const current = safeJson<JsonRecord>(existing.payload, {});
  const merged = { ...current, ...payload, brandId: undefined };
  await env.DB.prepare("UPDATE advertising_campaign_drafts SET payload = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND workspace_id = ? AND brand_id = ?").bind(JSON.stringify(merged), nowIso(), draftId, WORKSPACE_ID, brandId).run();
  const row = await env.DB.prepare("SELECT * FROM advertising_campaign_drafts WHERE id = ? AND workspace_id = ? AND brand_id = ? LIMIT 1").bind(draftId, WORKSPACE_ID, brandId).first<Record<string, unknown>>();
  return draftFromRow(row!);
}

export async function uploadAmplifyAsset(request: Request, env: AmplifyEnv, brandId: string) {
  await ensureAmplifySystem(env);
  if (!env.DB) throw new Error("AMPLIFY asset storage is unavailable.");
  await requireBrand(env, brandId);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 105 * 1024 * 1024) throw new Error("This file is larger than the 100 MB AMPLIFY upload limit.");
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new Error("Choose an image or video first.");
  const allowed = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["video/mp4", "mp4"], ["video/quicktime", "mov"]]);
  const extension = allowed.get(file.type);
  if (!extension) throw new Error("Use a JPG, PNG, WebP, MP4 or MOV file.");
  const limit = file.type.startsWith("video/") ? 100 * 1024 * 1024 : 20 * 1024 * 1024;
  if (!file.size || file.size > limit) throw new Error(`This ${file.type.startsWith("video/") ? "video" : "image"} exceeds the upload limit.`);
  const id = `ad_asset_${crypto.randomUUID()}`;
  const key = `brands/${brandId}/amplify/${id}.${extension}`;
  await env.UPLOADS.put(key, file.stream(), { httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" } });
  const url = `${new URL(request.url).origin}/i/${key}`;
  const sourceType = file.type.startsWith("video/") ? "uploaded_video" : "uploaded_image";
  await env.DB.prepare("INSERT INTO advertising_assets (id, workspace_id, brand_id, source_type, label, media_type, url, r2_key, content_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, WORKSPACE_ID, brandId, sourceType, file.name.slice(0, 200) || "Uploaded creative", file.type.startsWith("video/") ? "video" : "image", url, key, file.type, nowIso()).run();
  return { id, brandId, sourceType, label: file.name, mediaType: file.type.startsWith("video/") ? "video" : "image", url, detail: "Uploaded for AMPLIFY" };
}

function validationChecks(payload: JsonRecord) {
  const providerIds = Array.isArray(payload.providerIds) ? payload.providerIds.map(value) : [];
  const budget = (payload.budget || {}) as JsonRecord;
  const schedule = (payload.schedule || {}) as JsonRecord;
  const destinationValid = destinationIsValid(value(payload.destinationType), value(payload.destination));
  const checks: Array<{ label: string; status: "passed" | "failed" | "review"; detail: string }> = [
    { label: "Required destination", status: destinationValid ? "passed" : "failed", detail: destinationValid ? "Destination is present and structurally valid." : "A valid destination is required." },
    { label: "Creative source", status: value((payload.creativeSource as JsonRecord)?.id) ? "passed" : "failed", detail: value((payload.creativeSource as JsonRecord)?.id) ? "Brand-owned creative is attached." : "Choose creative for this advertisement." },
    { label: "Budget and maximum spend", status: Number(budget.amount) > 0 && Number(budget.maximumSpend) >= Number(budget.amount) ? "passed" : "failed", detail: `${value(budget.currency)} ${Number(budget.maximumSpend || 0).toFixed(2)} maximum.` },
    { label: "Schedule and time zone", status: scheduleIsValid(schedule) ? "passed" : "failed", detail: scheduleIsValid(schedule) ? `${value(schedule.startAt)} to ${value(schedule.endAt)} · ${value(schedule.timezone)}` : "A valid schedule is required." },
    { label: "Platform compatibility", status: providerIds.length && providerIds.every((id) => AMPLIFY_PROVIDERS.has(id)) ? "passed" : "failed", detail: providerIds.length ? `${providerIds.length} compatible platform${providerIds.length === 1 ? "" : "s"} selected.` : "Choose a supported platform." },
    { label: "Advertising permission", status: "review", detail: "Platform application approval and advertising permission are still required." },
    { label: "Compliance", status: "review", detail: "Basic validation only. Platform and policy review are still required." },
  ];
  return checks;
}

export async function runAmplifyDryTest(env: AmplifyEnv, brandId: string, draftId: string, idempotencyKey: string, confirmed: boolean) {
  const flags = amplifyFeatureFlags(env);
  if (!flags.dryRunEnabled) throw new Error("AMPLIFY dry testing is disabled on this server.");
  if (!confirmed) throw new Error("Confirm the draft before running the dry test.");
  if (!idempotencyKey || idempotencyKey.length > 160) throw new Error("A valid dry-test idempotency key is required.");
  await ensureAmplifySystem(env);
  if (!env.DB) throw new Error("AMPLIFY dry-test storage is unavailable.");
  await requireBrand(env, brandId);
  const duplicate = await env.DB.prepare("SELECT result FROM advertising_dry_runs WHERE workspace_id = ? AND brand_id = ? AND idempotency_key = ? LIMIT 1").bind(WORKSPACE_ID, brandId, idempotencyKey).first<Record<string, unknown>>();
  if (duplicate) return { ...safeJson<JsonRecord>(duplicate.result, {}), duplicate: true };
  const row = await env.DB.prepare("SELECT * FROM advertising_campaign_drafts WHERE id = ? AND workspace_id = ? AND brand_id = ? LIMIT 1").bind(draftId, WORKSPACE_ID, brandId).first<Record<string, unknown>>();
  if (!row) throw new Error("That advertising draft is unavailable for this brand.");
  const payload = safeJson<JsonRecord>(row.payload, {});
  const checks = validationChecks(payload);
  const failed = checks.some((check) => check.status === "failed");
  const createdAt = nowIso();
  const result = { id: `ad_dry_${crypto.randomUUID()}`, draftId, brandId, status: failed ? "validation_failed" : "dry_test_passed", validationStatus: failed ? "Validation Failed" : checks.some((check) => check.status === "review") ? "Requires Compliance Review" : "Basic Validation Passed", checks, duplicate: false, createdAt };
  await env.DB.batch([
    env.DB.prepare("INSERT INTO advertising_dry_runs (id, workspace_id, brand_id, draft_id, idempotency_key, status, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(result.id, WORKSPACE_ID, brandId, draftId, idempotencyKey, result.status, JSON.stringify(result), createdAt),
    env.DB.prepare("UPDATE advertising_campaign_drafts SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND brand_id = ?").bind(result.status, createdAt, draftId, WORKSPACE_ID, brandId),
    env.DB.prepare("INSERT INTO advertising_status_events (id, workspace_id, brand_id, draft_id, provider_id, status, detail, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)").bind(`ad_event_${crypto.randomUUID()}`, WORKSPACE_ID, brandId, draftId, result.status, failed ? "Dry test failed basic validation." : "Dry test completed. No platform was contacted and no money was spent.", createdAt),
  ]);
  return result;
}
