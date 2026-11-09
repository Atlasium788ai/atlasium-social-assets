/* Facebook Page + Instagram owned-account webhook adapter.
 * It validates Meta's signature and the subscription handshake; then relays
 * supported events to EchoFlow's already-signed internal intake. No sends.
 * Credentials, app review and account ownership must be configured separately.
 */
import { InboxError, ingestSignedInboxRequest } from "./engagement-inbox";

type MetaEnv = {
  DB?: D1Database;
  UPLOADS: R2Bucket;
  ENGAGEMENT_INBOX_ENABLED?: string;
  ENGAGEMENT_INGEST_SECRET?: string;
  ENGAGEMENT_ID_SECRET?: string;
  ECHOFLOW_META_WEBHOOK_ENABLED?: string;
  META_VERIFY_TOKEN?: string;
  META_APP_SECRET?: string;
  INSTAGRAM_APP_SECRET?: string;
};

type JsonObject = Record<string, unknown>;
type NormalizedEvent = {
  brandId: string;
  platform: string;
  providerAccountId: string;
  providerEventId: string;
  providerActorId: string;
  kind: "comment" | "dm";
  receivedAt: string;
  incomingText: string;
  origin: "verified_provider_bridge";
  onOwnBrandAccount: true;
};

export class MetaWebhookError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

const enc = new TextEncoder();
function obj(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
function list(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(obj).filter((v) => Object.keys(v).length > 0) : [];
}
function scalar(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
function timestamp(value: unknown): string | null {
  if (typeof value === "string" && /^(?:\d{4}-\d\d-\d\d)T/.test(value)) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 10_000_000_000 ? n : n * 1000;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function event(base: Omit<NormalizedEvent, "brandId" | "origin" | "onOwnBrandAccount">): Omit<NormalizedEvent, "brandId"> | null {
  if (!base.providerAccountId || !base.providerEventId || !base.providerActorId
    || !base.receivedAt || !base.incomingText || base.incomingText.length > 1000) return null;
  if (base.providerActorId === base.providerAccountId) return null;
  return { ...base, origin: "verified_provider_bridge", onOwnBrandAccount: true };
}

/** Strict, known event shapes only. Unsupported fields are ignored, never guessed. */
export function normalizeMetaEvents(data: unknown): Array<Omit<NormalizedEvent, "brandId">> {
  const payload = obj(data);
  const provider = payload.object;
  if (provider !== "instagram" && provider !== "page") return [];
  const all: Array<Omit<NormalizedEvent, "brandId">> = [];
  for (const entry of list(payload.entry)) {
    const account = scalar(entry.id);
    const accountTime = timestamp(entry.time);
    if (!account || !accountTime) continue;
    for (const change of list(entry.changes)) {
      const value = obj(change.value);
      const author = obj(value.from);
      const text = scalar(value.text || value.message);
      if (provider === "instagram" && change.field === "comments") {
        const result = event({
          platform: "instagram", kind: "comment", providerAccountId: account,
          providerEventId: scalar(value.id),
          providerActorId: scalar(author.id || value.from_id),
          incomingText: text, receivedAt: timestamp(value.timestamp) || accountTime,
        });
        if (result) all.push(result);
      } else if (provider === "page" && change.field === "feed"
        && value.item === "comment" && value.verb === "add") {
        const result = event({
          platform: "facebook", kind: "comment", providerAccountId: account,
          providerEventId: scalar(value.comment_id),
          providerActorId: scalar(author.id),
          incomingText: text, receivedAt: timestamp(value.created_time) || accountTime,
        });
        if (result) all.push(result);
      }
    }
    for (const item of list(entry.messaging)) {
      const message = obj(item.message);
      if (message.is_echo === true || message.is_deleted === true) continue;
      const sender = scalar(obj(item.sender).id);
      const recipient = scalar(obj(item.recipient).id);
      const result = event({
        platform: provider === "instagram" ? "instagram" : "facebook",
        kind: "dm", providerAccountId: account,
        providerEventId: scalar(message.mid), providerActorId: sender,
        incomingText: scalar(message.text),
        receivedAt: timestamp(item.timestamp) || accountTime,
      });
      if (recipient === account && result) all.push(result);
    }
  }
  return all;
}

async function key(secret: string, usage: KeyUsage[]) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);
}
function signatureBytes(value: string) {
  if (!/^sha256=[a-f0-9]{64}$/.test(value)) return null;
  return Uint8Array.from(value.slice(7).match(/.{2}/g) || [], (s) => Number.parseInt(s, 16));
}
async function validateSignature(raw: Uint8Array, signature: string, secrets: string[]) {
  const expected = signatureBytes(signature);
  if (!expected) return false;
  for (const secret of secrets) {
    if (!secret || secret.length < 24) continue;
    const signingKey = await key(secret, ["verify"]);
    if (await crypto.subtle.verify("HMAC", signingKey, expected, raw)) return true;
  }
  return false;
}

async function internalRequest(record: NormalizedEvent, env: MetaEnv) {
  const raw = JSON.stringify(record);
  const epoch = String(Math.floor(Date.now() / 1000));
  const signer = await key(env.ENGAGEMENT_INGEST_SECRET!, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", signer, enc.encode(epoch + "." + raw)));
  const hex = [...sig].map(n => n.toString(16).padStart(2, "0")).join("");
  return new Request("https://echoflow-internal.invalid/api/flow/engagement/inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json",
      "X-EchoFlow-Timestamp": epoch, "X-EchoFlow-Signature": "sha256=" + hex },
    body: raw,
  });
}

