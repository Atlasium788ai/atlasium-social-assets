/* EchoFlow inbound engagement: signed internal bridge, brand/account isolated.
 *
 * This is a review-only adapter for normalized, authorized *own-account* events.
 * It is NOT a platform webhook verifier and must only be fed by a future
 * provider-specific adapter after that adapter verifies the provider signature.
 * No social API calls, external replies, DMs or automated posting occur here.
 */
import { requireBrand, WORKSPACE_ID } from "./brand-store";

type InboxEnv = {
  DB?: D1Database;
  UPLOADS: R2Bucket;
  ENGAGEMENT_INBOX_ENABLED?: string;
  ENGAGEMENT_INGEST_SECRET?: string;
  ENGAGEMENT_ID_SECRET?: string;
};

type InboxEvent = {
  brandId?: unknown;
  platform?: unknown;
  providerAccountId?: unknown;
  providerEventId?: unknown;
  providerActorId?: unknown;
  kind?: unknown;
  receivedAt?: unknown;
  incomingText?: unknown;
  origin?: unknown;
  onOwnBrandAccount?: unknown;
};

type InboxRow = {
  id: string;
  platform: string;
  kind: "dm" | "comment";
  category: string;
  replyText: string;
  status: "pending_review" | "approved_not_sent" | "rejected" | "suppressed";
  receivedAt: string;
  createdAt: string;
};

const MESSAGE_KINDS: Record<string, readonly string[]> = Object.freeze({
  instagram: ["comment", "dm"],
  facebook: ["comment", "dm"],
  linkedin: ["comment"],
  threads: ["comment"],
  tiktok: ["comment"],
  youtube: ["comment"],
  x: ["dm"],
});
const STOP_PATTERN = /^(?:please\s+)?(?:stop(?:\s+(?:contacting|messaging)\s+me)?|unsubscribe|opt[\s-]?out|do not (?:contact|message)(?: me)?|don't (?:contact|message)(?: me)?|remove me)[\s.!]*$/i;

export class InboxError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

const utf8 = new TextEncoder();

function dbFor(env: InboxEnv): D1Database {
  if (!env.DB) throw new InboxError(503, "Brand-isolated engagement storage is unavailable.");
  return env.DB;
}

function required(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new InboxError(400, "Invalid inbound event.");
  const text = value.trim();
  if (!text || text.length > max) throw new InboxError(400, `Invalid ${field} in inbound event.`);
  return text;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function unhex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/g) || [], (part) => Number.parseInt(part, 16));
}

async function hmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", utf8.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

async function pseudonymize(secret: string, value: string): Promise<string> {
  const key = await hmacKey(secret, ["sign"]);
  const raw = await crypto.subtle.sign("HMAC", key, utf8.encode(value));
  return hex(new Uint8Array(raw));
}

function labelMessage(message: string, kind: "dm" | "comment"): { category: string; draft: string; optOut: boolean } {
  const cleaned = message.replace(/\s+/g, " ").trim();
  const text = cleaned.toLocaleLowerCase("en");
  if (STOP_PATTERN.test(cleaned)) return { category: "opt_out", draft: "", optOut: true };
  if (/(?:promote|introduce|feature|share) (?:my|our) business|business spotlight|founder spotlight/.test(text))
    return {
      category: "founder_introduction",
      draft: "Thanks for reaching out. What does your business do, and what customer problem does it solve?",
      optOut: false,
    };
  if (/newsletter|subscribe|weekly brief/.test(text))
    return {
      category: "newsletter_interest",
      draft: "Please use the brand's official newsletter sign-up page when available. We won't add anyone to a mailing list without their opt-in.",
      optOut: false,
    };
  if (/\bai\b|automat|artificial intelligence|agentic/.test(text))
    return {
      category: "technology",
      draft: "Which business process are you considering AI or automation for? A specific example would make this conversation more useful.",
      optOut: false,
    };
  if (/cash ?flow|funding|financ|loan|credit|price|profit/.test(text))
    return {
      category: "business_finance",
      draft: "Are you thinking about cashflow, funding or pricing? Tell us the context and we can point to a relevant discussion or public resource.",
      optOut: false,
    };
  return {
    category: "general",
    draft: kind === "dm"
      ? "Thanks for contacting us. Is your question about a post, your business, or a resource we shared?"
      : "Thanks for contributing to the discussion. What's been your experience with this?",
    optOut: false,
  };
}

