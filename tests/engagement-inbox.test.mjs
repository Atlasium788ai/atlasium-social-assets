import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const BRAND_A = "brand_atlasium_788_ai";
const BRAND_B = "brand_test_south";
const SIGNING_SECRET = "private-engagement-bridge-signing-key-for-tests-009";
const ID_SECRET = "private-engagement-id-hmac-key-for-tests-001";
const ctx = { waitUntil() {}, passThroughOnException() {} };

async function loadWorker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("inbox-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

async function memoryD1() {
  const database = new DatabaseSync(":memory:");
  const files = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  for (const file of files) {
    const contents = await readFile(new URL(file, new URL("../drizzle/", import.meta.url)), "utf8");
    for (const stmt of contents.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) database.exec(stmt);
  }
  class Prepared {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Prepared(this.sql, values); }
    async first() { return database.prepare(this.sql).get(...this.values) || null; }
    async all() { return { results: database.prepare(this.sql).all(...this.values), success: true }; }
    async run() {
      const result = database.prepare(this.sql).run(...this.values);
      return { success: true, meta: { changes: Number(result.changes) } };
    }
  }
  return { database, prepare(sql) { return new Prepared(sql); }, async batch(tasks) { return Promise.all(tasks.map((item) => item.run())); } };
}

async function fixture() {
  return {
    DB: await memoryD1(),
    UPLOADS: { async list() { return { objects: [], truncated: false }; }, async get() { return null; } },
    UPLOAD_KEY: "only-for-tests",
    ENGAGEMENT_INBOX_ENABLED: "true",
    ENGAGEMENT_INGEST_SECRET: SIGNING_SECRET,
    ENGAGEMENT_ID_SECRET: ID_SECRET,
    ASSETS: { async fetch() { return new Response("unused", { status: 404 }); } },
  };
}

function authorizedRequest(path, method = "GET", brandId = BRAND_A, body) {
  const headers = new Headers({ "Content-Type": "application/json", "X-Upload-Key": "only-for-tests" });
  if (brandId) headers.set("X-Brand-ID", brandId);
  return new Request(`https://example.invalid${path}`, {
    method, headers, ...(body ? { body: JSON.stringify(body) } : {})
  });
}

