import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const BRAND_A = "brand_atlasium_788_ai";
const BRAND_B = "brand_test_northstar";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("echo-content-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

async function memoryD1() {
  const database = new DatabaseSync(":memory:");
  const files = (await readdir(new URL("../drizzle/", import.meta.url))).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  for (const file of files) {
    const migration = await readFile(new URL(file, new URL("../drizzle/", import.meta.url)), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) database.exec(statement);
  }
  class Prepared {
    constructor(sql, bindings = []) { this.sql = sql; this.bindings = bindings; }
    bind(...bindings) { return new Prepared(this.sql, bindings); }
    async first() { return database.prepare(this.sql).get(...this.bindings) || null; }
    async all() { return { success: true, results: database.prepare(this.sql).all(...this.bindings) }; }
    async run() { const result = database.prepare(this.sql).run(...this.bindings); return { success: true, meta: { changes: Number(result.changes) } }; }
  }
  return { database, prepare(sql) { return new Prepared(sql); }, async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); } };
}

function memoryR2() {
  const values = new Map();
  return {
    values,
    async put(key, body, options = {}) { const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer()); values.set(key, { bytes, options }); },
    async get(key) { const stored = values.get(key); if (!stored) return null; return { body: new Blob([stored.bytes]).stream(), httpEtag: `etag-${key}`, writeHttpMetadata() {} }; },
    async list({ prefix = "" } = {}) { return { objects: [...values.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false }; },
  };
}

function request(path, init = {}, brandId = BRAND_A) {
  const headers = new Headers(init.headers || {}); headers.set("X-Upload-Key", "test-key"); if (brandId) headers.set("X-Brand-ID", brandId);
  return new Request(`http://localhost${path}`, { ...init, headers });
}

function blogPayload() {
  return {
    title: "A practical follow-up system", subtitle: "How consistent follow-up supports better conversations", introduction: "A clear introduction grounded in the supplied brief.",
    sections: [{ heading: "Start with the inquiry", body: "Record the inquiry and the next agreed step." }, { heading: "Keep the follow-up useful", body: "Each message should add clarity rather than noise." }],
    conclusion: "Consistency makes the process easier to manage.", callToAction: "Start a conversation with Atlasium.", excerpt: "A practical guide to consistent follow-up.", slug: "practical-follow-up-system",
    metaTitle: "A practical follow-up system", metaDescription: "Learn how to create a clear and consistent follow-up process.", categories: ["Revenue systems"], tags: ["follow-up", "operations"],
    featuredImageConcept: "A clean editorial view of an organized follow-up workflow", featuredImageAltText: "An organized follow-up workflow on a dark interface",
  };
}

function newsletterPayload() {
  return { subjectLines: ["A clearer follow-up process", "Make every inquiry easier to manage", "A practical note on consistent follow-up"], previewText: "A short guide for business owners.", headline: "Keep the next step clear", opening: "Every inquiry should have a clear next step.", sections: [{ heading: "Make it visible", body: "Keep the current status and next action in one place." }], callToAction: "Start a conversation with Atlasium.", closing: "Keep the process simple and useful." };
}

function mockOpenAI() {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    assert.match(String(url), /api\.openai\.com\/v1\/responses/);
    const body = JSON.parse(init.body);
    const name = body.text?.format?.name;
    const output = name === "echo_blog_draft" ? blogPayload() : name === "echo_newsletter_draft" ? newsletterPayload() : name === "echo_section_revision" ? { replacement: "A revised introduction that changes only this selected section." } : null;
    if (!output) throw new Error(`Unexpected OpenAI schema: ${name}`);
    return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(output) }] }] });
  };
  return { calls, fetch };
}

