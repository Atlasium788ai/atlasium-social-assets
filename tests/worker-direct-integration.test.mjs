import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const ATLASIUM_BRAND = "brand_atlasium_788_ai";
const direct = [{
  id: "test-page", brandId: ATLASIUM_BRAND, name: "Atlasium", displayName: "Atlasium",
  service: "facebook", accountId: "12345", accessToken: "private-test-token",
}];

async function testEnv() {
  const database = new DatabaseSync(":memory:");
  const files = (await readdir(new URL("../drizzle/", import.meta.url))).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint").map((x) => x.trim()).filter(Boolean)) database.exec(stmt);
  }
  class Prepared {
    constructor(sql, args = []) { this.sql = sql; this.args = args; }
    bind(...args) { return new Prepared(this.sql, args); }
    async first() { return database.prepare(this.sql).get(...this.args) || null; }
    async all() { return { results: database.prepare(this.sql).all(...this.args) }; }
    async run() { const result = database.prepare(this.sql).run(...this.args); return { meta: { changes: Number(result.changes) } }; }
  }
  const DB = { prepare(sql) { return new Prepared(sql); }, async batch(stmts) { return Promise.all(stmts.map((stmt) => stmt.run())); } };
  const filesStored = new Map();
  const UPLOADS = {
    async put(key, value) { filesStored.set(key, value); },
    async get(key) {
      if (!filesStored.has(key)) return null;
      return { body: new Response(filesStored.get(key)).body };
    },
    async list() { return { objects: [], truncated: false }; },
  };
  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    UPLOAD_KEY: "test-key", DIRECT_SOCIAL_CONNECTIONS: JSON.stringify(direct),
    OPENAI_API_KEY: "test-openai", DB, UPLOADS,
    TEST_NOW: "2026-11-20T14:00:00.000Z",
    DIRECT_SOCIAL_SCHEDULER_ENABLED: "true",
  };
  return { database, env };
}

async function worker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("test", Date.now().toString());
  return (await import(url.href)).default;
}

function agentRequest(overrides = {}) {
  return new Request("http://localhost/api/agent", {
    method: "POST",
    headers: { "X-Upload-Key": "test-key", "X-Brand-ID": ATLASIUM_BRAND, "Content-Type": "application/json" },
    body: JSON.stringify({
      brandId: ATLASIUM_BRAND,
      prompt: "Create one photo post about our latest update.",
      channels: ["test-page"], timing: "now", surfaceMode: "main", ...overrides,
    }),
  });
}

function mockedPlatforms() {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith("/v1/responses")) return Response.json({
      output: [{ content: [{ type: "output_text", text: JSON.stringify({
        campaign: "Brand launch", timing: "now",
        posts: [{ concept: "Update", caption: "New update", imagePrompt: "Modern blue abstract product background",
          personalLinkedInCaption: "", companyLinkedInCaption: "", instagramCaption: "", facebookCaption: "New update", tiktokCaption: "" }],
      }) }] }],
    });
    if (String(url).endsWith("/v1/images/generations"))
      return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
    if (String(url).includes("graph.facebook.com/"))
      return Response.json({ id: "photo-1", post_id: "12345_111" });
    throw new Error(`Unexpected remote call: ${url}`);
  };
  return { calls, fetch };
}

test("ECHO creates a single first-party Facebook feed post with no Story or intermediary", async () => {
  const { env, database } = await testEnv();
  const app = await worker();
  const mocked = mockedPlatforms();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mocked.fetch;
  try {
    const response = await app.fetch(agentRequest(), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].status, "SENT");
    assert.equal(data.results[0].surface, "feed");
    assert.equal(mocked.calls.filter((x) => x.includes("graph.facebook.com/")).length, 1);
    assert.equal(mocked.calls.filter((x) => x.includes("buffer")).length, 0);
    assert.equal(database.prepare("SELECT status FROM publish_jobs WHERE provider = 'direct'").get().status, "sent");
  } finally { globalThis.fetch = originalFetch; database.close(); }
});

test("ECHO schedules a direct post without contacting the platform before its due time", async () => {
  const { env, database } = await testEnv();
  const app = await worker();
  const mocked = mockedPlatforms();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mocked.fetch;
  try {
    const response = await app.fetch(agentRequest({
      timing: "schedule", selectedLocalTime: "2026-11-20T15:00",
    }), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].status, "SCHEDULED");
    assert.equal(mocked.calls.filter((x) => x.includes("graph.facebook.com/")).length, 0);
    const queue = database.prepare("SELECT state, brand_id, due_at FROM scheduled_social_posts").get();
    assert.equal(queue.state, "pending");
    assert.equal(queue.brand_id, ATLASIUM_BRAND);
    assert.equal(queue.due_at, "2026-11-20T20:00:00.000Z");
  } finally { globalThis.fetch = originalFetch; database.close(); }
});

test("ECHO rejects unsupported reels before costly image generation or publication", async () => {
  const { env, database } = await testEnv();
  const app = await worker();
  const mocked = mockedPlatforms();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mocked.fetch;
  try {
    const response = await app.fetch(agentRequest({ prompt: "Create one Reel for our latest update." }), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 422);
    assert.equal(mocked.calls.length, 0);
  } finally { globalThis.fetch = originalFetch; database.close(); }
});
