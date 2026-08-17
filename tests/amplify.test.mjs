import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const BRAND_A = "brand_atlasium_788_ai";
const BRAND_B = "brand_test_northstar";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("amplify-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

async function memoryD1() {
  const database = new DatabaseSync(":memory:");
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(migrationDirectory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  for (const file of files) {
    const migration = await readFile(new URL(file, migrationDirectory), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) database.exec(statement);
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
    async put(key, body, options = {}) { const bytes = body instanceof ReadableStream ? new Uint8Array(await new Response(body).arrayBuffer()) : body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer()); values.set(key, { bytes, options }); },
    async get(key) { const stored = values.get(key); if (!stored) return null; return { body: new Blob([stored.bytes]).stream(), httpEtag: `etag-${key}`, writeHttpMetadata(headers) { if (stored.options.httpMetadata?.contentType) headers.set("Content-Type", stored.options.httpMetadata.contentType); } }; },
    async list({ prefix = "" } = {}) { return { objects: [...values.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false }; },
  };
}

async function testEnv() {
  const DB = await memoryD1();
  const UPLOADS = memoryR2();
  return { DB, UPLOADS, UPLOAD_KEY: "test-key", OPENAI_API_KEY: "mock-openai", ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
}

function request(path, init = {}, brandId = BRAND_A) {
  const headers = new Headers(init.headers || {});
  headers.set("X-Upload-Key", "test-key");
  if (brandId) headers.set("X-Brand-ID", brandId);
  return new Request(`http://localhost${path}`, { ...init, headers });
}

async function initialize(worker, env) {
  const response = await worker.fetch(request("/api/amplify/workspace"), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 200);
  env.DB.database.prepare("INSERT INTO media_assets (id, workspace_id, brand_id, campaign_id, post_id, media_type, url, r2_key, provider_job_id, status, created_at) VALUES (?, 'workspace_atlasium', ?, NULL, NULL, 'image', ?, ?, NULL, 'completed', ?)").run("media-brand-a", BRAND_A, "https://media.invalid/brand-a.png", "brands/a.png", "2026-08-17T12:00:00Z");
}

function draftInput(overrides = {}) {
  return {
    brandId: BRAND_A,
    prompt: "Promote the existing Atlasium revenue assessment to Toronto business owners.",
    offer: "Atlasium Revenue Assessment",
    goal: "leads",
    destinationType: "landing_page",
    destination: "https://atlasium.example/revenue-assessment",
    callToAction: "Book an assessment",
    creativeSource: { id: "media-brand-a", brandId: BRAND_A, sourceType: "echo_asset", label: "Existing ECHO assessment creative", mediaType: "image", url: "https://media.invalid/brand-a.png", detail: "Original remains unchanged" },
    audience: { location: "Toronto, Ontario", summary: "Business owners", ageMin: 25, ageMax: 65, interests: "Revenue operations", restrictedCategory: "none" },
    providerIds: ["meta", "linkedin"],
    budget: { type: "daily", amount: 25, currency: "CAD", maximumSpend: 0 },
    schedule: { startAt: "2026-08-18T09:00", endAt: "2026-08-24T17:00", timezone: "America/Toronto" },
    ...overrides,
  };
}

function mockOpenAI() {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (!String(url).includes("api.openai.com/v1/responses")) throw new Error(`Unexpected network call: ${url}`);
    const input = JSON.parse(init.body);
    const campaign = JSON.parse(input.input[1].content).campaign;
    return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ campaignName: "Atlasium Assessment Leads", variations: campaign.providers.map((providerId) => ({ providerId, headline: `${providerId} assessment`, body: `Platform-adapted assessment copy for ${providerId}.`, callToAction: "Book an assessment", placement: providerId === "meta" ? "Feed" : "LinkedIn feed", format: "Single image" })) }) }] }] });
  };
  return { calls, fetch };
}

test("AMPLIFY routes render directly with three-section product navigation and four short sections", async () => {
  const worker = await loadWorker();
  const env = await testEnv();
  const routes = ["/amplify", "/amplify/create", "/amplify/campaigns", "/amplify/results", "/amplify/connections"];
  const responses = await Promise.all(routes.map((path) => worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), env, { waitUntil() {}, passThroughOnException() {} })));
  for (const response of responses) assert.equal(response.status, 200);
  const html = (await Promise.all(responses.map((response) => response.text()))).join("\n");
  for (const label of ["ECHO", "FLOW", "AMPLIFY", "Create content", "Schedule &amp; publish", "Run ads", "Create", "Campaigns", "Results", "Connections"]) assert.match(html, new RegExp(label));
  assert.match(html, /Powered by Atlasium 7\/88 AI/);
});

