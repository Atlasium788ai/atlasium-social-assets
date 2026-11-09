import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const ATLASIUM = "brand_atlasium_788_ai";
const OTHER = "brand_test_other";
const ctx = { waitUntil() {}, passThroughOnException() {} };

async function loadWorker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("engagement-suggestion-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

async function memoryD1() {
  const db = new DatabaseSync(":memory:");
  const files = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, new URL("../drizzle/", import.meta.url)), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) db.exec(stmt);
  }
  class Prepared {
    constructor(sql, vals = []) { this.sql = sql; this.vals = vals; }
    bind(...vals) { return new Prepared(this.sql, vals); }
    async first() { return db.prepare(this.sql).get(...this.vals) || null; }
    async all() { return { results: db.prepare(this.sql).all(...this.vals), success: true }; }
    async run() { const out = db.prepare(this.sql).run(...this.vals); return { success:true, meta:{ changes:Number(out.changes) } }; }
  }
  return { database: db, prepare(sql) { return new Prepared(sql); }, async batch(sqls) { return Promise.all(sqls.map((s) => s.run())); } };
}

async function fixture() {
  return {
    DB: await memoryD1(),
    UPLOADS: { async list() { return { objects: [], truncated: false }; }, async get() { return null; } },
    UPLOAD_KEY: "test-key",
    OPENAI_API_KEY: "mock-key",
    OPENAI_TEXT_MODEL: "test-model",
    ASSETS: { async fetch() { return new Response("not used", {status:404}); } },
  };
}

function request(method="POST", brand=ATLASIUM, body={}, auth=true) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (brand) headers.set("X-Brand-ID", brand);
  if (auth) headers.set("X-Upload-Key", "test-key");
  return new Request("https://example.invalid/api/flow/engagement/suggest", {
    method, headers, ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}
function payload() {
  return {
    platform: "linkedin",
    sourceUrl: "https://www.linkedin.com/posts/a-real-post",
    context: "An owner asks how to handle customer follow-up when the first message is not answered.",
  };
}
async function init(worker, env) {
  const response = await worker.fetch(new Request("https://example.invalid/api/flow/engagement", {
    headers: { "X-Upload-Key":"test-key", "X-Brand-ID": ATLASIUM }
  }), env, ctx);
  assert.equal(response.status, 200);
  const at = new Date().toISOString();
  env.DB.database.prepare(`INSERT INTO brands (id, workspace_id, slug, name, logo_url, website, industry, location, timezone, status, created_at, updated_at)
    VALUES (?, 'workspace_atlasium', 'other', 'Other Brand', NULL, '', '', '', 'America/Toronto', 'active', ?, ?)`)
    .run(OTHER, at, at);
  env.DB.database.prepare(`INSERT INTO brand_profiles (brand_id, what_it_does, target_audience, main_offers, primary_cta, tone, words_use, words_avoid, visual_style, instructions, routing_rules, updated_at)
    VALUES (?, '', '', '', '', 'Serious, calm', '', '', '', '', '{}', ?)`)
    .run(OTHER, at);
}

test("AI suggestion requires authentication, selected brand and public context", async () => {
  const worker = await loadWorker(); const env = await fixture();
  await init(worker, env);
  const unauth = await worker.fetch(request("POST", ATLASIUM, payload(), false), env, ctx);
  assert.equal(unauth.status, 401);
  assert.equal((await worker.fetch(request("POST", null, payload()), env, ctx)).status, 400);
  assert.equal((await worker.fetch(request("GET", ATLASIUM), env, ctx)).status, 405);
  const badHost = await worker.fetch(request("POST", ATLASIUM, {
    ...payload(), sourceUrl: "https://www.linkedin.com.malicious.invalid/posts/1"
  }), env, ctx);
  assert.equal(badHost.status, 400);
  const sensitive = await worker.fetch(request("POST", ATLASIUM, {
    ...payload(), context: "Here is my password: abc123"
  }), env, ctx);
  assert.equal(sensitive.status, 400);
});

test("existing AI provider generates one brand-specific, non-sending review draft", async () => {
  const worker = await loadWorker(); const env = await fixture(); await init(worker, env);
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, opts) => {
    assert.match(String(url), /^https:\/\/api\.openai\.com\/v1\/responses$/);
    calls++;
    const data = JSON.parse(opts.body);
    assert.equal(data.model, "test-model");
    assert.equal(data.text.format.name, "echoflow_engagement_suggestion");
    assert.match(JSON.stringify(data.input), /Atlasium 7\/88 AI/);
    assert.match(JSON.stringify(data.input), /first message is not answered/);
    return Response.json({ output: [{ content: [{
      type: "output_text",
      text: JSON.stringify({ reply: "Define who owns each inquiry and when a second response is due. How are you tracking unanswered handoffs?" }),
    }] }] });
  };
  try {
    const response = await worker.fetch(request("POST", ATLASIUM, payload()), env, ctx);
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.requiresHumanReview, true);
    assert.equal(result.saved, false);
    assert.equal(result.outboundMessagesSent, 0);
    assert.equal(result.sendEnabled, false);
    assert.match(result.suggestedReply, /unanswered handoffs/i);
    assert.equal(calls, 1);
    assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS total FROM engagement_drafts").get().total, 0);
    assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action='engagement_ai_reply_suggested'").get().total, 1);
  } finally { globalThis.fetch = original; }
});

test("usage limits are enforced per brand and no provider call is made after quota", async () => {
  const worker = await loadWorker(); const env = await fixture(); await init(worker, env);
  const at = new Date().toISOString();
  const insert = env.DB.database.prepare(`INSERT INTO audit_logs
    (id, workspace_id, brand_id, actor_id, action, details, created_at)
    VALUES (?, 'workspace_atlasium', ?, 'owner', 'engagement_ai_reply_suggested', '{}', ?)`);
  for (let i=0;i<20;i++) insert.run(`quota-${i}`, ATLASIUM, at);
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Provider must not be called after quota"); };
  try {
    const response = await worker.fetch(request("POST", ATLASIUM, payload()), env, ctx);
    assert.equal(response.status, 429);
    const other = await worker.fetch(request("POST", OTHER, payload()), env, ctx);
    assert.equal(other.status, 400, "Test provider throws for other brand; quota should not be shared and error is surfaced");
  } finally { globalThis.fetch = original; }
});

test("AI suggestions containing links or promotions are refused", async () => {
  const worker = await loadWorker(); const env = await fixture(); await init(worker, env);
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ output: [{ content: [{
    type:"output_text",
    text: JSON.stringify({ reply: "Follow us at https://example.com/redirect for more." }),
  }] }] });
  try {
    const response = await worker.fetch(request("POST", ATLASIUM, payload()), env, ctx);
    assert.equal(response.status, 422);
    assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action='engagement_ai_reply_suggested'").get().total, 0);
  } finally { globalThis.fetch = original; }
});
