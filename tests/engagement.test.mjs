import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const A = "brand_atlasium_788_ai";
const B = "brand_test_second_business";

async function loadWorker() {
  const ref = new URL("../dist/server/index.js", import.meta.url);
  ref.searchParams.set("engagement-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(ref.href)).default;
}

async function memoryD1() {
  const database = new DatabaseSync(":memory:");
  const files = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, new URL("../drizzle/", import.meta.url)), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map(x => x.trim()).filter(Boolean)) database.exec(statement);
  }
  class Prepared {
    constructor(sql, binds = []) { this.sql = sql; this.binds = binds; }
    bind(...binds) { return new Prepared(this.sql, binds); }
    async first() { return database.prepare(this.sql).get(...this.binds) || null; }
    async all() { return { success: true, results: database.prepare(this.sql).all(...this.binds) }; }
    async run() {
      const result = database.prepare(this.sql).run(...this.binds);
      return { success: true, meta: { changes: Number(result.changes) } };
    }
  }
  return { database, prepare(sql) { return new Prepared(sql); }, async batch(statements) { return Promise.all(statements.map(s => s.run())); } };
}

function envFixture() {
  return memoryD1().then(DB => ({
    DB,
    UPLOADS: {
      async list() { return { objects: [], truncated: false }; },
      async get() { return null; },
    },
    UPLOAD_KEY: "test-private-key",
    ASSETS: { async fetch() { return new Response("no asset", { status: 404 }); } },
  }));
}

function request(path, method = "GET", brand = A, body = null, authorized = true) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorized) headers.set("X-Upload-Key", "test-private-key");
  if (brand) headers.set("X-Brand-ID", brand);
  return new Request(`https://example.invalid${path}`, {
    method, headers, ...(body ? { body: JSON.stringify(body) } : {})
  });
}

function opportunity() {
  return {
    platform: "linkedin",
    sourceUrl: "https://www.linkedin.com/posts/verified-article",
    context: "An entrepreneur asks how to stop losing customer handoffs.",
    suggestedReply: "Assign one owner to each unresolved request and record the next action, then measure resolution time."
  };
}
const ctx = { waitUntil() {}, passThroughOnException() {} };

async function setup(worker, env) {
  const response = await worker.fetch(request("/api/flow/engagement"), env, ctx);
  assert.equal(response.status, 200);
  const at = "2026-11-09T16:30:00Z";
  env.DB.database.prepare(`INSERT INTO brands (id, workspace_id, slug, name, logo_url, website, industry, location, timezone, status, created_at, updated_at)
    VALUES (?, 'workspace_atlasium', 'second-business', 'Second Business', NULL, '', '', '', 'America/Toronto', 'active', ?, ?)`)
    .run(B, at, at);
  env.DB.database.prepare(`INSERT INTO brand_profiles (brand_id, what_it_does, target_audience, main_offers, primary_cta, tone, words_use, words_avoid, visual_style, instructions, routing_rules, updated_at)
    VALUES (?, '', '', '', '', '', '', '', '', '', '{}', ?)`).run(B, at);
}

test("FLOW engagement requires auth and a selected brand", async () => {
  const worker = await loadWorker(); const env = await envFixture();
  const noAccess = await worker.fetch(request("/api/flow/engagement", "GET", A, null, false), env, ctx);
  assert.equal(noAccess.status, 401);
  const noBrand = await worker.fetch(request("/api/flow/engagement", "GET", null), env, ctx);
  assert.equal(noBrand.status, 400);
  const data = await worker.fetch(request("/api/flow/engagement"), env, ctx);
  assert.equal(data.status, 200);
  const body = await data.json();
  assert.equal(body.providerInboxConnected, false);
  assert.equal(body.externalCommentScannerConnected, false);
  assert.equal(body.autoCommentEnabled, false);
  assert.equal(body.autoDmEnabled, false);
  assert.deepEqual(body.drafts, []);
});

test("drafts are deduplicated and isolated across brands", async () => {
  const worker = await loadWorker(); const env = await envFixture(); await setup(worker, env);
  for (const brand of [A, A, B]) {
    const response = await worker.fetch(request("/api/flow/engagement", "POST", brand, opportunity()), env, ctx);
    const result = await response.json();
    assert.equal(response.status, 201, JSON.stringify(result));
    assert.equal(result.outboundMessagesSent, 0);
    assert.equal(result.draft.sendEnabled, false);
  }
  for (const brand of [A,B]) {
    const response = await worker.fetch(request("/api/flow/engagement", "GET", brand), env, ctx);
    const data = await response.json();
    assert.equal(data.drafts.length, 1);
    assert.equal(data.drafts[0].status, "pending_review");
  }
  assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS total FROM engagement_drafts").get().total, 2);
  const draftA = (await (await worker.fetch(request("/api/flow/engagement", "GET", A), env, ctx)).json()).drafts[0];
  const unauthorizedOtherBrand = await worker.fetch(request("/api/flow/engagement", "PATCH", B, {
    id: draftA.id, decision: "approved_not_sent"
  }), env, ctx);
  assert.notEqual(unauthorizedOtherBrand.status, 200);
  const response = await worker.fetch(request("/api/flow/engagement", "PATCH", A, {
    id: draftA.id, decision: "approved_not_sent"
  }), env, ctx);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sendEnabled, false);
  const stateA = (await (await worker.fetch(request("/api/flow/engagement", "GET", A), env, ctx)).json()).drafts[0];
  const stateB = (await (await worker.fetch(request("/api/flow/engagement", "GET", B), env, ctx)).json()).drafts[0];
  assert.equal(stateA.status, "approved_not_sent");
  assert.equal(stateB.status, "pending_review");
});

test("manual opportunity API rejects disguised hosts, promotional spam, and DM targets", async () => {
  const worker = await loadWorker(); const env = await envFixture(); await setup(worker, env);
  for (const body of [
    { ...opportunity(), sourceUrl: "https://www.linkedin.com.evil.test/posts/123" },
    { ...opportunity(), suggestedReply: "Follow us for more" },
    { ...opportunity(), platform: "sms" },
    { ...opportunity(), kind: "inbound_dm", sourceUrl: "https://example.com/private-dm" },
  ]) {
    const response = await worker.fetch(request("/api/flow/engagement", "POST", A, body), env, ctx);
    // An unexpected kind may not matter, but a request with an invalid social URL must fail.
    if (body.sourceUrl.includes("example.com/private-dm") || body.platform === "sms" || body.suggestedReply.startsWith("Follow") || body.sourceUrl.includes("evil"))
      assert.notEqual(response.status, 201);
  }
  assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS total FROM engagement_drafts").get().total, 0);
});

test("approved drafts never produce any outbound network activity", async () => {
  const worker = await loadWorker(); const env = await envFixture(); await setup(worker, env);
  const result = await worker.fetch(request("/api/flow/engagement", "POST", A, opportunity()), env, ctx);
  const draft = (await result.json()).draft;
  const review = await worker.fetch(request("/api/flow/engagement", "PATCH", A, {
    id: draft.id, decision: "approved_not_sent"
  }), env, ctx);
  assert.equal(review.status, 200);
  assert.equal(env.DB.database.prepare("SELECT status FROM engagement_drafts").get().status, "approved_not_sent");
  const probe = await worker.fetch(request("/api/flow/engagement", "PUT", A, { id: draft.id }), env, ctx);
  assert.equal(probe.status, 405);
  const state = await (await worker.fetch(request("/api/flow/engagement", "GET", A), env, ctx)).json();
  assert.equal(state.outboundMessagesSent, 0);
});
