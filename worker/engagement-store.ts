/* Shared EchoFlow engagement engine: brand-scoped manual review queue.
 * This module does not scan, message, post, or call social network APIs.
 * No automated outbound action can be triggered by an approved draft.
 */
import { requireBrand, WORKSPACE_ID } from "./brand-store";

type EngagementEnv = { DB?: D1Database; UPLOADS: R2Bucket };
type Platform = "instagram" | "facebook" | "linkedin" | "threads" | "tiktok" | "youtube" | "x";
type Status = "pending_review" | "approved_not_sent" | "rejected";
const PLATFORMS: Record<Platform, readonly string[]> = {
  instagram: ["instagram.com", "www.instagram.com"],
  facebook: ["facebook.com", "www.facebook.com", "m.facebook.com"],
  linkedin: ["linkedin.com", "www.linkedin.com"],
  threads: ["threads.net", "www.threads.net"],
  tiktok: ["tiktok.com", "www.tiktok.com", "m.tiktok.com"],
  youtube: ["youtube.com", "www.youtube.com", "youtu.be"],
  x: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
};

type ManualOpportunityInput = {
  platform?: unknown;
  sourceUrl?: unknown;
  context?: unknown;
  suggestedReply?: unknown;
};

type ReviewInput = { id?: unknown; decision?: unknown };

type EngagementRow = {
  id: string;
  platform: Platform;
  sourceKind: "external_opportunity" | "own_comment" | "inbound_dm";
  sourceUrl: string;
  context: string;
  suggestedReply: string;
  sourceProvenance: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
};

function clean(value: unknown, max: number, name: string): string {
  if (typeof value !== "string") throw new Error(`Enter a valid ${name}.`);
  const result = value.replace(/\s+/g, " ").trim();
  if (!result || result.length > max) throw new Error(`Enter a valid ${name} (1–${max} characters).`);
  return result;
}

function verifiedSocialPost(url: string, platform: Platform): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Enter a valid social post URL."); }
  if (parsed.protocol !== "https:" || !PLATFORMS[platform].includes(parsed.hostname.toLowerCase())
    || parsed.username || parsed.password || parsed.pathname === "/") {
    throw new Error("The URL must point to an HTTPS post on the selected platform.");
  }
  parsed.hash = "";
  return parsed.toString();
}

function guardReply(value: unknown): string {
  const reply = clean(value, 600, "suggested reply");
  if (/\b(follow us|check out our page|DM me|message me|click our link|guaranteed leads)\b/i.test(reply)) {
    throw new Error("Write a useful, non-promotional reply for review.");
  }
  return reply;
}

async function keyFor(brandId: string, platform: Platform, url: string): Promise<string> {
  const bytes = new TextEncoder().encode([brandId, platform, url].join("|"));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (n) => n.toString(16).padStart(2, "0")).join("");
}

function storage(env: EngagementEnv): D1Database {
  if (!env.DB) throw new Error("EchoFlow engagement storage has not been configured.");
  return env.DB;
}

function toView(row: EngagementRow) {
  return {
    ...row,
    sendEnabled: false,
    autoCommentEnabled: false,
    autoDmEnabled: false,
    reviewOnly: true,
  };
}

/** Adds ONE manually selected public discussion. Never accepts an arbitrary DM target. */
export async function createManualEngagementDraft(env: EngagementEnv, brandId: string, input: ManualOpportunityInput) {
  if ("kind" in input || "recipientId" in input || "send" in input || "targetUserId" in input) {
    throw new Error("This endpoint only stores manually curated public opportunities, not direct message targets.");
  }
  const brand = await requireBrand(env, brandId);
  const db = storage(env);
  const platform = input.platform as Platform;
  if (!(typeof platform === "string" && Object.hasOwn(PLATFORMS, platform))) throw new Error("Unsupported social platform.");
  const sourceUrl = verifiedSocialPost(clean(input.sourceUrl, 2048, "source URL"), platform);
  const context = clean(input.context, 500, "conversation context");
  const suggestedReply = guardReply(input.suggestedReply);
  const identityKey = await keyFor(brand.id, platform, sourceUrl);
  const now = new Date().toISOString();
  const id = `eng_${crypto.randomUUID()}`;
  await db.prepare(`INSERT OR IGNORE INTO engagement_drafts
   (id, workspace_id, brand_id, platform, source_kind, source_url, context,
    suggested_reply, source_provenance, identity_key, status, created_at, updated_at)
   VALUES (?, ?, ?, ?, 'external_opportunity', ?, ?, ?, 'manual_curated', ?, 'pending_review', ?, ?)`)
   .bind(id, WORKSPACE_ID, brand.id, platform, sourceUrl, context, suggestedReply, identityKey, now, now).run();
  const row = await db.prepare(`SELECT id, platform, source_kind AS sourceKind, source_url AS sourceUrl,
      context, suggested_reply AS suggestedReply, source_provenance AS sourceProvenance,
      status, created_at AS createdAt, updated_at AS updatedAt
      FROM engagement_drafts WHERE workspace_id=? AND brand_id=? AND identity_key=? LIMIT 1`)
    .bind(WORKSPACE_ID, brand.id, identityKey).first<EngagementRow>();
  if (!row) throw new Error("Could not save the engagement draft.");
  return { brandId: brand.id, draft: toView(row), outboundMessagesSent: 0 };
}

/** A brand's queue cannot read another brand's messages or suggestions. */
export async function listBrandEngagementDrafts(env: EngagementEnv, brandId: string, limit = 30) {
  const brand = await requireBrand(env, brandId);
  const db = storage(env);
  const result = await db.prepare(`SELECT id, platform, source_kind AS sourceKind, source_url AS sourceUrl,
    context, suggested_reply AS suggestedReply, source_provenance AS sourceProvenance,
    status, created_at AS createdAt, updated_at AS updatedAt
    FROM engagement_drafts WHERE workspace_id=? AND brand_id=?
    ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(WORKSPACE_ID, brand.id, Math.max(1, Math.min(100, limit))).all<EngagementRow>();
  return {
    brandId: brand.id,
    providerInboxConnected: false,
    externalCommentScannerConnected: false,
    autoCommentEnabled: false,
    autoDmEnabled: false,
    outboundMessagesSent: 0,
    drafts: (result.results || []).map(toView),
  };
}

/** Approval is a review state, NOT permission to transmit messages. */
export async function reviewBrandEngagementDraft(env: EngagementEnv, brandId: string, input: ReviewInput) {
  const brand = await requireBrand(env, brandId);
  const db = storage(env);
  const id = clean(input.id, 80, "draft ID");
  const decision = input.decision;
  if (decision !== "approved_not_sent" && decision !== "rejected") throw new Error("Invalid review decision.");
  const now = new Date().toISOString();
  const changed = await db.prepare(`UPDATE engagement_drafts SET status=?, updated_at=?
    WHERE id=? AND brand_id=? AND workspace_id=? AND status='pending_review'`)
    .bind(decision, now, id, brand.id, WORKSPACE_ID).run();
  if (!changed.meta || Number(changed.meta.changes) !== 1) throw new Error("Draft does not exist in this brand or has already been reviewed.");
  return { id, brandId: brand.id, status: decision, sendEnabled: false, outboundMessagesSent: 0 };
}