function validateInboundEvent(input: InboxEvent, now: Date) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new InboxError(400, "Invalid inbound event.");
  if (input.origin !== "verified_provider_bridge" || input.onOwnBrandAccount !== true)
    throw new InboxError(403, "Provider-origin and own-account verification are required.");
  const brandId = required(input.brandId, "brand", 160);
  const platform = required(input.platform, "platform", 40);
  if (!Object.hasOwn(MESSAGE_KINDS, platform)) throw new InboxError(400, "Unsupported inbox platform.");
  const kind = required(input.kind, "kind", 20) as "comment" | "dm";
  if (!MESSAGE_KINDS[platform].includes(kind)) throw new InboxError(400, "This platform message type is not enabled.");
  const providerAccountId = required(input.providerAccountId, "provider account", 200);
  const providerEventId = required(input.providerEventId, "provider event", 200);
  const providerActorId = required(input.providerActorId, "provider actor", 200);
  const incomingText = required(input.incomingText, "message", 1000);
  const receivedAt = required(input.receivedAt, "time", 50);
  const date = new Date(receivedAt);
  if (!Number.isFinite(date.getTime())
      || date.getTime() > now.getTime() + 300_000
      || date.getTime() < now.getTime() - 7 * 86_400_000)
    throw new InboxError(400, "Stale or invalid event timestamp.");
  return { brandId, platform, kind, providerAccountId, providerEventId, providerActorId, incomingText, receivedAt: date.toISOString(), date };
}