async function testEnv() {
  const DB = await memoryD1();
  return { DB, UPLOADS: memoryR2(), UPLOAD_KEY: "test-key", OPENAI_API_KEY: "mock-openai", ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
}

async function initialize(worker, env) {
  const response = await worker.fetch(request("/api/echo/content/workspace"), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 200);
  const createdAt = "2026-08-20T12:00:00.000Z";
  env.DB.database.prepare("INSERT INTO brands (id, workspace_id, slug, name, logo_url, website, industry, location, timezone, status, created_at, updated_at) VALUES (?, 'workspace_atlasium', 'northstar', 'Northstar', NULL, '', '', '', 'America/Toronto', 'active', ?, ?)").run(BRAND_B, createdAt, createdAt);
  env.DB.database.prepare("INSERT INTO brand_profiles (brand_id, what_it_does, target_audience, main_offers, primary_cta, tone, words_use, words_avoid, visual_style, instructions, routing_rules, updated_at) VALUES (?, '', '', '', '', 'direct', '', '', '', '', '{}', ?)").run(BRAND_B, createdAt);
}

async function createDraft(worker, env, contentType) {
  const response = await worker.fetch(request("/api/echo/content/drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId: BRAND_A, contentType, prompt: `Create a ${contentType} about consistent follow-up for business owners.`, settings: { tone: "direct", length: "standard" } }) }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 201);
  return (await response.json()).draft;
}

test("ECHO presents Social, Blog and Newsletter without changing the product hierarchy", async () => {
  const [page, navigation, styles] = await Promise.all([readFile(new URL("../app/page.tsx", import.meta.url), "utf8"), readFile(new URL("../app/components/product-navigation.tsx", import.meta.url), "utf8"), readFile(new URL("../app/globals.css", import.meta.url), "utf8")]);
  for (const label of ["SOCIAL", "BLOG", "NEWSLETTER"]) assert.match(page, new RegExp(`"${label}"`));
  assert.match(navigation, /ECHO[\s\S]*FLOW[\s\S]*AMPLIFY/);
  assert.doesNotMatch(navigation, /BLOG|NEWSLETTER/);
  assert.match(styles, /@media\(max-width:430px\)\{[\s\S]*?\.echo-content-studio[^}]*overflow-x:hidden/);
});

test("Blog and Newsletter generation return every required structured field and safe newsletter output", async () => {
  const worker = await loadWorker(); const env = await testEnv(); await initialize(worker, env);
  const originalFetch = globalThis.fetch; const openai = mockOpenAI(); globalThis.fetch = openai.fetch;
  try {
    const blog = await createDraft(worker, env, "blog");
    for (const field of ["title", "subtitle", "introduction", "sections", "conclusion", "callToAction", "excerpt", "slug", "metaTitle", "metaDescription", "categories", "tags", "featuredImageConcept", "featuredImageAltText"]) assert.ok(field in blog.payload, field);
    const newsletter = await createDraft(worker, env, "newsletter");
    for (const field of ["subjectLines", "previewText", "headline", "opening", "sections", "callToAction", "closing", "plainText", "html"]) assert.ok(field in newsletter.payload, field);
    assert.equal(newsletter.payload.subjectLines.length, 3);
    assert.match(newsletter.payload.html, /<article>/); assert.doesNotMatch(newsletter.payload.html, /script|iframe|onerror/i);
    assert.equal(openai.calls.length, 2);
    assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'content_draft_created'").get().count, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test("draft saves preserve manual edits, sanitize HTML, revise only one section and undo the latest AI revision", async () => {
  const worker = await loadWorker(); const env = await testEnv(); await initialize(worker, env);
  const originalFetch = globalThis.fetch; const openai = mockOpenAI(); globalThis.fetch = openai.fetch;
  try {
    const blog = await createDraft(worker, env, "blog");
    const manual = { ...blog.payload, title: "My manually edited title", introduction: "My manually edited introduction" };
    const savedResponse = await worker.fetch(request(`/api/echo/content/drafts/${blog.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: manual, status: "draft" }) }), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(savedResponse.status, 200);
    const saved = (await savedResponse.json()).draft;
    assert.equal(saved.payload.title, manual.title); assert.equal(saved.payload.introduction, manual.introduction);

    const revisedResponse = await worker.fetch(request(`/api/echo/content/drafts/${blog.id}/revise`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId: BRAND_A, operation: "regenerate", section: "introduction" }) }), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(revisedResponse.status, 200);
    const revised = (await revisedResponse.json()).draft;
    assert.equal(revised.payload.title, manual.title); assert.deepEqual(revised.payload.sections, manual.sections); assert.notEqual(revised.payload.introduction, manual.introduction);

    const undoneResponse = await worker.fetch(request(`/api/echo/content/drafts/${blog.id}/undo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId: BRAND_A }) }), env, { waitUntil() {}, passThroughOnException() {} });
    const undone = (await undoneResponse.json()).draft;
    assert.equal(undone.payload.title, manual.title); assert.equal(undone.payload.introduction, manual.introduction);
    for (const action of ["content_draft_updated", "content_section_revised", "content_revision_undone"]) assert.ok(env.DB.database.prepare("SELECT 1 FROM audit_logs WHERE action = ?").get(action));

    const newsletter = await createDraft(worker, env, "newsletter");
    const unsafe = { ...newsletter.payload, html: '<article><h1>Hello</h1><script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)">Bad</a></article>' };
    const sanitizedResponse = await worker.fetch(request(`/api/echo/content/drafts/${newsletter.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: unsafe }) }), env, { waitUntil() {}, passThroughOnException() {} });
    const sanitized = (await sanitizedResponse.json()).draft.payload.html;
    assert.match(sanitized, /<h1>Hello<\/h1>/); assert.doesNotMatch(sanitized, /script|onerror|javascript:|<img/i);
  } finally { globalThis.fetch = originalFetch; }
});

test("brand scoping blocks cross-brand access and switching returns no stale content", async () => {
  const worker = await loadWorker(); const env = await testEnv(); await initialize(worker, env);
  const originalFetch = globalThis.fetch; globalThis.fetch = mockOpenAI().fetch;
  try {
    const blog = await createDraft(worker, env, "blog");
    const blocked = await worker.fetch(request(`/api/echo/content/drafts/${blog.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: blog.payload }) }, BRAND_B), env, { waitUntil() {}, passThroughOnException() {} });
    assert.ok([400, 403].includes(blocked.status));
    const switched = await worker.fetch(request("/api/echo/content/workspace", {}, BRAND_B), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(switched.status, 200); assert.deepEqual((await switched.json()).drafts, []);
  } finally { globalThis.fetch = originalFetch; }
});

