/* Built to Own -> EchoFlow review-only editorial draft importer.
 * Uses EchoFlow's existing brand and D1 draft library.
 * No Buffer calls, social account use, advertising, sending or publishing.
 */
import { requireBrand, WORKSPACE_ID } from "./brand-store";
import { ensureContentSystem } from "./content-store";

// Stable identity verified from the existing EchoFlow workspace. Slugs and names are editable.
const BTO_BRAND_ID = "brand_52eae935-c32d-4f35-8cb4-4774f4a74deb";

type ImportEnv = { DB?: D1Database; UPLOADS: R2Bucket };
type Draft = {
  sourceKey: string; platform: string;
  request: { contentType: string; mode: string; prompt: string; payload: {
    title: string; caption: string; imageConcept: string; platforms: string[];
  } };
};

export class EditorialImportError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function object(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  throw new EditorialImportError(400, "Editorial handoff must contain valid JSON objects.");
}

function field(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new EditorialImportError(400, `Invalid ${label}.`);
  return value.trim();
}

function validatedSource(value: unknown): string {
  const source = field(value, "source URL", 2048);
  let parsed: URL;
  try { parsed = new URL(source); }
  catch { throw new EditorialImportError(400, "Invalid editorial source URL."); }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || parsed.username || parsed.password
    || !host.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(host)
    || host === "localhost" || /\.(internal|local|test|example|invalid)$/.test(host)
    || (parsed.port !== "" && parsed.port !== "443") || parsed.hash)
    throw new EditorialImportError(400, "Editorial sources must be public HTTPS URLs.");
  return parsed.toString();
}

async function fingerprint(storyId: string, platform: string, caption: string) {
  const message = "BUILT TO OWN\n" + storyId + "\n" + platform + "\n" + caption;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message)));
  return "bto_" + [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function parseHandoff(input: unknown) {
  const data = object(input);
  if (data.schema !== "built-to-own.echoflow-drafts.v1" || data.brand !== "BUILT TO OWN"
      || data.reviewOnly !== true || data.publishEnabled !== false
      || data.approvedForDistribution !== false || !Array.isArray(data.socialDestinations)
      || data.socialDestinations.length !== 0)
    throw new EditorialImportError(400, "Expected an unapproved BUILT TO OWN newsroom handoff without publishing destinations.");
  const storyId = field(data.sourceStoryId, "research story ID", 100);
  const rawSources = data.sources;
  if (!Array.isArray(rawSources) || rawSources.length < 1 || rawSources.length > 8)
    throw new EditorialImportError(400, "One to eight cited sources are required.");
  const sources = rawSources.map(validatedSource);
  const items = data.drafts;
  if (!Array.isArray(items) || items.length < 1 || items.length > 5)
    throw new EditorialImportError(400, "Provide one to five social review drafts.");
  const valid = new Set(["instagram", "facebook", "linkedin", "threads", "x"]);
  const seen = new Set<string>();
  const drafts = [];
  for (const raw of items) {
    const row = object(raw) as unknown as Draft;
    const platform = field(row.platform, "platform", 25);
    if (!valid.has(platform)) throw new EditorialImportError(400, "Unsupported Built to Own social platform.");
    const req = object(row.request);
    const payload = object(req.payload);
    if (req.contentType !== "social" || req.mode !== "manual" || req.prompt !== ""
      || !Array.isArray(payload.platforms) || payload.platforms.length !== 1
      || payload.platforms[0] !== platform || payload.imageConcept !== "")
      throw new EditorialImportError(400, "Only manually reviewed single-platform social drafts may be imported.");
    const title = field(payload.title, "editorial title", 180);
    const caption = field(payload.caption, "social caption", 8000);
    if (platform === "x" && caption.length > 280)
      throw new EditorialImportError(400, "X draft exceeds the newsroom's 280-character limit.");
    if (!sources.some((url) => caption.includes(url)))
      throw new EditorialImportError(400, "Each imported caption must cite a source URL.");
    const sourceKey = field(row.sourceKey, "source key", 36);
    if (!/^bto_[a-f0-9]{32}$/.test(sourceKey)
      || sourceKey !== await fingerprint(storyId, platform, caption))
      throw new EditorialImportError(400, "Handoff fingerprint does not match the source story and caption.");
    if (seen.has(sourceKey)) throw new EditorialImportError(400, "Repeated editorial drafts in one handoff.");
    seen.add(sourceKey);
    drafts.push({ sourceKey, platform, title, caption });
  }
  return { storyId, sources, drafts };
}

export async function importBtoEditorialReviewDrafts(
  env: ImportEnv, brandId: string, input: unknown,
) {
  if (!env.DB) throw new EditorialImportError(503, "ECHO content storage is not configured.");
  const brand = await requireBrand(env, brandId);
  // Fail closed to the existing BTO record, even when another brand copies its name or slug.
  if (brand.id !== BTO_BRAND_ID || brand.workspaceId !== WORKSPACE_ID)
    throw new EditorialImportError(403, "Select the separate BUILT TO OWN brand; Atlasium and client brands cannot receive these drafts.");
  const prepared = await parseHandoff(input); // Validate the entire batch before writing.
  await ensureContentSystem(env);
  let imported = 0;
  let alreadyPresent = 0;
  const draftIds = [];
  for (const item of prepared.drafts) {
    const id = "echo_social_import_" + item.sourceKey;
    const now = new Date().toISOString();
    const settings = JSON.stringify({
      importSource: "built-to-own-editorial", sourceStoryId: prepared.storyId,
      citedSources: prepared.sources, manualEditorialReviewRequired: true,
      publicationApproved: false, distributionEnabled: false,
    });
    const payload = JSON.stringify({
      title: item.title, caption: item.caption, platforms: [item.platform], imageConcept: "",
    });
    const saved = await env.DB.prepare(`INSERT OR IGNORE INTO echo_content_drafts
      (id,workspace_id,brand_id,content_type,title,status,prompt,settings,payload,
       featured_image_url,source_draft_id,created_at,updated_at)
      VALUES (?, ?, ?, 'social', ?, 'draft', '', ?, ?, NULL, ?, ?, ?)`)
      .bind(id, WORKSPACE_ID, brand.id, item.title, settings, payload, item.sourceKey, now, now).run();
    if (Number(saved.meta?.changes || 0) === 1) imported++;
    else {
      const existing = await env.DB.prepare(`SELECT brand_id AS brandId FROM echo_content_drafts
        WHERE id=? AND workspace_id=? LIMIT 1`).bind(id, WORKSPACE_ID).first<{ brandId: string }>();
      if (existing?.brandId !== brand.id)
        throw new EditorialImportError(409, "A newsroom draft is already assigned to another brand.");
      alreadyPresent++;
    }
    draftIds.push(id);
  }
  return {
    brandId: brand.id, draftIds, imported, alreadyPresent,
    createdStatus: "draft", editorialReviewRequired: true,
    publishEnabled: false, scheduledPosts: 0, outboundMessagesSent: 0,
  };
}