/** Signed **internal** bridge only. A social network's own signature must be verified BEFORE this hop. */
export async function ingestSignedInboxRequest(request: Request, env: InboxEnv, now = new Date()) {
  if (env.ENGAGEMENT_INBOX_ENABLED !== "true") throw new InboxError(503, "Social inbox ingestion is disabled.");
  const signingSecret = env.ENGAGEMENT_INGEST_SECRET;
  const identitySecret = env.ENGAGEMENT_ID_SECRET;
  if (!signingSecret || signingSecret.length < 32 || !identitySecret || identitySecret.length < 32)
    throw new InboxError(503, "The protected inbox bridge is not configured.");
  const timestamp = request.headers.get("X-EchoFlow-Timestamp") || "";
  const signature = request.headers.get("X-EchoFlow-Signature") || "";
  if (!/^\d{10,13}$/.test(timestamp) || !/^sha256=[0-9a-f]{64}$/.test(signature))
    throw new InboxError(401, "Inbox bridge signature required.");
  const requestTime = Number(timestamp);
  // Require Unix seconds, not milliseconds; prevents signature replay with stale timestamps.
  if (timestamp.length !== 10 || Math.abs(now.getTime() - requestTime * 1000) > 300_000)
    throw new InboxError(401, "Inbox signature timestamp has expired.");
  const statedLength = Number(request.headers.get("content-length") || 0);
  if (statedLength > 8192) throw new InboxError(413, "Inbox event exceeds size limit.");
  const raw = await request.text();
  if (utf8.encode(raw).length > 8192) throw new InboxError(413, "Inbox event exceeds size limit.");
  const signed = utf8.encode(timestamp + "." + raw);
  const key = await hmacKey(signingSecret, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key, unhex(signature.slice(7)), signed);
  if (!valid) throw new InboxError(401, "Invalid inbox bridge signature.");
  let parsed: InboxEvent;
  try { parsed = JSON.parse(raw) as InboxEvent; }
  catch { throw new InboxError(400, "Expected a signed JSON object."); }
  const item = validateInboundEvent(parsed, now);
  const db = dbFor(env);
  const brand = await requireBrand(env, item.brandId);
  const account = await db.prepare(`SELECT id FROM engagement_inbox_accounts
    WHERE workspace_id = ? AND brand_id = ? AND platform = ? AND provider_account_id = ?
      AND status = 'read_enabled' LIMIT 1`)
    .bind(WORKSPACE_ID, brand.id, item.platform, item.providerAccountId)
    .first<{ id: string }>();
  if (!account) throw new InboxError(403, "This social inbox account is not authorized for this brand.");
  const actorKey = await pseudonymize(identitySecret, [brand.id, item.platform, item.providerActorId].join("|"));
  const eventKey = await pseudonymize(identitySecret, [brand.id, account.id, item.providerEventId].join("|"));
  const existing = await db.prepare(`SELECT id, status FROM engagement_inbox_events
    WHERE workspace_id=? AND brand_id=? AND account_id=? AND event_key=? LIMIT 1`)
    .bind(WORKSPACE_ID, brand.id, account.id, eventKey).first<{ id: string; status: string }>();
  if (existing) return {
    brandId: brand.id, duplicate: true, accepted: true, state: existing.status,
    outboundMessagesSent: 0, sendEnabled: false,
  };
  const classification = labelMessage(item.incomingText, item.kind);
  // Honor authenticated opt-outs even when ordinary intake is full.
  // Signature, account authorization, validation and replay checks still run first.
  // Bound an individual brand's event volume. This is a failsafe, not a
  // substitute for provider API rate limiting or request-level quotas.
  const startOfWindow = new Date(now.getTime() - 86_400_000).toISOString();
  const recent = await db.prepare(`SELECT COUNT(*) AS count FROM engagement_inbox_events
    WHERE workspace_id=? AND brand_id=? AND created_at >= ?`)
    .bind(WORKSPACE_ID, brand.id, startOfWindow).first<{ count: number }>();
  if (!classification.optOut && Number(recent?.count || 0) >= 500)
    throw new InboxError(429, "Brand inbox daily intake cap reached.");
  const suppressed = await db.prepare(`SELECT id FROM engagement_inbox_suppressions
    WHERE workspace_id=? AND brand_id=? AND actor_key=? LIMIT 1`)
    .bind(WORKSPACE_ID, brand.id, actorKey).first<{ id: string }>();
  const tooOldForDm = item.kind === "dm" && (now.getTime() - item.date.getTime() > 24 * 3_600_000);
  const status = classification.optOut || suppressed || tooOldForDm ? "suppressed" : "pending_review";
  const id = `inbox_${crypto.randomUUID()}`;
  const createdAt = now.toISOString();
  // No raw message text or personal provider actor IDs are retained.
  await db.prepare(`INSERT OR IGNORE INTO engagement_inbox_events
    (id, workspace_id, brand_id, account_id, platform, kind, actor_key,
      event_key, category, reply_text, status, received_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, WORKSPACE_ID, brand.id, account.id, item.platform, item.kind, actorKey,
      eventKey, classification.category, status === "pending_review" ? classification.draft : "",
      status, item.receivedAt, createdAt, createdAt).run();
  if (classification.optOut) {
    const suppressionId = `sup_${crypto.randomUUID()}`;
    await db.prepare(`INSERT OR IGNORE INTO engagement_inbox_suppressions
      (id, workspace_id, brand_id, actor_key, reason, created_at)
      VALUES (?, ?, ?, ?, 'user_opt_out', ?)`)
      .bind(suppressionId, WORKSPACE_ID, brand.id, actorKey, createdAt).run();
    await db.prepare(`UPDATE engagement_inbox_events
      SET status='suppressed', reply_text='', updated_at=?
      WHERE workspace_id=? AND brand_id=? AND actor_key=?
      AND status IN ('pending_review', 'approved_not_sent')`)
      .bind(createdAt, WORKSPACE_ID, brand.id, actorKey).run();
  }
  return {
    brandId: brand.id, duplicate: false, accepted: true, state: status,
    classification: classification.category, outboundMessagesSent: 0, sendEnabled: false,
  };
}

export async function listInboundReviewQueue(env: InboxEnv, brandId: string, limit = 40) {
  const brand = await requireBrand(env, brandId);
  const db = dbFor(env);
  const [records, accountRows] = await Promise.all([
    db.prepare(`SELECT id, platform, kind, category, reply_text AS replyText,
      status, received_at AS receivedAt, created_at AS createdAt
      FROM engagement_inbox_events
      WHERE workspace_id=? AND brand_id=?
      ORDER BY created_at DESC, id DESC LIMIT ?`)
      .bind(WORKSPACE_ID, brand.id, Math.max(1, Math.min(limit, 100))).all<InboxRow>(),
    db.prepare(`SELECT COUNT(*) AS count FROM engagement_inbox_accounts
      WHERE workspace_id=? AND brand_id=? AND status='read_enabled'`)
      .bind(WORKSPACE_ID, brand.id).first<{ count: number }>(),
  ]);
  return {
    brandId: brand.id,
    authorizedInboxAccountRecords: Number(accountRows?.count || 0),
    externalProviderConnectionVerified: false,
    autoReplyEnabled: false,
    autoDmEnabled: false,
    outboundMessagesSent: 0,
    events: (records.results || []).map(row => ({
      ...row, sendEnabled: false, requiresReview: row.status === "pending_review",
    })),
  };
}

export async function reviewInboundDraft(env: InboxEnv, brandId: string, draftId: unknown, decision: unknown) {
  const brand = await requireBrand(env, brandId);
  const db = dbFor(env);
  const id = required(draftId, "inbox draft ID", 90);
  if (decision !== "approved_not_sent" && decision !== "rejected")
    throw new InboxError(400, "Invalid inbox review decision.");
  const now = new Date().toISOString();
  const change = await db.prepare(`UPDATE engagement_inbox_events
    SET status=?, updated_at=?
    WHERE id=? AND workspace_id=? AND brand_id=? AND status='pending_review'
      AND actor_key NOT IN (
        SELECT actor_key FROM engagement_inbox_suppressions
        WHERE workspace_id=? AND brand_id=?
      )`)
    .bind(decision, now, id, WORKSPACE_ID, brand.id, WORKSPACE_ID, brand.id).run();
  if (Number(change.meta?.changes || 0) !== 1)
    throw new InboxError(404, "Draft unavailable or already reviewed for this brand.");
  return { id, brandId: brand.id, status: decision, sendEnabled: false, outboundMessagesSent: 0 };
}

/** Editorial changes are brand-scoped and remain unsent even after approval. */
export async function reviseInboundDraft(env: InboxEnv, brandId: string, draftId: unknown, proposedText: unknown) {
  const brand = await requireBrand(env, brandId);
  const db = dbFor(env);
  const id = required(draftId, "inbox draft ID", 90);
  if (typeof proposedText !== "string") throw new InboxError(400, "Enter a reply draft.");
  const reply = proposedText.replace(/\s+/g, " ").trim();
  if (!reply || reply.length > 600) throw new InboxError(400, "Reply must be 1–600 characters.");
  if (/\b(follow us|check out our page|DM me|message me|guaranteed sales|guaranteed income)\b/i.test(reply)
      || /https?:\/\//i.test(reply)) {
    throw new InboxError(400, "Keep the draft useful and free of solicitation or unreviewed links.");
  }
  const changed = await db.prepare(`UPDATE engagement_inbox_events
    SET reply_text=?, updated_at=?
    WHERE id=? AND workspace_id=? AND brand_id=? AND status='pending_review'
      AND actor_key NOT IN (
        SELECT actor_key FROM engagement_inbox_suppressions
        WHERE workspace_id=? AND brand_id=?
      )`)
    .bind(reply, new Date().toISOString(), id, WORKSPACE_ID, brand.id, WORKSPACE_ID, brand.id).run();
  if (Number(changed.meta?.changes || 0) !== 1)
    throw new InboxError(404, "Draft cannot be edited for this brand.");
  return { id, brandId: brand.id, status: "pending_review", sendEnabled: false, outboundMessagesSent: 0 };
}