test("ECHO, FLOW, Buffer and existing organic publishing code remain outside AMPLIFY", async () => {
  const [echo, flow, worker, amplifyStore, amplifyClient] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/flow/components/flow-channels.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/amplify-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/amplify/services/amplify-ad-service.ts", import.meta.url), "utf8"),
  ]);
  assert.match(echo, /Create &amp; Publish/);
  assert.match(flow, /Buffer remain/);
  assert.match(worker, /api\.buffer\.com/);
  assert.doesNotMatch(amplifyStore, /BUFFER_API_KEY|api\.buffer\.com|createBufferPost|publishJobs/);
  assert.doesNotMatch(amplifyClient, /\/api\/agent|\/api\/publish|\/api\/channels|Buffer/);
});

test("AMPLIFY has isolated routes, state, services, storage, adapters and an error boundary", async () => {
  const files = await Promise.all(["components/amplify-route.tsx", "components/amplify-error-boundary.tsx", "state/use-amplify-workspace.ts", "services/amplify-ad-service.ts", "providers/amplify-adapter-registry.ts", "providers/amplify-provider-catalog.tsx"].map((path) => readFile(new URL(`../app/amplify/${path}`, import.meta.url), "utf8")));
  assert.match(files[0], /AmplifyErrorBoundary/);
  assert.match(files[1], /ECHO, FLOW and Buffer remain available/);
  assert.match(files[2], /clearing previous brand data|creativeSources: \[\], drafts: \[\]/);
  assert.match(files[3], /\/api\/amplify\//g);
  assert.match(files[4], /amplifyAdvertisingAdapters: AmplifyAdapterRegistry = Object\.freeze\(\{\}\)/);
  assert.match(files[5], /liveSubmissionEnabled: false/g);
});

test("the advertising capability registry covers the FLOW ecosystem honestly", async () => {
  const catalog = await readFile(new URL("../app/amplify/providers/amplify-provider-catalog.tsx", import.meta.url), "utf8");
  for (const platform of ["Facebook", "Instagram", "Threads", "Google Ads", "YouTube", "LinkedIn Ads", "TikTok Ads", "X Ads", "Pinterest Ads", "Snapchat Ads", "Bluesky"]) assert.match(catalog, new RegExp(platform));
  assert.match(catalog, /providerId: "bluesky"[^\n]*advertisingAvailable: false[^\n]*connectionStatus: "not_available"/);
  assert.equal((catalog.match(/featureFlag: "amplify_/g) || []).length, 8);
  assert.equal((catalog.match(/oauthEnabled: false/g) || []).length, 9);
  assert.equal((catalog.match(/liveSubmissionEnabled: false/g) || []).length, 9);
  assert.doesNotMatch(catalog, /Threads Ads|providerId: "threads"/);
});

test("the four-stage creator exposes every required human decision and truthful review state", async () => {
  const source = await readFile(new URL("../app/amplify/components/amplify-create.tsx", import.meta.url), "utf8");
  for (const text of ["What are we promoting?", "Who and where?", "Where, when and how much?", "Review and dry test", "Get Leads", "Get Bookings", "Get Calls or Messages", "Get Website Sales", "Get Website Traffic", "Build Awareness", "Promote a Post", "MAXIMUM TOTAL SPENDING", "Platform Review Required", "Requires Compliance Review", "Run Dry Test", "No advertisements will be launched and no money will be spent"]) assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const action of ["Regenerate", "Replace Media", "Remove Platform", "Restore Recommended"]) assert.match(source, new RegExp(action));
  assert.match(source, /manualPlatforms/);
  assert.match(source, /restrictedCategory/);
  assert.doesNotMatch(source, /estimated reach|projected leads|guaranteed/i);
});

test("global brand selection is shared across ECHO, FLOW and AMPLIFY with New Brand compatibility", async () => {
  const [preference, flow, amplify, workspace, echo] = await Promise.all([
    readFile(new URL("../app/components/brand-preference.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/flow/state/use-flow-workspace.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/amplify/state/use-amplify-workspace.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/amplify/components/amplify-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(preference, /echoflow-active-brand/);
  assert.match(flow, /rememberActiveBrandId/);
  assert.match(amplify, /rememberActiveBrandId/);
  assert.match(workspace, /\/echo\?new-brand=1/);
  assert.match(echo, /new-brand/);
});

test("mobile, keyboard, reduced-motion, loading, empty, success and failure states are present", async () => {
  const [styles, workspace, creator] = await Promise.all([readFile(new URL("../app/globals.css", import.meta.url), "utf8"), readFile(new URL("../app/amplify/components/amplify-workspace.tsx", import.meta.url), "utf8"), readFile(new URL("../app/amplify/components/amplify-create.tsx", import.meta.url), "utf8")]);
  assert.match(styles, /\.amplify-shell\{[^}]*overflow-x:clip/);
  assert.match(styles, /@media\(max-width:390px\)/);
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(styles, /:focus-visible/);
  assert.match(workspace, /Preparing AMPLIFY/);
  assert.match(workspace, /role="alert"/);
  assert.match(creator, /amplify-dry-result/);
  assert.match(creator, /amplify-inline-empty/);
});

test("AMPLIFY API rejects unauthorized access and requires a matching brand context", async () => {
  const worker = await loadWorker();
  const env = await testEnv();
  const unauthorized = await worker.fetch(new Request("http://localhost/api/amplify/workspace"), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(unauthorized.status, 401);
  const missingBrand = await worker.fetch(new Request("http://localhost/api/amplify/workspace", { headers: { "X-Upload-Key": "test-key" } }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(missingBrand.status, 400);
  const mismatch = await worker.fetch(request("/api/amplify/drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draftInput({ brandId: BRAND_B })) }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(mismatch.status, 400);
  assert.match((await mismatch.json()).error, /does not match/);
});

test("AMPLIFY workspace loading is brand-scoped and never contacts Buffer or another network", async () => {
  const worker = await loadWorker();
  const env = await testEnv();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("No external calls allowed"); };
  try {
    await initialize(worker, env);
    const response = await worker.fetch(request("/api/amplify/workspace"), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.activeBrand.id, BRAND_A);
    assert.ok(data.creativeSources.every((source) => source.brandId === BRAND_A));
    assert.equal(data.featureFlags.liveSubmissionEnabled, false);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("plain-language input creates a brand-owned draft with platform-specific variations", async () => {
  const worker = await loadWorker();
  const env = await testEnv();
  await initialize(worker, env);
  const originalFetch = globalThis.fetch;
  const openai = mockOpenAI();
  globalThis.fetch = openai.fetch;
  try {
    const response = await worker.fetch(request("/api/amplify/drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draftInput()) }), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 201);
    const draft = (await response.json()).draft;
    assert.equal(draft.brandId, BRAND_A);
    assert.equal(draft.status, "ready_for_review");
    assert.deepEqual(draft.payload.providerIds, ["meta", "linkedin"]);
    assert.deepEqual(draft.payload.variations.map((variation) => variation.providerId), ["meta", "linkedin"]);
    assert.equal(draft.payload.budget.maximumSpend, 175);
    assert.equal(openai.calls.length, 1);
    assert.ok(draft.payload.variations[0].body !== draft.payload.variations[1].body);
  } finally { globalThis.fetch = originalFetch; }
});

test("missing destination, invalid schedule and cross-brand creative fail before AI generation", async () => {
  const worker = await loadWorker();
  const env = await testEnv();
  await initialize(worker, env);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("AI must not run"); };
  try {
    for (const input of [draftInput({ destination: "" }), draftInput({ schedule: { startAt: "2026-08-20T10:00", endAt: "2026-08-19T10:00", timezone: "America/Toronto" } }), draftInput({ creativeSource: { ...draftInput().creativeSource, id: "brand-b-secret" } })]) {
      const response = await worker.fetch(request("/api/amplify/drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }), env, { waitUntil() {}, passThroughOnException() {} });
      assert.equal(response.status, 400);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("uploaded creative is stored under a brand-scoped AMPLIFY path", async () => {
  const worker = await loadWorker();
  const env = await testEnv();
  await initialize(worker, env);
  const form = new FormData();
  form.set("file", new File([new Uint8Array([137, 80, 78, 71])], "ad.png", { type: "image/png" }));
  const response = await worker.fetch(request("/api/amplify/assets", { method: "POST", body: form }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 201);
  const asset = (await response.json()).asset;
  assert.equal(asset.brandId, BRAND_A);
  assert.equal(asset.sourceType, "uploaded_image");
  assert.ok([...env.UPLOADS.values.keys()].every((key) => key.startsWith(`brands/${BRAND_A}/amplify/`)));
});

test("dry tests make no external or Buffer calls and repeated clicks are idempotent", async () => {
  const worker = await loadWorker();
  const env = await testEnv();
  await initialize(worker, env);
  const originalFetch = globalThis.fetch;
  const openai = mockOpenAI();
  globalThis.fetch = openai.fetch;
  try {
    const created = await worker.fetch(request("/api/amplify/drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draftInput()) }), env, { waitUntil() {}, passThroughOnException() {} });
    const draftId = (await created.json()).draft.id;
    const callsAfterGeneration = openai.calls.length;
    const dryRequest = () => request("/api/amplify/dry-test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId: BRAND_A, draftId, idempotencyKey: "same-safe-click", confirmed: true }) });
    const first = await worker.fetch(dryRequest(), env, { waitUntil() {}, passThroughOnException() {} });
    const second = await worker.fetch(dryRequest(), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(first.status, 200); assert.equal(second.status, 200);
    assert.equal((await first.json()).result.status, "dry_test_passed");
    assert.equal((await second.json()).result.duplicate, true);
    assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS count FROM advertising_dry_runs").get().count, 1);
    assert.equal(openai.calls.length, callsAfterGeneration);
  } finally { globalThis.fetch = originalFetch; }
});

test("live advertising submission is server-disabled and cannot be enabled by browser input", async () => {
  const worker = await loadWorker();
  const env = { ...(await testEnv()), AMPLIFY_LIVE_SUBMISSION_ENABLED: "true" };
  await initialize(worker, env);
  const response = await worker.fetch(request("/api/amplify/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId: BRAND_A, draftId: "any", liveSubmissionEnabled: true }) }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 403);
  const data = await response.json();
  assert.equal(data.code, "amplify_live_submission_disabled");
  assert.match(data.error, /No advertisement was launched and no money was spent/);
});

test("draft reads and updates cannot cross brand boundaries", async () => {
  const worker = await loadWorker();
  const env = await testEnv();
  await initialize(worker, env);
  const now = "2026-08-17T12:00:00Z";
  env.DB.database.prepare("INSERT INTO brands (id, workspace_id, slug, name, logo_url, website, industry, location, timezone, status, created_at, updated_at) VALUES (?, 'workspace_atlasium', 'northstar-test', 'Northstar', NULL, NULL, 'Consulting', 'Toronto', 'America/Toronto', 'active', ?, ?)").run(BRAND_B, now, now);
  env.DB.database.prepare("INSERT INTO brand_profiles (brand_id, what_it_does, target_audience, main_offers, primary_cta, tone, words_use, words_avoid, visual_style, instructions, routing_rules, updated_at) VALUES (?, '', '', '', '', '', '', '', '', '', '{}', ?)").run(BRAND_B, now);
  const originalFetch = globalThis.fetch;
  const openai = mockOpenAI(); globalThis.fetch = openai.fetch;
  try {
    const created = await worker.fetch(request("/api/amplify/drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draftInput()) }), env, { waitUntil() {}, passThroughOnException() {} });
    const draftId = (await created.json()).draft.id;
    const crossUpdate = await worker.fetch(request(`/api/amplify/drafts/${draftId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId: BRAND_B, payload: { name: "stolen" } }) }, BRAND_B), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(crossUpdate.status, 400);
    const brandBWorkspace = await worker.fetch(request("/api/amplify/workspace", {}, BRAND_B), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal((await brandBWorkspace.json()).drafts.length, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("mock connections and sample results are clearly labelled and never presented as live", async () => {
  const [connections, results, hook] = await Promise.all([readFile(new URL("../app/amplify/components/amplify-connections.tsx", import.meta.url), "utf8"), readFile(new URL("../app/amplify/components/amplify-results.tsx", import.meta.url), "utf8"), readFile(new URL("../app/amplify/state/use-amplify-workspace.ts", import.meta.url), "utf8")]);
  assert.match(connections, /MOCK CONNECTION/);
  assert.match(connections, /No advertising account, token or platform permission exists/);
  assert.match(results, /SAMPLE DATA — NOT LIVE RESULTS/);
  assert.match(results, /No advertising platform is connected/);
  assert.match(hook, /location\.hostname === "localhost"/);
});