async function signedRequest(body, overrides = {}) {
  const raw = JSON.stringify(body);
  const timestamp = overrides.timestamp || String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SIGNING_SECRET), {
    name: "HMAC", hash: "SHA-256"
  }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${raw}`)));
  const mac = Array.from(signature, (n) => n.toString(16).padStart(2, "0")).join("");
  const headers = new Headers({
    "Content-Type": "application/json",
    "X-EchoFlow-Timestamp": timestamp,
    "X-EchoFlow-Signature": "sha256=" + (overrides.signature || mac),
  });
  return new Request("https://example.invalid/api/flow/engagement/inbound", {
    method: "POST", headers, body: overrides.raw || raw,
  });
}

function message(overrides = {}) {
  return {
    brandId: BRAND_A,
    platform: "instagram",
    providerAccountId: "verified-instagram-owned-account",
    providerEventId: "comment-00001",
    providerActorId: "person-identifier-PRIVATE",
    kind: "comment",
    receivedAt: new Date().toISOString(),
    incomingText: "Can I introduce my business here?",
    origin: "verified_provider_bridge",
    onOwnBrandAccount: true,
    ...overrides,
  };
}

async function initialize(worker, env) {
  const start = await worker.fetch(authorizedRequest("/api/flow/engagement"), env, ctx);
  assert.equal(start.status, 200);
  const when = new Date().toISOString();
  env.DB.database.prepare(`INSERT INTO brands (id, workspace_id, slug, name, logo_url, website, industry, location, timezone, status, created_at, updated_at)
    VALUES (?, 'workspace_atlasium', 'test-south', 'South Business', NULL, '', '', '', 'America/Toronto', 'active', ?, ?)`)
    .run(BRAND_B, when, when);
  env.DB.database.prepare(`INSERT INTO brand_profiles (brand_id, what_it_does, target_audience, main_offers, primary_cta, tone, words_use, words_avoid, visual_style, instructions, routing_rules, updated_at)
    VALUES (?, '', '', '', '', '', '', '', '', '', '{}', ?)`).run(BRAND_B, when);
  for (const [brand, accountId, providerId] of [
    [BRAND_A, "account-aaa", "verified-instagram-owned-account"],
    [BRAND_B, "account-bbb", "other-instagram-owned-account"],
  ]) {
    env.DB.database.prepare(`INSERT INTO engagement_inbox_accounts
      (id, workspace_id, brand_id, platform, provider_account_id, status, created_at, updated_at)
      VALUES (?, 'workspace_atlasium', ?, 'instagram', ?, 'read_enabled', ?, ?)`)
      .run(accountId, brand, providerId, when, when);
  }
}

test("inbound bridge fails closed without configuration and without a valid signature", async () => {
  const worker = await loadWorker(); const env = await fixture(); await initialize(worker, env);
  env.ENGAGEMENT_INBOX_ENABLED = "false";
  assert.equal((await worker.fetch(await signedRequest(message()), env, ctx)).status, 503);
  env.ENGAGEMENT_INBOX_ENABLED = "true";
  const unsigned = new Request("https://example.invalid/api/flow/engagement/inbound", {
    method: "POST", body: JSON.stringify(message()), headers: { "content-type": "application/json" }
  });
  assert.equal((await worker.fetch(unsigned, env, ctx)).status, 401);
  const forged = await signedRequest(message(), { signature: "0".repeat(64) });
  assert.equal((await worker.fetch(forged, env, ctx)).status, 401);
  const stale = await signedRequest(message(), { timestamp: String(Math.floor(Date.now() / 1000) - 900) });
  assert.equal((await worker.fetch(stale, env, ctx)).status, 401);
});

test("signed own-account comments dedupe, redact raw identity, and remain review-only", async () => {
  const worker = await loadWorker(); const env = await fixture(); await initialize(worker, env);
  const first = await worker.fetch(await signedRequest(message()), env, ctx);
  assert.equal(first.status, 202, await first.text().catch(() => ""));
  const data = await first.json();
  assert.equal(data.duplicate, false);
  assert.equal(data.outboundMessagesSent, 0);
  assert.equal(data.state, "pending_review");
  const replay = await (await worker.fetch(await signedRequest(message()), env, ctx)).json();
  assert.equal(replay.duplicate, true);

  const list = await (await worker.fetch(authorizedRequest("/api/flow/engagement/inbox"), env, ctx)).json();
  assert.equal(list.events.length, 1);
  assert.equal(list.authorizedInboxAccountRecords, 1);
  assert.equal(list.externalProviderConnectionVerified, false);
  assert.equal(list.autoReplyEnabled, false);
  assert.equal(list.events[0].sendEnabled, false);
  assert.equal(list.events[0].category, "general");
  const draft = list.events[0];
  assert.ok(!JSON.stringify(draft).includes("person-identifier-PRIVATE"));
  assert.ok(!JSON.stringify(draft).includes("Can I introduce"));
  const row = env.DB.database.prepare("SELECT actor_key, event_key, reply_text FROM engagement_inbox_events").get();
  assert.ok(!JSON.stringify(row).includes("person-identifier-PRIVATE"));
  assert.ok(!JSON.stringify(row).includes("Can I introduce"));

  const approve = await worker.fetch(authorizedRequest("/api/flow/engagement/inbox", "PATCH", BRAND_A, {
    id: draft.id, decision: "approved_not_sent"
  }), env, ctx);
  assert.equal(approve.status, 200);
  assert.equal((await approve.json()).outboundMessagesSent, 0);
  assert.equal(env.DB.database.prepare("SELECT status FROM engagement_inbox_events").get().status, "approved_not_sent");
});

test("brand ownership is checked against actual authorized inbox account mapping", async () => {
  const worker = await loadWorker(); const env = await fixture(); await initialize(worker, env);
  const wrong = message({ brandId: BRAND_B, providerEventId: "b-user-1" });
  const res = await worker.fetch(await signedRequest(wrong), env, ctx);
  assert.equal(res.status, 403);
  const noAccount = message({ providerAccountId: "not-connected-account" });
  assert.equal((await worker.fetch(await signedRequest(noAccount), env, ctx)).status, 403);
  const wrongOrigin = message({ origin: "scraped_competitor_comment" });
  assert.equal((await worker.fetch(await signedRequest(wrongOrigin), env, ctx)).status, 403);
  const falseOwnership = message({ onOwnBrandAccount: false });
  assert.equal((await worker.fetch(await signedRequest(falseOwnership), env, ctx)).status, 403);
  assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS count FROM engagement_inbox_events").get().count, 0);
});

test("opt-outs suppress prior drafts and subsequent messages from that actor", async () => {
  const worker = await loadWorker(); const env = await fixture(); await initialize(worker, env);
  await worker.fetch(await signedRequest(message({ kind: "dm", providerEventId: "dm-1", incomingText: "Can we discuss business finance?" })), env, ctx);
  const stop = await worker.fetch(await signedRequest(message({ kind: "dm", providerEventId: "dm-stop", incomingText: "STOP" })), env, ctx);
  assert.equal((await stop.json()).state, "suppressed");
  const later = await worker.fetch(await signedRequest(message({ providerEventId: "dm-after-stop", incomingText: "AI workflow" })), env, ctx);
  assert.equal((await later.json()).state, "suppressed");
  const rows = env.DB.database.prepare("SELECT status, reply_text FROM engagement_inbox_events").all();
  assert.equal(rows.length, 3);
  assert.ok(rows.every((item) => item.status === "suppressed" && item.reply_text === ""));
  assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS count FROM engagement_inbox_suppressions").get().count, 1);

  const b = await worker.fetch(await signedRequest(message({
    brandId: BRAND_B, providerAccountId: "other-instagram-owned-account",
    providerEventId: "other-brand-first", incomingText: "How can I automate customer questions?"
  })), env, ctx);
  assert.equal((await b.json()).state, "pending_review");
});

test("old DMs never become replyable drafts and unsupported kinds are rejected", async () => {
  const worker = await loadWorker(); const env = await fixture(); await initialize(worker, env);
  const older = message({
    kind: "dm", providerEventId: "older-dm",
    receivedAt: new Date(Date.now() - 30 * 3600_000).toISOString(),
  });
  const result = await worker.fetch(await signedRequest(older), env, ctx);
  assert.equal((await result.json()).state, "suppressed");
  const unsupported = message({ platform: "linkedin", kind: "dm" });
  assert.equal((await worker.fetch(await signedRequest(unsupported), env, ctx)).status, 400);
});

test("inbox reviews are scoped to their own brand and cannot transmit", async () => {
  const worker = await loadWorker(); const env = await fixture(); await initialize(worker, env);
  await worker.fetch(await signedRequest(message()), env, ctx);
  const a = await (await worker.fetch(authorizedRequest("/api/flow/engagement/inbox"), env, ctx)).json();
  const draftId = a.events[0].id;
  const unauthorized = await worker.fetch(authorizedRequest("/api/flow/engagement/inbox", "PATCH", BRAND_B, {
    id: draftId, decision: "approved_not_sent"
  }), env, ctx);
  assert.equal(unauthorized.status, 404);
  const b = await (await worker.fetch(authorizedRequest("/api/flow/engagement/inbox", "GET", BRAND_B), env, ctx)).json();
  assert.deepEqual(b.events, []);
  const send = await worker.fetch(authorizedRequest("/api/flow/engagement/inbox", "POST", BRAND_A, {
    id: draftId, decision: "send"
  }), env, ctx);
  assert.equal(send.status, 405);
  const unauthed = new Request("https://example.invalid/api/flow/engagement/inbox");
  assert.equal((await worker.fetch(unauthed, env, ctx)).status, 401);
});
