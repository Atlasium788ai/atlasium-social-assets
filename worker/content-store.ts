import { ATLASIUM_BRAND_ID, WORKSPACE_ID, requireBrand, saveDraft, type BrandContext } from "./brand-store";

type JsonRecord = Record<string, unknown>;

type ContentEnv = {
  DB?: D1Database;
  UPLOADS: R2Bucket;
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MODEL?: string;
  OPENAI_IMAGE_MODEL?: string;
};

export type EchoContentType = "social" | "blog" | "newsletter";

type ContentDraft = {
  id: string;
  brandId: string;
  contentType: EchoContentType;
  title: string;
  status: "draft" | "completed";
  prompt: string;
  settings: JsonRecord;
  payload: JsonRecord;
  featuredImageUrl: string | null;
  sourceDraftId: string | null;
  createdAt: string;
  updatedAt: string;
};

const nowIso = () => new Date().toISOString();
const value = (input: unknown) => String(input ?? "").trim();
const safeJson = <T>(input: unknown, fallback: T): T => {
  try { return JSON.parse(value(input)) as T; } catch { return fallback; }
};

function rowList<T>(result: D1Result<T>) { return result.results || []; }

export async function ensureContentSystem(env: ContentEnv) {
  if (!env.DB) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS echo_content_drafts (
      id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, brand_id text NOT NULL,
      content_type text NOT NULL, title text NOT NULL, status text DEFAULT 'draft' NOT NULL,
      prompt text DEFAULT '' NOT NULL, settings text DEFAULT '{}' NOT NULL,
      payload text DEFAULT '{}' NOT NULL, featured_image_url text, source_draft_id text,
      created_at text NOT NULL, updated_at text NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_echo_content_brand_updated ON echo_content_drafts (brand_id, updated_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_echo_content_brand_type_status ON echo_content_drafts (brand_id, content_type, status)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS echo_content_revisions (
      id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, brand_id text NOT NULL,
      draft_id text NOT NULL, operation text NOT NULL, payload text NOT NULL, created_at text NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_echo_revisions_draft_created ON echo_content_revisions (draft_id, created_at)"),
  ]);
}

function draftFromRow(row: Record<string, unknown>): ContentDraft {
  return {
    id: value(row.id),
    brandId: value(row.brand_id),
    contentType: value(row.content_type) as EchoContentType,
    title: value(row.title),
    status: value(row.status) === "completed" ? "completed" : "draft",
    prompt: value(row.prompt),
    settings: safeJson<JsonRecord>(row.settings, {}),
    payload: safeJson<JsonRecord>(row.payload, {}),
    featuredImageUrl: value(row.featured_image_url) || null,
    sourceDraftId: value(row.source_draft_id) || null,
    createdAt: value(row.created_at),
    updatedAt: value(row.updated_at),
  };
}

function outputText(data: { output?: Array<{ content?: Array<{ type?: string; text?: string; refusal?: string }> }> }) {
  for (const output of data.output || []) for (const item of output.content || []) {
    if (item.type === "refusal") throw new Error(item.refusal || "OpenAI declined this request.");
    if (item.type === "output_text" && item.text) return item.text;
  }
  throw new Error("OpenAI returned no content.");
}

function brandInstruction(brand: BrandContext) {
  return `Brand: ${brand.name}. Business: ${brand.whatItDoes || "Not supplied"}. Audience: ${brand.targetAudience || "Not supplied"}. Offers: ${brand.mainOffers || "Not supplied"}. CTA: ${brand.primaryCta || "Not supplied"}. Tone: ${brand.tone || "clear and professional"}. Use: ${brand.wordsUse || "No special terms"}. Avoid: ${brand.wordsAvoid || "No special terms"}. Instructions: ${brand.instructions || "None"}. Never invent statistics, customer results, quotations, certifications, URLs, proof, offers, personal experiences or factual claims. Avoid keyword stuffing, generic AI hype, repetitive conclusions, unnecessary em dashes, buzzwords, cheesy marketing language and obvious AI phrasing.`;
}

const textField = { type: "string" } as const;
const sectionArray = { type: "array", items: { type: "object", additionalProperties: false, required: ["heading", "body"], properties: { heading: textField, body: textField } } } as const;

const blogSchema = {
  type: "object", additionalProperties: false,
  required: ["title", "subtitle", "introduction", "sections", "conclusion", "callToAction", "excerpt", "slug", "metaTitle", "metaDescription", "categories", "tags", "featuredImageConcept", "featuredImageAltText"],
  properties: {
    title: textField, subtitle: textField, introduction: textField, sections: sectionArray,
    conclusion: textField, callToAction: textField, excerpt: textField, slug: textField,
    metaTitle: textField, metaDescription: textField,
    categories: { type: "array", items: textField }, tags: { type: "array", items: textField },
    featuredImageConcept: textField, featuredImageAltText: textField,
  },
} as const;

const newsletterSchema = {
  type: "object", additionalProperties: false,
  required: ["subjectLines", "previewText", "headline", "opening", "sections", "callToAction", "closing"],
  properties: {
    subjectLines: { type: "array", minItems: 3, maxItems: 3, items: textField }, previewText: textField,
    headline: textField, opening: textField, sections: sectionArray, callToAction: textField, closing: textField,
  },
} as const;

function escapeHtml(input: unknown) {
  return String(input ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function paragraphs(input: unknown) {
  return value(input).split(/\n{2,}/).filter(Boolean).map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`).join("");
}

export function buildNewsletterHtml(payload: JsonRecord) {
  const sections = Array.isArray(payload.sections) ? payload.sections as JsonRecord[] : [];
  return `<article><h1>${escapeHtml(payload.headline)}</h1>${paragraphs(payload.opening)}${sections.map((section) => `<section><h2>${escapeHtml(section.heading)}</h2>${paragraphs(section.body)}</section>`).join("")}<p><strong>${escapeHtml(payload.callToAction)}</strong></p>${paragraphs(payload.closing)}</article>`;
}

export function sanitizeNewsletterHtml(input: unknown) {
  let html = String(input ?? "");
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  html = html.replace(/<(script|style|iframe|object|embed|form|input|button|meta|link|base|svg|math)[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  html = html.replace(/<(script|style|iframe|object|embed|form|input|button|meta|link|base|svg|math)\b[^>]*\/?\s*>/gi, "");
  html = html.replace(/\s(on\w+|style|srcdoc|formaction)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  html = html.replace(/\s(href|src)\s*=\s*(["'])\s*(javascript:|data:text\/html|vbscript:)[\s\S]*?\2/gi, "");
  html = html.replace(/<(?!\/?(?:article|section|div|span|p|h1|h2|h3|strong|em|b|i|u|ul|ol|li|blockquote|br|hr|table|thead|tbody|tr|th|td|a)\b)[^>]+>/gi, "");
  return html.trim();
}

function newsletterPlainText(payload: JsonRecord) {
  const sections = Array.isArray(payload.sections) ? payload.sections as JsonRecord[] : [];
  return [payload.headline, payload.opening, ...sections.flatMap((section) => [section.heading, section.body]), payload.callToAction, payload.closing].map(value).filter(Boolean).join("\n\n");
}

function normalizePayload(type: EchoContentType, payload: JsonRecord, generated = false) {
  if (type !== "newsletter") return payload;
  const next = { ...payload };
  if (generated || !value(next.plainText)) next.plainText = newsletterPlainText(next);
  next.html = sanitizeNewsletterHtml(generated || !value(next.html) ? buildNewsletterHtml(next) : next.html);
  return next;
}

function normalizeEditedPayload(type: EchoContentType, previous: JsonRecord, supplied: JsonRecord) {
  if (type !== "newsletter") return supplied;
  const next = { ...supplied };
  const previousAutomaticHtml = sanitizeNewsletterHtml(previous.html) === sanitizeNewsletterHtml(buildNewsletterHtml(previous));
  const htmlChangedManually = value(supplied.html) !== value(previous.html);
  next.html = sanitizeNewsletterHtml(!htmlChangedManually && previousAutomaticHtml ? buildNewsletterHtml(next) : supplied.html);
  const previousAutomaticText = value(previous.plainText) === newsletterPlainText(previous);
  const textChangedManually = value(supplied.plainText) !== value(previous.plainText);
  next.plainText = !textChangedManually && previousAutomaticText ? newsletterPlainText(next) : value(supplied.plainText);
  return next;
}

async function generatePayload(env: ContentEnv, brand: BrandContext, contentType: "blog" | "newsletter", prompt: string, settings: JsonRecord) {
  if (!env.OPENAI_API_KEY) throw new Error("OpenAI content generation is not configured on this server.");
  const schema = contentType === "blog" ? blogSchema : newsletterSchema;
  const instruction = contentType === "blog"
    ? "Create a complete, useful long-form article. Use a natural introduction, clearly organized sections, a non-repetitive conclusion and a grounded CTA. Return every SEO and featured-image field in the schema."
    : "Create a complete email newsletter with exactly three distinct subject lines, useful sections when needed, a clear action and a natural closing. Do not claim it was sent or delivered.";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_TEXT_MODEL || "gpt-5.6-luna",
      input: [
        { role: "system", content: `You create ${contentType} drafts inside ECHO. ${brandInstruction(brand)} ${instruction} Return only the requested schema.` },
        { role: "user", content: JSON.stringify({ prompt, settings }) },
      ],
      text: { format: { type: "json_schema", name: `echo_${contentType}_draft`, strict: true, schema } },
    }),
  });
  const data = await response.json() as { error?: { message?: string }; output?: Array<{ content?: Array<{ type?: string; text?: string; refusal?: string }> }> };
  if (!response.ok) throw new Error(data.error?.message || `OpenAI ${contentType} generation failed.`);
  return normalizePayload(contentType, JSON.parse(outputText(data)) as JsonRecord, true);
}

function contentTitle(type: EchoContentType, payload: JsonRecord, prompt: string) {
  return value(type === "newsletter" ? payload.headline : payload.title) || value(prompt).slice(0, 100) || `Untitled ${type}`;
}

async function ownedDraft(env: ContentEnv, brandId: string, draftId: string) {
  if (!env.DB) throw new Error("ECHO content storage is unavailable.");
  await requireBrand(env, brandId);
  await ensureContentSystem(env);
  const row = await env.DB.prepare("SELECT * FROM echo_content_drafts WHERE id = ? AND workspace_id = ? AND brand_id = ? LIMIT 1").bind(draftId, WORKSPACE_ID, brandId).first<Record<string, unknown>>();
  if (!row) throw new Error("That content draft is unavailable for this brand.");
  return draftFromRow(row);
}

export async function loadEchoContentWorkspace(env: ContentEnv, brandId: string) {
  if (!env.DB) throw new Error("ECHO content storage is unavailable.");
  await requireBrand(env, brandId);
  await ensureContentSystem(env);
  const [draftRows, campaignRows, mediaRows] = await Promise.all([
    env.DB.prepare("SELECT * FROM echo_content_drafts WHERE workspace_id = ? AND brand_id = ? ORDER BY updated_at DESC LIMIT 100").bind(WORKSPACE_ID, brandId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT id, prompt AS title, status, updated_at AS updatedAt FROM campaigns WHERE workspace_id = ? AND brand_id = ? ORDER BY updated_at DESC LIMIT 30").bind(WORKSPACE_ID, brandId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT id, url, media_type AS mediaType, created_at AS createdAt FROM media_assets WHERE workspace_id = ? AND brand_id = ? AND media_type IN ('image', 'motion') ORDER BY created_at DESC LIMIT 30").bind(WORKSPACE_ID, brandId).all<Record<string, unknown>>(),
  ]);
  const drafts = rowList(draftRows).map(draftFromRow);
  const campaigns = rowList(campaignRows).map((row) => ({ id: value(row.id), brandId, contentType: "social" as const, title: value(row.title) || "Social campaign", status: value(row.status), updatedAt: value(row.updatedAt), source: "campaign" }));
  const socialDrafts = drafts.filter((draft) => draft.contentType === "social").map((draft) => ({ ...draft, source: "draft" }));
  return {
    drafts: drafts.filter((draft) => draft.contentType !== "social"),
    library: [...drafts.filter((draft) => draft.contentType !== "social"), ...socialDrafts, ...campaigns].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    assets: rowList(mediaRows).map((row) => ({ id: value(row.id), brandId, url: value(row.url), mediaType: value(row.mediaType), createdAt: value(row.createdAt) })),
    publishingConnections: { blog: "not_configured", newsletter: "not_configured" },
  };
}

export async function createEchoContentDraft(env: ContentEnv, brandId: string, raw: JsonRecord) {
  if (!env.DB) throw new Error("ECHO content storage is unavailable.");
  const brand = await requireBrand(env, brandId);
  await ensureContentSystem(env);
  const contentType = value(raw.contentType) as EchoContentType;
  if (!contentType || !["blog", "newsletter"].includes(contentType)) throw new Error("Choose Blog or Newsletter.");
  const prompt = value(raw.prompt).slice(0, 8000);
  if (!prompt) throw new Error(contentType === "blog" ? "Tell us what the blog should be about." : "Tell us what the newsletter should communicate.");
  const settings = (raw.settings || {}) as JsonRecord;
  const payload = await generatePayload(env, brand, contentType as "blog" | "newsletter", prompt, settings);
  const id = `echo_${contentType}_${crypto.randomUUID()}`;
  const createdAt = nowIso();
  const title = contentTitle(contentType, payload, prompt).slice(0, 180);
  await env.DB.prepare("INSERT INTO echo_content_drafts (id, workspace_id, brand_id, content_type, title, status, prompt, settings, payload, featured_image_url, source_draft_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, NULL, NULL, ?, ?)")
    .bind(id, WORKSPACE_ID, brandId, contentType, title, prompt, JSON.stringify(settings), JSON.stringify(payload), createdAt, createdAt).run();
  return ownedDraft(env, brandId, id);
}

export async function updateEchoContentDraft(env: ContentEnv, brandId: string, draftId: string, raw: JsonRecord) {
  if (!env.DB) throw new Error("ECHO content storage is unavailable.");
  const current = await ownedDraft(env, brandId, draftId);
  const supplied = raw.payload && typeof raw.payload === "object" ? raw.payload as JsonRecord : current.payload;
  const payload = normalizeEditedPayload(current.contentType, current.payload, supplied);
  const status = value(raw.status) === "completed" ? "completed" : "draft";
  const featuredImageUrl = raw.featuredImageUrl === null ? null : value(raw.featuredImageUrl) || current.featuredImageUrl;
  const updatedAt = nowIso();
  const title = contentTitle(current.contentType, payload, current.prompt).slice(0, 180);
  await env.DB.prepare("UPDATE echo_content_drafts SET title = ?, status = ?, payload = ?, featured_image_url = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND brand_id = ?")
    .bind(title, status, JSON.stringify(payload), featuredImageUrl, updatedAt, draftId, WORKSPACE_ID, brandId).run();
  return ownedDraft(env, brandId, draftId);
}

function getAtPath(payload: JsonRecord, path: string) {
  const parts = path.split(".");
  let cursor: unknown = payload;
  for (const part of parts) cursor = Array.isArray(cursor) ? cursor[Number(part)] : cursor && typeof cursor === "object" ? (cursor as JsonRecord)[part] : undefined;
  return cursor;
}

function setAtPath(payload: JsonRecord, path: string, replacement: string) {
  const clone = structuredClone(payload);
  const parts = path.split(".");
  let cursor: unknown = clone;
  for (let index = 0; index < parts.length - 1; index++) cursor = Array.isArray(cursor) ? cursor[Number(parts[index])] : (cursor as JsonRecord)[parts[index]];
  const key = parts.at(-1)!;
  if (Array.isArray(cursor)) cursor[Number(key)] = replacement;
  else (cursor as JsonRecord)[key] = replacement;
  return clone;
}

export async function reviseEchoContentSection(env: ContentEnv, brandId: string, draftId: string, raw: JsonRecord) {
  if (!env.DB) throw new Error("ECHO content storage is unavailable.");
  const brand = await requireBrand(env, brandId);
  const current = await ownedDraft(env, brandId, draftId);
  if (!env.OPENAI_API_KEY) throw new Error("OpenAI content revision is not configured on this server.");
  const section = value(raw.section);
  const operation = value(raw.operation) || "regenerate";
  const selected = getAtPath(current.payload, section);
  if (typeof selected !== "string") throw new Error("Choose a text section to revise.");
  const intent: Record<string, string> = {
    regenerate: "Rewrite this section while preserving its purpose and all supplied facts.", shorten: "Make this section materially shorter without losing its meaning.",
    expand: "Expand this section with useful detail using only supplied facts.", change_tone: `Change this section to this tone: ${value(raw.tone) || brand.tone || "clear and professional"}.`,
    improve_headline: "Improve this headline for clarity, specificity and credibility. Do not use clickbait.", improve_cta: "Improve this call to action so it is clear, direct and grounded in the supplied offer.",
  };
  if (!intent[operation]) throw new Error("Choose a supported revision action.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_TEXT_MODEL || "gpt-5.6-luna",
      input: [
        { role: "system", content: `Revise one selected ${current.contentType} section only. ${brandInstruction(brand)} ${intent[operation]} Return only the schema.` },
        { role: "user", content: JSON.stringify({ selectedSection: section, selectedText: selected, fullDraftForContext: current.payload }) },
      ],
      text: { format: { type: "json_schema", name: "echo_section_revision", strict: true, schema: { type: "object", additionalProperties: false, required: ["replacement"], properties: { replacement: { type: "string" } } } } },
    }),
  });
  const data = await response.json() as { error?: { message?: string }; output?: Array<{ content?: Array<{ type?: string; text?: string; refusal?: string }> }> };
  if (!response.ok) throw new Error(data.error?.message || "OpenAI section revision failed.");
  const replacement = value((JSON.parse(outputText(data)) as JsonRecord).replacement);
  if (!replacement) throw new Error("OpenAI returned an empty revision.");
  const updatedAt = nowIso();
  const payload = normalizeEditedPayload(current.contentType, current.payload, setAtPath(current.payload, section, replacement));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO echo_content_revisions (id, workspace_id, brand_id, draft_id, operation, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(`echo_revision_${crypto.randomUUID()}`, WORKSPACE_ID, brandId, draftId, operation, JSON.stringify(current.payload), updatedAt),
    env.DB.prepare("UPDATE echo_content_drafts SET title = ?, payload = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND brand_id = ?").bind(contentTitle(current.contentType, payload, current.prompt).slice(0, 180), JSON.stringify(payload), updatedAt, draftId, WORKSPACE_ID, brandId),
  ]);
  return ownedDraft(env, brandId, draftId);
}

export async function undoEchoContentRevision(env: ContentEnv, brandId: string, draftId: string) {
  if (!env.DB) throw new Error("ECHO content storage is unavailable.");
  const current = await ownedDraft(env, brandId, draftId);
  const revision = await env.DB.prepare("SELECT * FROM echo_content_revisions WHERE workspace_id = ? AND brand_id = ? AND draft_id = ? ORDER BY created_at DESC LIMIT 1").bind(WORKSPACE_ID, brandId, draftId).first<Record<string, unknown>>();
  if (!revision) throw new Error("There is no AI revision to undo.");
  const payload = safeJson<JsonRecord>(revision.payload, current.payload);
  const updatedAt = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE echo_content_drafts SET title = ?, payload = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND brand_id = ?").bind(contentTitle(current.contentType, payload, current.prompt), JSON.stringify(payload), updatedAt, draftId, WORKSPACE_ID, brandId),
    env.DB.prepare("DELETE FROM echo_content_revisions WHERE id = ? AND workspace_id = ? AND brand_id = ?").bind(value(revision.id), WORKSPACE_ID, brandId),
  ]);
  return ownedDraft(env, brandId, draftId);
}

export async function duplicateEchoContentDraft(env: ContentEnv, brandId: string, draftId: string) {
  if (!env.DB) throw new Error("ECHO content storage is unavailable.");
  const source = await ownedDraft(env, brandId, draftId);
  const id = `echo_${source.contentType}_${crypto.randomUUID()}`;
  const createdAt = nowIso();
  await env.DB.prepare("INSERT INTO echo_content_drafts (id, workspace_id, brand_id, content_type, title, status, prompt, settings, payload, featured_image_url, source_draft_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, WORKSPACE_ID, brandId, source.contentType, `${source.title} — Copy`.slice(0, 180), source.prompt, JSON.stringify(source.settings), JSON.stringify(source.payload), source.featuredImageUrl, source.id, createdAt, createdAt).run();
  return ownedDraft(env, brandId, id);
}

export async function deleteEchoContentDraft(env: ContentEnv, brandId: string, draftId: string) {
  if (!env.DB) throw new Error("ECHO content storage is unavailable.");
  await ownedDraft(env, brandId, draftId);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM echo_content_revisions WHERE workspace_id = ? AND brand_id = ? AND draft_id = ?").bind(WORKSPACE_ID, brandId, draftId),
    env.DB.prepare("DELETE FROM echo_content_drafts WHERE workspace_id = ? AND brand_id = ? AND id = ?").bind(WORKSPACE_ID, brandId, draftId),
  ]);
  return { deleted: true, draftId };
}

export async function repurposeEchoContentDraft(env: ContentEnv, brandId: string, draftId: string, targetTypeRaw: unknown) {
  if (!env.DB) throw new Error("ECHO content storage is unavailable.");
  const source = await ownedDraft(env, brandId, draftId);
  const targetType = value(targetTypeRaw) as EchoContentType;
  if (!["social", "newsletter"].includes(targetType) || source.contentType === targetType) throw new Error("Choose a supported repurposing destination.");
  const id = `echo_${targetType}_${crypto.randomUUID()}`;
  const createdAt = nowIso();
  let prompt = "";
  let payload: JsonRecord = {};
  let title = "";
  if (targetType === "social") {
    prompt = `Create a social campaign adapted for each selected platform from this ${source.contentType}: ${source.title}. Preserve the source facts and intent. Source content: ${JSON.stringify(source.payload)}`.slice(0, 8000);
    payload = { prompt, sourceTitle: source.title, sourceDraftId: source.id };
    title = `Social campaign from ${source.title}`;
    await saveDraft(env, brandId, { prompt, timing: "auto", selectedChannels: [] });
  } else {
    const sourceSections = Array.isArray(source.payload.sections) ? source.payload.sections as JsonRecord[] : [];
    payload = normalizePayload("newsletter", {
      subjectLines: [source.title, `A practical note: ${source.title}`, `What to know about ${source.title}`],
      previewText: value(source.payload.excerpt) || value(source.payload.introduction).slice(0, 140),
      headline: source.title,
      opening: value(source.payload.introduction),
      sections: sourceSections,
      callToAction: value(source.payload.callToAction),
      closing: value(source.payload.conclusion),
    }, true);
    prompt = `Repurposed from ${source.title}`;
    title = source.title;
  }
  await env.DB.prepare("INSERT INTO echo_content_drafts (id, workspace_id, brand_id, content_type, title, status, prompt, settings, payload, featured_image_url, source_draft_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, '{}', ?, ?, ?, ?, ?)")
    .bind(id, WORKSPACE_ID, brandId, targetType, title.slice(0, 180), prompt, JSON.stringify(payload), source.featuredImageUrl, source.id, createdAt, createdAt).run();
  return ownedDraft(env, brandId, id);
}

export async function generateEchoFeaturedImage(request: Request, env: ContentEnv, brandId: string, draftId: string) {
  if (!env.DB || !env.UPLOADS) throw new Error("ECHO image storage is unavailable.");
  if (!env.OPENAI_API_KEY) throw new Error("OpenAI image generation is not configured on this server.");
  const brand = await requireBrand(env, brandId);
  const draft = await ownedDraft(env, brandId, draftId);
  const concept = value(draft.payload.featuredImageConcept) || `${draft.title}, premium editorial image`;
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.OPENAI_IMAGE_MODEL || "gpt-image-2", prompt: `${concept}. Brand visual direction: ${brand.visualStyle || "premium, clean and modern"}. No invented logos, facts, claims or prominent text.`, size: "1536x1024", quality: "medium", output_format: "png" }),
  });
  const data = await response.json() as { error?: { message?: string }; data?: Array<{ b64_json?: string }> };
  if (!response.ok || !data.data?.[0]?.b64_json) throw new Error(data.error?.message || "OpenAI image generation failed.");
  const bytes = Uint8Array.from(atob(data.data[0].b64_json), (character) => character.charCodeAt(0));
  const key = `brands/${brandId}/echo-content/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.png`;
  await env.UPLOADS.put(key, bytes, { httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { brandId, draftId, contentType: draft.contentType } });
  const imageUrl = `${new URL(request.url).origin}/i/${key}`;
  await updateEchoContentDraft(env, brandId, draftId, { payload: draft.payload, status: draft.status, featuredImageUrl: imageUrl });
  return { imageUrl, draft: await ownedDraft(env, brandId, draftId) };
}

export const contentPublishingAdapters = Object.freeze({ blog: null, newsletter: null });
export const DEFAULT_CONTENT_BRAND_ID = ATLASIUM_BRAND_ID;