export async function metaWebhook(request: Request, env: MetaEnv): Promise<Response> {
  if (env.ECHOFLOW_META_WEBHOOK_ENABLED !== "true")
    throw new MetaWebhookError(503, "Meta inbox connection is not enabled.");
  if (request.method === "GET") {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") || "";
    if (mode !== "subscribe" || !env.META_VERIFY_TOKEN || token !== env.META_VERIFY_TOKEN
      || !/^\d{1,64}$/.test(challenge))
      throw new MetaWebhookError(403, "Webhook verification failed.");
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (request.method !== "POST") throw new MetaWebhookError(405, "Method not allowed.");
  if (env.ENGAGEMENT_INBOX_ENABLED !== "true" || !env.ENGAGEMENT_INGEST_SECRET || !env.ENGAGEMENT_ID_SECRET)
    throw new MetaWebhookError(503, "EchoFlow inbox intake is not configured.");
  const metaSecrets = [env.META_APP_SECRET, env.INSTAGRAM_APP_SECRET].filter((v): v is string => Boolean(v));
  if (!metaSecrets.length) throw new MetaWebhookError(503, "Meta signing credentials are not configured.");
  const body = new Uint8Array(await request.arrayBuffer());
  if (!body.length || body.length > 256_000) throw new MetaWebhookError(413, "Unsupported Meta payload size.");
  const signed = await validateSignature(body, request.headers.get("X-Hub-Signature-256") || "", metaSecrets);
  if (!signed) throw new MetaWebhookError(401, "Invalid Meta webhook signature.");
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder().decode(body)); }
  catch { throw new MetaWebhookError(400, "Invalid signed Meta payload."); }
  const records = normalizeMetaEvents(payload);
  if (records.length > 100) throw new MetaWebhookError(413, "Meta batch exceeds configured per-request event limit.");
  let accepted = 0;
  let ignored = 0;
  for (const record of records) {
    // Provider account ownership must have been verified and assigned first.
    // No client can select a brand ID using the incoming webhook body.
    if (!env.DB) throw new MetaWebhookError(503, "Inbox database unavailable.");
    const row = await env.DB.prepare(`SELECT brand_id AS brandId
      FROM engagement_inbox_accounts WHERE workspace_id='workspace_atlasium'
      AND provider_account_id=? AND platform=? AND status='read_enabled' LIMIT 1`)
      .bind(record.providerAccountId, record.platform).first<{ brandId: string }>();
    if (!row) { ignored++; continue; }
    try {
      await ingestSignedInboxRequest(await internalRequest({ ...record, brandId: row.brandId }, env), env);
      accepted++;
    } catch (error) {
      if (error instanceof InboxError && [400, 403, 429].includes(error.status)) { ignored++; continue; }
      throw error;
    }
  }
  return Response.json({ verified: true, accepted, ignored, externalMessagesSent: 0 },
    { status: 200, headers: { "Cache-Control": "no-store" } });
}
