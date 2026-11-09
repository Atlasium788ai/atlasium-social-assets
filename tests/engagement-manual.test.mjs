import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const BRAND_A = "brand_atlasium_788_ai";
const BRAND_B = "brand_test_engagement_second";
const ctx = { waitUntil() {}, passThroughOnException() {} };

async function loadWorker() {
  const ref = new URL("../dist/server/index.js", import.meta.url);
  ref.searchParams.set("engagement-manual-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(ref.href)).default;
}
async function memoryDB() {
  const database = new DatabaseSync(":memory:");
  const files = (await readdir(new URL("../drizzle/", import.meta.url))).filter(p => /^\d+_.+\.sql$/.test(p)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, new URL("../drizzle/", import.meta.url)), "utf8");
    for (const segment of sql.split("--> statement-breakpoint").map(x => x.trim()).filter(Boolean))
      database.exec(segment);
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
  return { database, prepare(sql) { return new Prepared(sql); }, async batch(stmts) { return Promise.all(stmts.map(s => s.run())); } };
}
async function envFixture() {
  return {
    DB: await memoryDB(),
    UPLOADS: { async list() { return { objects: [], truncated: false }; }, async get() { return null; } },
    UPLOAD_KEY: "test-key",
    ASSETS: { async fetch() { return new Response("unused", { status: 404 }); } },
  };
}
function request(path, method="GET", brand=BRAND_A, body=null, authenticated=true) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authenticated) headers.set("X-Upload-Key", "test-key");
  if (brand) headers.set("X-Brand-ID", brand);
  return new Request(`https://example.invalid${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function initialize(worker, env) {
  const ping = await worker.fetch(request("/api/flow/engagement"), env, ctx);
  assert.equal(ping.status, 200);
  const now = new Date().toISOString();
  env.DB.database.prepare(`INSERT INTO brands
    (id, workspace_id, slug, name, logo_url, website, industry, location, timezone, status, created_at, updated_at)
    VALUES (?, 'workspace_atlasium', 'second-brand', 'Second brand', NULL, '', '', '', 'America/Toronto', 'active', ?, ?)`)
    .run(BRAND_B, now, now);
  env.DB.database.prepare(`INSERT INTO brand_profiles
    (brand_id, what_it_does, target_audience, main_offers, primary_cta, tone, words_use, words_avoid, visual_style, instructions, routing_rules, updated_at)
    VALUES (?, '', '', '', '', '', '', '', '', '', '{}', ?)`).run(BRAND_B, now);
}
async function save(worker, env, brand=BRAND_A, suffix="intro") {
  const draft = await worker.fetch(request("/api/flow/engagement", "POST", brand, {
    platform: "linkedin",
    sourceUrl: `https://www.linkedin.com/posts/public-${suffix}`,
    context: "A real founder is asking which business task should be automated first.",
    suggestedReply: "Start with a repeatable task with a clear owner and outcome. Which task causes the most rework?"
  }), env, ctx);
  const body = await draft.json();
  assert.equal(draft.status, 201, JSON.stringify(body));
  return body.draft.id;
}
async function approve(worker, env, id, brand=BRAND_A) {
  const r = await worker.fetch(request("/api/flow/engagement", "PATCH", brand, { id, decision: "approved_not_sent" }), env, ctx);
  assert.equal(r.status, 200);
}
test("manual engagement evidence requires auth, approval and explicit confirmation", async () => {
  const worker = await loadWorker(); const env = await envFixture(); await initialize(worker, env);
  const id = await save(worker, env);
  const endpoint = "/api/flow/engagement/manual-confirm";
  const payload = { id, confirmation: "I_POSTED_THIS_MANUALLY" };
  assert.equal((await worker.fetch(request(endpoint, "POST", BRAND_A, payload, false), env, ctx)).status, 401);
  assert.equal((await worker.fetch(request(endpoint, "POST", null, payload), env, ctx)).status, 400);
  assert.equal((await worker.fetch(request(endpoint, "POST", BRAND_A, payload), env, ctx)).status, 400);
  await approve(worker, env, id);
  assert.equal((await worker.fetch(request(endpoint, "POST", BRAND_A, {id}), env, ctx)).status, 400);
  const res = await worker.fetch(request(endpoint, "POST", BRAND_A, payload), env, ctx);
  const confirmed = await res.json();
  assert.equal(res.status, 200, JSON.stringify(confirmed));
  assert.equal(confirmed.providerVerified, false);
  assert.equal(confirmed.outboundMessagesSent, 0);
  assert.equal(confirmed.automatedSend, false);
  assert.equal(confirmed.duplicate, false);
  const repeat = await (await worker.fetch(request(endpoint, "POST", BRAND_A, payload), env, ctx)).json();
  assert.equal(repeat.duplicate, true);
  assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS n FROM engagement_manual_actions").get().n, 1);
  const list = await (await worker.fetch(request("/api/flow/engagement"), env, ctx)).json();
  assert.equal(list.metrics.pendingReview, 0);
  assert.equal(list.metrics.approvedWaitingManual, 0);
  assert.equal(list.metrics.manuallyConfirmedSelfReported, 1);
  assert.equal(list.metrics.providerVerifiedPublications, 0);
  assert.equal(list.drafts[0].manualConfirmationOnly, true);
  assert.ok(list.drafts[0].manualConfirmedAt);
});
test("manual outcome cannot be confirmed under another brand", async () => {
  const worker = await loadWorker(); const env = await envFixture(); await initialize(worker, env);
  const a = await save(worker, env, BRAND_A, "owner-a");
  const b = await save(worker, env, BRAND_B, "owner-b");
  await approve(worker, env, a, BRAND_A);
  await approve(worker, env, b, BRAND_B);
  const path = "/api/flow/engagement/manual-confirm";
  const wrong = await worker.fetch(request(path, "POST", BRAND_B, { id: a, confirmation: "I_POSTED_THIS_MANUALLY" }), env, ctx);
  assert.equal(wrong.status, 400);
  const good = await worker.fetch(request(path, "POST", BRAND_B, { id: b, confirmation: "I_POSTED_THIS_MANUALLY" }), env, ctx);
  assert.equal(good.status, 200);
  const resultA = await (await worker.fetch(request("/api/flow/engagement", "GET", BRAND_A), env, ctx)).json();
  const resultB = await (await worker.fetch(request("/api/flow/engagement", "GET", BRAND_B), env, ctx)).json();
  assert.equal(resultA.metrics.manuallyConfirmedSelfReported, 0);
  assert.equal(resultB.metrics.manuallyConfirmedSelfReported, 1);
  assert.equal(resultA.metrics.approvedWaitingManual, 1);
  assert.equal(resultB.metrics.approvedWaitingManual, 0);
});
