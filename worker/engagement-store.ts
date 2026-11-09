/* Shared EchoFlow engagement engine: brand-scoped manual review queue.
 * This module does not scan, message, post, or call social network APIs.
 * No automated outbound action can be triggered by an approved draft.
 */
import { audit, requireBrand, WORKSPACE_ID } from "./brand-store";

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
  manualConfirmedAt: string | null;
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
    providerVerified: false,
    manualConfirmationOnly: Boolean(row.manualConfirmedAt),
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
  const result = await db.prepare(`SELECT e.id, e.platform, e.source_kind AS sourceKind, e.source_url AS sourceUrl,
    e.context, e.suggested_reply AS suggestedReply, e.source_provenance AS sourceProvenance,
    e.status, e.created_at AS createdAt, e.updated_at AS updatedAt, a.confirmed_at AS manualConfirmedAt
    FROM engagement_drafts e
    LEFT JOIN engagement_manual_actions a
      ON a.draft_id=e.id AND a.workspace_id=e.workspace_id AND a.brand_id=e.brand_id
    WHERE e.workspace_id=? AND e.brand_id=?
    ORDER BY e.created_at DESC, e.id DESC LIMIT ?`)
    .bind(WORKSPACE_ID, brand.id, Math.max(1, Math.min(100, limit))).all<EngagementRow>();
  const metrics = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM engagement_drafts WHERE workspace_id=? AND brand_id=? AND status='pending_review') AS pendingReview,
      (SELECT COUNT(*) FROM engagement_drafts e LEFT JOIN engagement_manual_actions a
        ON a.workspace_id=e.workspace_id AND a.brand_id=e.brand_id AND a.draft_id=e.id
        WHERE e.workspace_id=? AND e.brand_id=? AND e.status='approved_not_sent' AND a.id IS NULL) AS approvedWaitingManual,
      (SELECT COUNT(*) FROM engagement_manual_actions WHERE workspace_id=? AND brand_id=?) AS manuallyConfirmed
    `).bind(WORKSPACE_ID, brand.id, WORKSPACE_ID, brand.id, WORKSPACE_ID, brand.id).first<{
      pendingReview: number; approvedWaitingManual: number; manuallyConfirmed: number
    }>();
  return {
    brandId: brand.id,
    providerInboxConnected: false,
    externalCommentScannerConnected: false,
    autoCommentEnabled: false,
    autoDmEnabled: false,
    outboundMessagesSent: 0,
    metrics: {
      pendingReview: Number(metrics?.pendingReview || 0),
      approvedWaitingManual: Number(metrics?.approvedWaitingManual || 0),
      manuallyConfirmedSelfReported: Number(metrics?.manuallyConfirmed || 0),
      providerVerifiedPublications: 0,
    },
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

/** A user confirms they themselves posted a previously approved public comment.
 * This does NOT contact a provider or claim a provider-verified publication.
 */
export async function confirmManuallyPostedEngagement(
  env: EngagementEnv, brandId: string, input: Record<string, unknown>
) {
  const brand = await requireBrand(env, brandId);
  const db = storage(env);
  const id = clean(input.id, 80, "draft ID");
  if (input.confirmation !== "I_POSTED_THIS_MANUALLY")
    throw new Error("Explicit manual-post confirmation required.");
  const draft = await db.prepare(`SELECT id, platform, status FROM engagement_drafts
    WHERE id=? AND workspace_id=? AND brand_id=? AND source_kind='external_opportunity' LIMIT 1`)
    .bind(id, WORKSPACE_ID, brand.id).first<{ id: string; platform: string; status: string }>();
  if (!draft || draft.status !== "approved_not_sent")
    throw new Error("Only previously approved public comments can be marked manually posted.");
  const now = new Date().toISOString();
  const saved = await db.prepare(`INSERT OR IGNORE INTO engagement_manual_actions
    (id, workspace_id, brand_id, draft_id, platform, confirmation_source, confirmed_at)
    VALUES (?, ?, ?, ?, ?, 'self_reported', ?)`)
    .bind(`manual_${crypto.randomUUID()}`, WORKSPACE_ID, brand.id, draft.id, draft.platform, now).run();
  if (Number(saved.meta?.changes || 0) === 1)
    await audit(env, brand.id, "engagement_comment_manually_confirmed",
      { draftId: draft.id, platform: draft.platform, providerVerified: false, externalMessagesSentByEchoFlow: 0 });
  const record = await db.prepare(`SELECT confirmed_at AS confirmedAt FROM engagement_manual_actions
    WHERE workspace_id=? AND brand_id=? AND draft_id=? LIMIT 1`)
    .bind(WORKSPACE_ID, brand.id, id).first<{ confirmedAt: string }>();
  return {
    brandId: brand.id, id: draft.id, manuallyConfirmedAt: record?.confirmedAt || now,
    confirmationSource: "self_reported", providerVerified: false,
    automatedSend: false, outboundMessagesSent: 0,
    duplicate: Number(saved.meta?.changes || 0) === 0,
  };
}