test("repurposing and duplication create new drafts without changing the source or contacting publishing systems", async () => {
  const worker = await loadWorker(); const env = await testEnv(); await initialize(worker, env);
  const originalFetch = globalThis.fetch; const openai = mockOpenAI(); globalThis.fetch = openai.fetch;
  try {
    const blog = await createDraft(worker, env, "blog"); const sourceJson = JSON.stringify(blog.payload); const callsBefore = openai.calls.length;
    const duplicate = await worker.fetch(request(`/api/echo/content/drafts/${blog.id}/duplicate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId: BRAND_A }) }), env, { waitUntil() {}, passThroughOnException() {} });
    const copy = (await duplicate.json()).draft; assert.notEqual(copy.id, blog.id); assert.equal(copy.sourceDraftId, blog.id);
    for (const targetType of ["newsletter", "social"]) {
      const response = await worker.fetch(request(`/api/echo/content/drafts/${blog.id}/repurpose`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId: BRAND_A, targetType }) }), env, { waitUntil() {}, passThroughOnException() {} });
      assert.equal(response.status, 201); const created = (await response.json()).draft; assert.notEqual(created.id, blog.id); assert.equal(created.sourceDraftId, blog.id); assert.equal(created.contentType, targetType);
    }
    const source = env.DB.database.prepare("SELECT payload FROM echo_content_drafts WHERE id = ?").get(blog.id); assert.equal(source.payload, sourceJson);
    assert.equal(openai.calls.length, callsBefore);
    assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS count FROM publish_jobs").get().count, 0);
    assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS count FROM advertising_dry_runs").get().count, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("future publishing adapters are empty and ECHO content routes contain no send, Buffer or advertising submission path", async () => {
  const [adapters, store, workerSource, flow, amplify] = await Promise.all([readFile(new URL("../app/echo/providers/content-publishing-adapters.ts", import.meta.url), "utf8"), readFile(new URL("../worker/content-store.ts", import.meta.url), "utf8"), readFile(new URL("../worker/index.ts", import.meta.url), "utf8"), readFile(new URL("../app/flow/components/flow-workspace.tsx", import.meta.url), "utf8"), readFile(new URL("../app/amplify/components/amplify-workspace.tsx", import.meta.url), "utf8")]);
  assert.match(adapters, /Object\.freeze\(\{\}\)/g); assert.doesNotMatch(adapters, /mailchimp|sendgrid|wordpress|oauth/i);
  assert.doesNotMatch(store, /api\.buffer\.com|BUFFER_API_KEY|createBufferPost|advertising_dry_runs/);
  assert.match(workerSource, /\/api\/echo\/content\/workspace/); assert.match(flow, /FLOW/); assert.match(amplify, /AMPLIFY/);
});
