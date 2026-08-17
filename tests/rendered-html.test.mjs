import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

async function loadFlowConnectionService() {
  const source = await readFile(new URL("../app/flow/services/flow-connection-service.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}#${Date.now()}`);
}

async function memoryD1() {
  const database = new DatabaseSync(":memory:");
  const migration = await readFile(new URL("../drizzle/0000_fast_thaddeus_ross.sql", import.meta.url), "utf8");
  for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) database.exec(statement);
  class Prepared {
    constructor(sql, bindings = []) { this.sql = sql; this.bindings = bindings; }
    bind(...bindings) { return new Prepared(this.sql, bindings); }
    async first() { return database.prepare(this.sql).get(...this.bindings) || null; }
    async all() { return { success: true, results: database.prepare(this.sql).all(...this.bindings) }; }
    async run() { const result = database.prepare(this.sql).run(...this.bindings); return { success: true, meta: { changes: Number(result.changes) } }; }
  }
  return {
    database,
    prepare(sql) { return new Prepared(sql); },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
  };
}

test("renders the EchoFlow Social authenticated entry", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      UPLOADS: { get: async () => null },
      UPLOAD_KEY: "test-key",
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>EchoFlow Social<\/title>/i);
  assert.match(html, /Powered by Atlasium 7\/88 AI/);
  assert.match(html, /private authenticated EchoFlow link/);
  assert.match(html, /\/echoflow-social\.png/);
  assert.doesNotMatch(html, /codex-preview/);
});

test("serves refresh-safe ECHO, FLOW and AMPLIFY routes with clear top-level navigation", async () => {
  const worker = await loadWorker();
  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    UPLOADS: { get: async () => null },
    UPLOAD_KEY: "test-key",
  };
  const context = { waitUntil() {}, passThroughOnException() {} };
  const echoResponse = await worker.fetch(new Request("http://localhost/echo", { headers: { accept: "text/html" } }), env, context);
  const flowResponses = await Promise.all(["/flow", "/flow/channels", "/flow/calendar", "/flow/queue", "/flow/activity"].map((path) => worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), env, context)));
  assert.equal(echoResponse.status, 200);
  for (const response of flowResponses) assert.equal(response.status, 200);
  const [echoHtml, ...flowPages] = await Promise.all([echoResponse.text(), ...flowResponses.map((response) => response.text())]);
  const flowHtml = flowPages.join("\n");
  assert.match(echoHtml, /ECHO/);
  assert.match(echoHtml, /Create content/);
  assert.match(echoHtml, /FLOW/);
  assert.match(flowHtml, /Schedule &amp; publish/);
  assert.match(flowHtml, /Channels/);
  assert.match(flowHtml, /Calendar/);
  assert.match(flowHtml, /Queue/);
  assert.match(flowHtml, /Activity/);
  assert.match(echoHtml, /AMPLIFY/);
  assert.match(flowHtml, /AMPLIFY/);
  assert.match(flowHtml, /Run ads/);
});

test("client allows automatic channel routing and never silently ignores a publish click", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /!selected\.length\s*\|\|\s*busy/);
  assert.match(source, /channels:\s*selected/);
  assert.match(source, /if \(!prompt\.trim\(\)\) \{ setBrandStatus/);
  assert.match(source, /if \(!channels\.length\) \{ setBrandStatus/);
  assert.match(source, /disabled=\{busy \|\| Boolean\(campaignId\)\}/);
});

test("client exposes brand tabs, four short setup steps, scoped draft saves, and mobile states", async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /\+ New Brand/);
  assert.match(source, /STEP \{wizardStep\} OF 4/);
  assert.match(source, /Identity/);
  assert.match(source, /Brand brain/);
  assert.match(source, /Social channels/);
  assert.match(source, /Review/);
  assert.match(source, /persistDraft\(activeBrandId/);
  assert.match(source, /echoflow-active-campaign:\$\{brand\.id\}/);
  assert.match(source, /No campaigns yet/);
  assert.match(source, /role="alert"/);
  assert.match(source, /src="\/echoflow-social\.png"/);
  assert.match(source, /EchoFlow Social, powered by Atlasium 7\/88 AI/);
  assert.match(styles, /\.echo-art-full\{[^}]*object-fit:contain/);
  assert.match(styles, /\.echo-art-compact\{[^}]*object-fit:contain/);
  assert.match(styles, /@media\(max-width:600px\)/);
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\)/);
});

test("FLOW has isolated routes, state, components, connection services, adapters, and an error boundary", async () => {
  const [echoRoute, flowPage, flowWorkspace, flowConnectionService, flowBrandService, providerCatalog, adapterRegistry, errorBoundary, navigation, styles] = await Promise.all([
    readFile(new URL("../app/echo/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/flow/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/flow/components/flow-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/flow/services/flow-connection-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/flow/services/flow-brand-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/flow/providers/provider-catalog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/flow/providers/provider-adapter-registry.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/flow/components/flow-error-boundary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/product-navigation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(echoRoute, /export \{ default \} from "\.\.\/page"/);
  assert.match(flowPage, /FlowRoute/);
  assert.match(flowWorkspace, /useFlowWorkspace/);
  assert.match(flowWorkspace, /FlowChannels/);
  assert.match(flowConnectionService, /class FlowConnectionCoordinator/);
  assert.match(flowConnectionService, /codeVerifier/);
  assert.match(flowConnectionService, /codeChallenge/);
  assert.match(flowConnectionService, /authorizeBrand/);
  assert.match(flowConnectionService, /confirmation_required/);
  assert.match(flowBrandService, /\/api\/workspace/);
  assert.match(flowBrandService, /X-Upload-Key/);
  assert.doesNotMatch(flowBrandService, /connectedChannels/);
  assert.match(providerCatalog, /authorizationEnabled: false/g);
  assert.match(adapterRegistry, /createFlowProviderAdapterRegistry/);
  assert.match(adapterRegistry, /flowProviderAdapters = createFlowProviderAdapterRegistry\(\)/);
  assert.match(errorBoundary, /FlowErrorBoundary/);
  assert.doesNotMatch(`${flowPage}\n${flowWorkspace}\n${flowConnectionService}\n${providerCatalog}`, /AMPLIFY|BUFFER_API_KEY|OPENAI_API_KEY/);
  assert.match(navigation, /aria-current/);
  assert.match(navigation, /Create content/);
  assert.match(navigation, /Schedule &amp; publish/);
  assert.match(styles, /\.flow-platform-grid/);
  assert.match(styles, /@media\(max-width:600px\)[^\n]*\.flow-platform-grid\{grid-template-columns:1fr 1fr\}/);
});

test("FLOW exposes every requested platform with accurate independently flagged statuses", async () => {
  const [catalog, service] = await Promise.all([
    readFile(new URL("../app/flow/providers/provider-catalog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/flow/services/flow-connection-service.ts", import.meta.url), "utf8"),
  ]);
  for (const name of ["Facebook", "Instagram", "LinkedIn", "TikTok", "YouTube", "X", "Threads", "Pinterest", "Google Business Profile", "Bluesky", "Snapchat"]) assert.match(catalog, new RegExp(`name: "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  for (const provider of ["facebook", "instagram", "linkedin", "tiktok"]) assert.match(catalog, new RegExp(`providerId: "${provider}"[^\n]*status: "approval_pending"[^\n]*authorizationEnabled: false`));
  for (const provider of ["youtube", "x", "threads", "pinterest", "google_business", "bluesky", "snapchat"]) assert.match(catalog, new RegExp(`providerId: "${provider}"[^\n]*status: "coming_soon"[^\n]*authorizationEnabled: false`));
  assert.equal((catalog.match(/featureFlag: "flow_/g) || []).length, 11);
  for (const status of ["connect", "connected", "approval_pending", "coming_soon", "reconnect", "needs_attention", "unavailable"]) assert.match(service, new RegExp(`"${status}"`));
});

test("FLOW mock authorization validates brands, state, PKCE, expiry, permissions, reconnect, and disconnect", async () => {
  const { FlowConnectionCoordinator, FlowConnectionError } = await loadFlowConnectionService();
  const transactions = new Map();
  const calls = { began: [], completed: [], revoked: [] };
  let now = 1_000_000;
  let sequence = 0;
  const account = { id: "account-a", brandId: "brand-a", providerId: "instagram", accountName: "Atlasium", handle: "@atlasium", accountType: "Business account", status: "connected" };
  const adapter = {
    async begin(input) { calls.began.push(input); return { authorizationUrl: `https://provider.invalid/authorize?state=${input.state}` }; },
    async complete(input) { calls.completed.push(input); return { account, grantedScopes: ["profile", "publish"] }; },
    async refresh(value) { return value; },
    async revoke(value) { calls.revoked.push(value); },
  };
  const coordinator = new FlowConnectionCoordinator({
    providers: { instagram: { providerId: "instagram", authorizationEnabled: true, featureFlag: "flow_instagram", scopes: ["profile", "publish"], pkce: "required" } },
    adapters: { instagram: adapter },
    store: { async save(transaction) { transactions.set(transaction.state, transaction); }, async take(state) { const value = transactions.get(state) || null; transactions.delete(state); return value; } },
    authorizeBrand: async (brandId) => brandId === "brand-a",
    randomValue: () => `secure-${++sequence}`,
    now: () => now,
  });

  await assert.rejects(() => coordinator.begin({ brandId: "brand-b", providerId: "instagram" }), (error) => error instanceof FlowConnectionError && error.code === "brand_forbidden");
  const started = await coordinator.begin({ brandId: "brand-a", providerId: "instagram" });
  assert.match(started.authorizationUrl, /provider\.invalid\/authorize/);
  assert.notEqual(calls.began[0].codeChallenge, transactions.get(started.state).codeVerifier);
  const success = await coordinator.complete({ brandId: "brand-a", providerId: "instagram", state: started.state, code: "official-code" });
  assert.equal(success.outcome, "success");
  assert.equal(success.account.brandId, "brand-a");
  assert.equal(calls.completed[0].codeVerifier, "secure-2");

  const cancelledStart = await coordinator.begin({ brandId: "brand-a", providerId: "instagram" });
  assert.deepEqual(await coordinator.complete({ brandId: "brand-a", providerId: "instagram", state: cancelledStart.state, error: "access_denied" }), { outcome: "cancelled" });
  const rejectedStart = await coordinator.begin({ brandId: "brand-a", providerId: "instagram" });
  assert.deepEqual(await coordinator.complete({ brandId: "brand-a", providerId: "instagram", state: rejectedStart.state, error: "permissions_rejected" }), { outcome: "permissions_rejected" });
  const expiredStart = await coordinator.begin({ brandId: "brand-a", providerId: "instagram" });
  now += 10 * 60_000;
  assert.deepEqual(await coordinator.complete({ brandId: "brand-a", providerId: "instagram", state: expiredStart.state, code: "late" }), { outcome: "expired" });
  now = 1_000_000;

  await coordinator.reconnect(account);
  assert.equal(calls.began.at(-1).mode, "reconnect");
  await assert.rejects(() => coordinator.disconnect(account, false), (error) => error instanceof FlowConnectionError && error.code === "confirmation_required");
  assert.deepEqual(await coordinator.disconnect(account, true), { disconnected: true, accountId: "account-a", brandId: "brand-a" });
  assert.equal(calls.revoked.length, 1);
  await assert.rejects(() => coordinator.complete({ brandId: "brand-a", providerId: "instagram", state: "unknown", code: "code" }), (error) => error instanceof FlowConnectionError && error.code === "invalid_state");
});

test("rejects an agent run without the private key", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "Create one post" }) }),
    { UPLOAD_KEY: "test-key" },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 401);
});

test("rejects an upload without the private key", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/upload", { method: "POST", body: new FormData() }),
    { UPLOAD_KEY: "test-key" },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 401);
});

async function preview(worker, prompt, count = 4, extra = {}) {
  const response = await worker.fetch(
    new Request("http://localhost/api/preview-schedule", { method: "POST", headers: { "content-type": "application/json", "X-Upload-Key": "test-key" }, body: JSON.stringify({ prompt, count, timeZone: "America/Toronto", ...extra }) }),
    { UPLOAD_KEY: "test-key" },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  return response.json();
}

test("parses common prompt timing phrases and creates unique timezone-aware slots", async () => {
  const worker = await loadWorker();
  for (const [prompt, label] of [["Schedule these this week", "This week"], ["Schedule these next week", "Next week"], ["Spread these over the next 10 days", "Over the next 10 days"], ["Create 3 posts per week", "Automatically spaced"], ["Post every weekday", "Automatically spaced"], ["Launch Friday", "Launch friday"]]) {
    const data = await preview(worker, prompt, 4);
    assert.match(data.timing.label, new RegExp(label, "i"));
    assert.equal(new Set(data.times).size, data.times.length);
    assert.equal(data.timeZone, "America/Toronto");
    assert.ok(data.times.every((time) => Date.parse(time) > Date.now()));
  }
  const weekdays = await preview(worker, "Post every weekday", 5);
  assert.ok(weekdays.times.every((time) => { const day = new Date(time).toLocaleDateString("en", { timeZone: "America/Toronto", weekday: "short" }); return day !== "Sat" && day !== "Sun"; }));
  const weekly = await preview(worker, "Create 3 posts per week", 4);
  assert.ok(Date.parse(weekly.times[3]) - Date.parse(weekly.times[0]) >= 6 * 24 * 60 * 60 * 1000);
});

test("refuses past exact schedule slots instead of moving or republishing them", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/preview-schedule", { method: "POST", headers: { "content-type": "application/json", "X-Upload-Key": "test-key" }, body: JSON.stringify({ prompt: "August 13, 2026 at 6:45 PM Eastern", count: 1, timing: "schedule", timeZone: "America/Toronto", now: "2026-08-14T12:00:00Z" }) }),
    { UPLOAD_KEY: "test-key" },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /past.*No posts were submitted or moved/i);
});

test("AUTO routes every item to TikTok and personal LinkedIn without duplicate destinations", async () => {
  const worker = await loadWorker();
  const channels = [
    { id: "ig", service: "instagram", displayName: "atlasium788ai" },
    { id: "li1", service: "linkedin", displayName: "Blair Ryan Barton" },
    { id: "li2", service: "linkedin", displayName: "Atlasium 7/88 AI" },
    { id: "fb", service: "facebook", displayName: "Atlasium 7/88 AI Facebook" },
    { id: "tt", service: "tiktok", displayName: "atlasium.788.ai" },
  ];
  const named = await preview(worker, "Create posts for Instagram and LinkedIn", 2, { channels });
  assert.deepEqual(named.channels.map((channel) => channel.id), ["li1", "li2", "tt", "ig", "fb"]);
  const samplePosts = Array.from({ length: 8 }, (_, index) => ({ concept: `Atlasium campaign concept ${index + 1}`, caption: `Distinct Atlasium business message ${index + 1}`, personalLinkedInCaption: `Professional founder version ${index + 1}`, companyLinkedInCaption: `Company version ${index + 1}`, imagePrompt: `Visual ${index + 1}` }));
  const campaign = await preview(worker, "Create an 8-day Atlasium business campaign", 8, { channels, samplePosts });
  for (let itemIndex = 0; itemIndex < 8; itemIndex++) {
    const destinations = campaign.assignments.filter((item) => item.itemIndex === itemIndex);
    assert.ok(destinations.some((item) => item.channel === "Blair Ryan Barton"));
    assert.ok(destinations.some((item) => item.channel === "Atlasium 7/88 AI"));
    assert.ok(destinations.some((item) => item.channel === "atlasium.788.ai"));
    assert.equal(new Set(destinations.map((item) => item.channelId)).size, destinations.length);
    assert.match(destinations.find((item) => item.channel === "Blair Ryan Barton").caption, /Professional founder version/);
  }
  assert.deepEqual(new Set(campaign.assignments.map((item) => item.service)), new Set(["linkedin", "instagram", "facebook", "tiktok"]));
});

test("agent suppresses effectively identical same-time Buffer submissions", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const mutations = [];
  globalThis.fetch = async (url, init) => {
    const request = JSON.parse(init.body);
    if (String(url).includes("api.buffer.com") && request.query.includes("query Account")) return Response.json({ data: { account: { organizations: [{ id: "org", name: "Atlasium" }] } } });
    if (String(url).includes("api.buffer.com") && request.query.includes("query Channels")) return Response.json({ data: { channels: [{ id: "li", name: "Atlasium", displayName: "Atlasium 7/88 AI", service: "linkedin" }, { id: "ig", name: "Atlasium", displayName: "atlasium788ai", service: "instagram" }] } });
    if (String(url).includes("api.openai.com/v1/responses")) return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ campaign: "Duplicate guard", timing: "now", posts: [{ concept: "One", caption: "Same message!", imagePrompt: "One" }, { concept: "Two", caption: "same message", imagePrompt: "Two" }] }) }] }] });
    if (String(url).includes("api.openai.com/v1/images")) return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
    mutations.push(request.variables.input);
    return Response.json({ data: { createPost: { __typename: "PostActionSuccess", post: { id: `post-${mutations.length}`, status: "sent", channelId: request.variables.input.channelId } } } });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/agent", { method: "POST", headers: { "content-type": "application/json", "X-Upload-Key": "test-key" }, body: JSON.stringify({ prompt: "Create two posts and publish now", channels: [], timing: "now" }) }), { UPLOAD_KEY: "test-key", BUFFER_API_KEY: "buffer-test", OPENAI_API_KEY: "openai-test", UPLOADS: { put: async () => {} } }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 201);
    assert.equal(mutations.length, 2);
    assert.equal(new Set(mutations.map((input) => input.channelId)).size, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test("preserves the exact 15-post Toronto campaign schedule and stable Buffer mapping", async () => {
  const worker = await loadWorker();
  const prompt = "Create 15 Atlasium company campaign posts. August 13, 2026: 6:45 PM Eastern. August 14–20, 2026: 5:30 AM and 3:00 PM Eastern daily.";
  const exact = await preview(worker, prompt, 15, { timing: "schedule", now: "2026-08-12T12:00:00Z" });
  const expected = ["2026-08-13T22:45:00.000Z"];
  for (let day = 14; day <= 20; day++) expected.push(`2026-08-${day}T09:30:00.000Z`, `2026-08-${day}T19:00:00.000Z`);
  assert.deepEqual(exact.times, expected);

  const channels = [
    { id: "ig", name: "Instagram", displayName: "atlasium788ai", service: "instagram" },
    { id: "lip", name: "LinkedIn", displayName: "Blair Ryan Barton", service: "linkedin" },
    { id: "lic", name: "LinkedIn", displayName: "Atlasium 7/88 AI", service: "linkedin" },
    { id: "fb", name: "Facebook", displayName: "Atlasium 7/88 AI", service: "facebook" },
    { id: "tt", name: "TikTok", displayName: "atlasium.788.ai", service: "tiktok" },
  ];
  const posts = Array.from({ length: 15 }, (_, index) => ({ concept: `Concept ${index + 1}`, caption: `Unique Atlasium company post ${index + 1}`, imagePrompt: `Image ${index + 1}` }));
  const originalFetch = globalThis.fetch;
  const mutations = [];
  globalThis.fetch = async (url, init) => {
    const request = JSON.parse(init.body);
    if (String(url).includes("api.buffer.com") && request.query.includes("query Account")) return Response.json({ data: { account: { organizations: [{ id: "org", name: "Atlasium" }] } } });
    if (String(url).includes("api.buffer.com") && request.query.includes("query Channels")) return Response.json({ data: { channels } });
    if (String(url).includes("api.openai.com/v1/responses")) return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ campaign: "15 post campaign", timing: "schedule", posts }) }] }] });
    if (String(url).includes("api.openai.com/v1/images")) return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
    mutations.push(request.variables.input);
    const input = request.variables.input;
    return Response.json({ data: { createPost: { __typename: "PostActionSuccess", post: { id: `buffer-${mutations.length}`, status: "scheduled", dueAt: input.dueAt, channelId: input.channelId } } } });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/agent", { method: "POST", headers: { "content-type": "application/json", "X-Upload-Key": "test-key" }, body: JSON.stringify({ prompt, channels: [], timing: "schedule", timeZone: "America/Toronto" }) }), { UPLOAD_KEY: "test-key", BUFFER_API_KEY: "buffer-test", OPENAI_API_KEY: "openai-test", TEST_NOW: "2026-08-12T12:00:00Z", UPLOADS: { put: async () => {} } }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(mutations.length, 60);
    assert.deepEqual(mutations.map((input) => input.dueAt), expected.flatMap((time) => [time, time, time, time]));
    assert.equal(new Set(data.results.map((result) => result.id)).size, 60);
    assert.equal(new Set(data.results.map((result) => result.itemId)).size, 15);
    assert.deepEqual(data.results.map((result) => result.dueAt), expected.flatMap((time) => [time, time, time, time]));
    assert.ok(data.results.every((result, index) => result.channelId === mutations[index].channelId && result.status === "SCHEDULED"));
    assert.equal(data.campaignItems, 15);
    assert.equal(data.destinationSubmissions, 60);
  } finally { globalThis.fetch = originalFetch; }
});

test("manual channel selection overrides automatic routing", async () => {
  const worker = await loadWorker();
  const channels = [{ id: "ig", service: "instagram", displayName: "Instagram" }, { id: "fb", service: "facebook", displayName: "Facebook" }];
  const samplePosts = Array.from({ length: 3 }, (_, index) => ({ concept: `Concept ${index}`, caption: `Caption ${index}`, imagePrompt: "Image" }));
  const data = await preview(worker, "Create an Atlasium campaign", 3, { channels, selected: ["fb"], samplePosts });
  assert.ok(data.assignments.every((item) => item.channelId === "fb"));
});

test("UI-selected schedule overrides prompt timing and never uses the Buffer queue", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const mutations = [];
  globalThis.fetch = async (url, init) => {
    const request = JSON.parse(init.body);
    if (String(url).includes("api.buffer.com") && request.query.includes("query Account")) return Response.json({ data: { account: { organizations: [{ id: "org", name: "Atlasium" }] } } });
    if (String(url).includes("api.buffer.com") && request.query.includes("query Channels")) return Response.json({ data: { channels: [{ id: "fb", name: "Facebook", displayName: "Atlasium", service: "facebook" }] } });
    if (String(url).includes("api.openai.com/v1/responses")) return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ campaign: "UI schedule", timing: "queue", posts: [{ concept: "One", caption: "One", imagePrompt: "One" }] }) }] }] });
    if (String(url).includes("api.openai.com/v1/images")) return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
    mutations.push(request.variables.input);
    return Response.json({ data: { createPost: { __typename: "PostActionSuccess", post: { id: "scheduled", status: "scheduled", dueAt: request.variables.input.dueAt, channelId: request.variables.input.channelId } } } });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/agent", { method: "POST", headers: { "content-type": "application/json", "X-Upload-Key": "test-key" }, body: JSON.stringify({ prompt: "Add this to the queue next week", channels: ["fb"], timing: "schedule", selectedLocalTime: "2026-08-21T15:00", timeZone: "America/Toronto" }) }), { UPLOAD_KEY: "test-key", BUFFER_API_KEY: "buffer-test", OPENAI_API_KEY: "openai-test", TEST_NOW: "2026-08-15T12:00:00Z", UPLOADS: { put: async () => {} } }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 201);
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].mode, "customScheduled");
    assert.equal(mutations[0].dueAt, "2026-08-21T19:00:00.000Z");
  } finally { globalThis.fetch = originalFetch; }
});

test("motion prompts create the exact requested MP4 count and TikTok video payloads", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const mutations = [];
  const stored = [];
  const mp4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 2, 0, 105, 115, 111, 109, 109, 112, 52, 50, 0, 0, 0, 8, 109, 100, 97, 116]);
  const posts = Array.from({ length: 6 }, (_, index) => ({ concept: `Concept ${index}`, caption: `Caption ${index}`, imagePrompt: `Image ${index}` }));
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith("http://localhost/i/")) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": String(url).endsWith(".mp4") ? "video/mp4" : "image/png" } });
    if (String(url).includes("api.openai.com/v1/videos/") && String(url).endsWith("/content")) return new Response(mp4, { headers: { "content-type": "video/mp4" } });
    if (String(url).endsWith("/v1/videos") && init.method === "POST") return Response.json({ id: `video-${Math.random()}`, status: "completed" });
    const request = JSON.parse(init.body);
    if (String(url).includes("api.buffer.com") && request.query.includes("query Account")) return Response.json({ data: { account: { organizations: [{ id: "org", name: "Atlasium" }] } } });
    if (String(url).includes("api.buffer.com") && request.query.includes("query Channels")) return Response.json({ data: { channels: [{ id: "tt", name: "TikTok", displayName: "atlasium.788.ai", service: "tiktok" }] } });
    if (String(url).includes("api.openai.com/v1/responses")) return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ campaign: "Motion", timing: "schedule", posts }) }] }] });
    if (String(url).includes("api.openai.com/v1/images")) return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
    mutations.push(request.variables.input);
    return Response.json({ data: { createPost: { __typename: "PostActionSuccess", post: { id: `post-${mutations.length}`, status: "scheduled", dueAt: request.variables.input.dueAt, channelId: "tt" } } } });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/agent", { method: "POST", headers: { "content-type": "application/json", "X-Upload-Key": "test-key" }, body: JSON.stringify({ prompt: "Create 6 posts with 2 motion posts next week", channels: ["tt"], timing: "auto", timeZone: "America/Toronto" }) }), { UPLOAD_KEY: "test-key", BUFFER_API_KEY: "buffer-test", OPENAI_API_KEY: "openai-test", TEST_NOW: "2026-08-15T12:00:00Z", UPLOADS: { put: async (key, value, options) => stored.push({ key, value, options }) } }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.results.filter((result) => result.mediaType === "video").length, 2);
    assert.equal(mutations.filter((input) => input.assets[0].video).length, 2);
    assert.equal(mutations.filter((input) => input.assets[0].image).length, 4);
    assert.ok(data.results.filter((result) => result.mediaType === "video").every((result) => result.hostedMediaUrl.startsWith("http://localhost/i/") && result.hostedMediaUrl.endsWith(".mp4")));
    assert.equal(stored.filter((item) => item.key.endsWith(".mp4") && item.options.httpMetadata.contentType === "video/mp4").length, 2);
    mutations.length = 0;
    const someResponse = await worker.fetch(new Request("http://localhost/api/agent", { method: "POST", headers: { "content-type": "application/json", "X-Upload-Key": "test-key" }, body: JSON.stringify({ prompt: "Create 6 posts with some motion next week", channels: ["tt"], timing: "auto", timeZone: "America/Toronto" }) }), { UPLOAD_KEY: "test-key", BUFFER_API_KEY: "buffer-test", OPENAI_API_KEY: "openai-test", TEST_NOW: "2026-08-15T12:00:00Z", UPLOADS: { put: async () => {} } }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(someResponse.status, 201);
    assert.equal((await someResponse.json()).results.filter((result) => result.mediaType === "video").length, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test("motion failure is reported and TikTok receives a supported photo fallback", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  let mutation;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith("http://localhost/i/")) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
    if (String(url).endsWith("/v1/videos")) return Response.json({ error: { message: "Video unavailable" } }, { status: 403 });
    const request = JSON.parse(init.body);
    if (String(url).includes("api.buffer.com") && request.query.includes("query Account")) return Response.json({ data: { account: { organizations: [{ id: "org", name: "Atlasium" }] } } });
    if (String(url).includes("api.buffer.com") && request.query.includes("query Channels")) return Response.json({ data: { channels: [{ id: "tt", name: "TikTok", displayName: "atlasium.788.ai", service: "tiktok" }] } });
    if (String(url).includes("api.openai.com/v1/responses")) return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ campaign: "Fallback", timing: "schedule", posts: [{ concept: "One", caption: "Caption", imagePrompt: "Image" }] }) }] }] });
    if (String(url).includes("api.openai.com/v1/images")) return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
    mutation = request.variables.input;
    return Response.json({ data: { createPost: { __typename: "PostActionSuccess", post: { id: "post", status: "scheduled", dueAt: mutation.dueAt, channelId: "tt" } } } });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/agent", { method: "POST", headers: { "content-type": "application/json", "X-Upload-Key": "test-key" }, body: JSON.stringify({ prompt: "Create 1 motion post next week", channels: ["tt"], timing: "auto", timeZone: "America/Toronto" }) }), { UPLOAD_KEY: "test-key", BUFFER_API_KEY: "buffer-test", OPENAI_API_KEY: "openai-test", TEST_NOW: "2026-08-15T12:00:00Z", UPLOADS: { put: async () => {} } }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.results[0].mediaType, "image");
    assert.match(data.results[0].motionError, /Video unavailable/);
    assert.ok(mutation.assets[0].image);
    assert.deepEqual(mutation.metadata.tiktok, { title: "Caption" });
  } finally { globalThis.fetch = originalFetch; }
});

test("Buffer rejection stays attached to its stable post and displays FAILED", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const request = JSON.parse(init.body);
    if (String(url).includes("api.buffer.com") && request.query.includes("query Account")) return Response.json({ data: { account: { organizations: [{ id: "org", name: "Atlasium" }] } } });
    if (String(url).includes("api.buffer.com") && request.query.includes("query Channels")) return Response.json({ data: { channels: [{ id: "lic", name: "LinkedIn", displayName: "Atlasium 7/88 AI", service: "linkedin" }] } });
    if (String(url).includes("api.openai.com/v1/responses")) return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ campaign: "Failure", timing: "now", posts: [{ concept: "One", caption: "One unique post", imagePrompt: "One" }] }) }] }] });
    if (String(url).includes("api.openai.com/v1/images")) return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
    return Response.json({ data: { createPost: { __typename: "MutationError", message: "Schedule rejected" } } });
  };
  try {
    const response = await worker.fetch(new Request("http://localhost/api/agent", { method: "POST", headers: { "content-type": "application/json", "X-Upload-Key": "test-key" }, body: JSON.stringify({ prompt: "Publish one company post now", channels: [], timing: "now" }) }), { UPLOAD_KEY: "test-key", BUFFER_API_KEY: "buffer-test", OPENAI_API_KEY: "openai-test", UPLOADS: { put: async () => {} } }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 207);
    const data = await response.json();
    assert.equal(data.results[0].status, "FAILED");
    assert.match(data.results[0].error, /Schedule rejected/);
    assert.ok(data.results[0].id);
  } finally { globalThis.fetch = originalFetch; }
});

test("publishes sample content through the complete Buffer scheduling mutation path", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const mutations = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes("query Account")) return Response.json({ data: { account: { organizations: [{ id: "org", name: "Atlasium" }] } } });
    if (request.query.includes("query Channels")) return Response.json({ data: { channels: [{ id: "ig", name: "Atlasium", displayName: "Atlasium", service: "instagram" }, { id: "li", name: "Atlasium", displayName: "Atlasium", service: "linkedin" }, { id: "fb", name: "Atlasium", displayName: "Atlasium", service: "facebook" }, { id: "tt", name: "Atlasium", displayName: "Atlasium", service: "tiktok" }] } });
    mutations.push(request.variables.input);
    return Response.json({ data: { createPost: { __typename: "PostActionSuccess", post: { id: `post-${mutations.length}`, status: "scheduled", dueAt: request.variables.input.dueAt, channelId: request.variables.input.channelId } } } });
  };
  try {
    const form = new FormData();
    form.set("image", new File([new Uint8Array([137, 80, 78, 71])], "sample.png", { type: "image/png" }));
    form.set("caption", "Sample Atlasium launch post");
    form.set("channels", JSON.stringify(["ig", "li", "fb"]));
    form.set("mode", "smartSchedule");
    form.set("timeZone", "America/Toronto");
    const response = await worker.fetch(new Request("http://localhost/api/publish", { method: "POST", headers: { "X-Upload-Key": "test-key" }, body: form }), { UPLOAD_KEY: "test-key", BUFFER_API_KEY: "buffer-test", UPLOADS: { put: async () => {} } }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 201);
    assert.equal(mutations.length, 3);
    assert.ok(mutations.every((input) => input.mode === "customScheduled" && Date.parse(input.dueAt) > Date.now() && input.assets[0].image.url.startsWith("http://localhost/i/")));
    assert.deepEqual(mutations[0].metadata.instagram, { type: "post", shouldShareToFeed: true, isAiGenerated: false });
    assert.equal(mutations[1].metadata, undefined);
    assert.deepEqual(mutations[2].metadata.facebook, { type: "post" });

    for (const type of ["story", "reel"]) {
      const typed = new FormData();
      typed.set("image", new File([new Uint8Array([137, 80, 78, 71])], `${type}.png`, { type: "image/png" }));
      typed.set("caption", "Atlasium update");
      typed.set("notes", `Create a Facebook ${type}`);
      typed.set("channels", JSON.stringify(["fb"]));
      typed.set("mode", "addToQueue");
      const typedResponse = await worker.fetch(new Request("http://localhost/api/publish", { method: "POST", headers: { "X-Upload-Key": "test-key" }, body: typed }), { UPLOAD_KEY: "test-key", BUFFER_API_KEY: "buffer-test", UPLOADS: { put: async () => {} } }, { waitUntil() {}, passThroughOnException() {} });
      assert.equal(typedResponse.status, 201);
      assert.deepEqual(mutations.at(-1).metadata.facebook, { type });
    }

    const tiktok = new FormData();
    tiktok.set("image", new File([new Uint8Array([137, 80, 78, 71])], "tiktok.png", { type: "image/png" }));
    tiktok.set("caption", "Atlasium TikTok photo update");
    tiktok.set("channels", JSON.stringify(["tt"]));
    tiktok.set("mode", "addToQueue");
    const tiktokResponse = await worker.fetch(new Request("http://localhost/api/publish", { method: "POST", headers: { "X-Upload-Key": "test-key" }, body: tiktok }), { UPLOAD_KEY: "test-key", BUFFER_API_KEY: "buffer-test", UPLOADS: { put: async () => {} } }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(tiktokResponse.status, 201);
    assert.deepEqual(mutations.at(-1).metadata.tiktok, { title: "Atlasium TikTok photo update" });
  } finally { globalThis.fetch = originalFetch; }
});

function memoryR2() {
  const values = new Map();
  return {
    values,
    async put(key, value, options = {}) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(await new Response(value).arrayBuffer());
      values.set(key, { bytes, options });
    },
    async get(key) {
      const stored = values.get(key);
      if (!stored) return null;
      return { body: stored.bytes, httpEtag: "test", writeHttpMetadata(headers) { if (stored.options.httpMetadata?.contentType) headers.set("content-type", stored.options.httpMetadata.contentType); } };
    },
    async list({ prefix = "" } = {}) {
      return { objects: [...values.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false };
    },
  };
}

test("async motion persists, resumes, hosts MP4, schedules once, and survives refresh", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const r2 = memoryR2();
  const mutations = [];
  const mp4 = new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109,0,0,2,0,105,115,111,109,109,112,52,50,0,0,0,8,109,100,97,116]);
  const channels = [
    { id: "lip", displayName: "Blair Ryan Barton", service: "linkedin" },
    { id: "lic", displayName: "Atlasium 7/88 AI", service: "linkedin" },
    { id: "tt", displayName: "atlasium.788.ai", service: "tiktok" },
    { id: "ig", displayName: "atlasium788ai", service: "instagram" },
    { id: "fb", displayName: "Atlasium Facebook", service: "facebook" },
  ];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith("http://localhost/i/")) return new Response(null, { status: 200, headers: { "content-type": String(url).endsWith(".mp4") ? "video/mp4" : "image/png" } });
    if (String(url).endsWith("/v1/videos") && init.method === "POST") return Response.json({ id: "video-persisted", status: "queued" });
    if (String(url).endsWith("/videos/video-persisted")) return Response.json({ id: "video-persisted", status: "completed" });
    if (String(url).endsWith("/videos/video-persisted/content")) return new Response(mp4, { headers: { "content-type": "video/mp4" } });
    const request = JSON.parse(init.body);
    if (request.query?.includes("query Account")) return Response.json({ data: { account: { organizations: [{ id: "org", name: "Atlasium" }] } } });
    if (request.query?.includes("query Channels")) return Response.json({ data: { channels } });
    if (String(url).includes("/v1/responses")) return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ campaign: "Async", timing: "schedule", posts: [{ concept: "Motion", caption: "Company", personalLinkedInCaption: "Founder", companyLinkedInCaption: "Company", instagramCaption: "Instagram", facebookCaption: "Facebook", tiktokCaption: "TikTok", imagePrompt: "Image" }] }) }] }] });
    if (String(url).includes("/v1/images")) return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
    mutations.push(request.variables.input);
    return Response.json({ data: { createPost: { __typename: "PostActionSuccess", post: { id: `buffer-${mutations.length}`, status: "scheduled", dueAt: request.variables.input.dueAt, channelId: request.variables.input.channelId } } } });
  };
  try {
    const started = Date.now();
    const initial = await worker.fetch(new Request("http://localhost/api/agent", { method: "POST", headers: { "content-type": "application/json", "X-Upload-Key": "test-key" }, body: JSON.stringify({ prompt: "Create 1 motion post next week", timing: "auto", channels: [] }) }), { UPLOAD_KEY: "test-key", BUFFER_API_KEY: "buffer", OPENAI_API_KEY: "openai", TEST_NOW: "2026-08-15T12:00:00Z", UPLOADS: r2 }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(initial.status, 202);
    assert.ok(Date.now() - started < 1000);
    const created = await initial.json();
    assert.ok(created.campaignId);
    assert.equal(mutations.length, 0);
    assert.ok(created.results.every((result) => result.status === "PROCESSING MOTION"));
    const persisted = JSON.parse(new TextDecoder().decode(r2.values.get(`.atlasium-campaigns/${created.campaignId}.json`).bytes));
    assert.equal(persisted.items[0].videoJobId, "video-persisted");

    const progress = await worker.fetch(new Request(`http://localhost/api/campaign/${created.campaignId}`, { headers: { "X-Upload-Key": "test-key" } }), { UPLOAD_KEY: "test-key", BUFFER_API_KEY: "buffer", OPENAI_API_KEY: "openai", TEST_NOW: "2026-08-15T12:00:00Z", UPLOADS: r2 }, { waitUntil() {}, passThroughOnException() {} });
    const completed = await progress.json();
    assert.equal(mutations.length, 4);
    assert.ok(completed.results.every((result) => result.status === "SCHEDULED" && result.hostedMediaUrl.endsWith(".mp4")));
    assert.ok(completed.results.some((result) => result.channelId === "tt"));
    assert.ok(completed.results.some((result) => result.channelId === "lip"));
    assert.ok(mutations.every((input) => input.dueAt === created.results[0].requestedDueAt));

    await worker.fetch(new Request(`http://localhost/api/campaign/${created.campaignId}`, { headers: { "X-Upload-Key": "test-key" } }), { UPLOAD_KEY: "test-key", BUFFER_API_KEY: "buffer", OPENAI_API_KEY: "openai", TEST_NOW: "2026-08-15T12:00:00Z", UPLOADS: r2 }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(mutations.length, 4);
  } finally { globalThis.fetch = originalFetch; }
});

test("failed async motion retries twice then reports static fallback", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const r2 = memoryR2();
  let creates = 0;
  const mutations = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith("/v1/videos") && init.method === "POST") return Response.json({ id: `video-${++creates}`, status: "queued" });
    if (/\/videos\/video-\d+$/.test(String(url))) return Response.json({ status: "failed", error: { message: "render failed" } });
    const request = JSON.parse(init.body);
    if (request.query?.includes("query Account")) return Response.json({ data: { account: { organizations: [{ id: "org" }] } } });
    if (request.query?.includes("query Channels")) return Response.json({ data: { channels: [{ id: "tt", displayName: "atlasium.788.ai", service: "tiktok" }] } });
    if (String(url).includes("/v1/responses")) return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ campaign: "Retry", timing: "schedule", posts: [{ concept: "Motion", caption: "Caption", imagePrompt: "Image" }] }) }] }] });
    if (String(url).includes("/v1/images")) return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
    mutations.push(request.variables.input);
    return Response.json({ data: { createPost: { __typename: "PostActionSuccess", post: { id: "fallback", status: "scheduled", dueAt: request.variables.input.dueAt, channelId: "tt" } } } });
  };
  try {
    const initial = await worker.fetch(new Request("http://localhost/api/agent", { method: "POST", headers: { "content-type": "application/json", "X-Upload-Key": "test-key" }, body: JSON.stringify({ prompt: "Create 1 motion post next week", channels: ["tt"] }) }), { UPLOAD_KEY: "test-key", BUFFER_API_KEY: "buffer", OPENAI_API_KEY: "openai", TEST_NOW: "2026-08-15T12:00:00Z", UPLOADS: r2 }, { waitUntil() {}, passThroughOnException() {} });
    const id = (await initial.json()).campaignId;
    let data;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await worker.fetch(new Request(`http://localhost/api/campaign/${id}`, { headers: { "X-Upload-Key": "test-key" } }), { UPLOAD_KEY: "test-key", BUFFER_API_KEY: "buffer", OPENAI_API_KEY: "openai", TEST_NOW: "2026-08-15T12:00:00Z", UPLOADS: r2 }, { waitUntil() {}, passThroughOnException() {} });
      data = await response.json();
    }
    assert.equal(creates, 3);
    assert.equal(mutations.length, 1);
    assert.equal(data.results[0].status, "STATIC FALLBACK");
    assert.match(data.results[0].motionError, /MOTION FAILED — STATIC FALLBACK USED/);
    assert.ok(mutations[0].assets[0].image);
  } finally { globalThis.fetch = originalFetch; }
});

test("migrates Atlasium history, creates an isolated brand, restores its draft, and blocks cross-brand access", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const db = await memoryD1();
  const r2 = memoryR2();
  const legacy = { id: "legacy-campaign-1", createdAt: "2026-08-13T22:45:00.000Z", updatedAt: "2026-08-14T09:30:00.000Z", prompt: "Preserved Atlasium campaign", timeZone: "America/Toronto", message: "SCHEDULED", schedule: { timing: { label: "Exact times from prompt" } }, items: [], results: [] };
  await r2.put(".atlasium-campaigns/legacy-campaign-1.json", new TextEncoder().encode(JSON.stringify(legacy)), { httpMetadata: { contentType: "application/json" } });
  const connected = [
    { id: "lip", displayName: "Blair Ryan Barton", service: "linkedin" },
    { id: "lic", displayName: "Atlasium 7/88 AI", service: "linkedin" },
    { id: "tt", displayName: "atlasium.788.ai", service: "tiktok" },
    { id: "ig", displayName: "atlasium788ai", service: "instagram" },
    { id: "fb", displayName: "Atlasium 7/88 AI", service: "facebook" },
    { id: "client-ig", displayName: "Northstar Studio", service: "instagram" },
  ];
  const bufferMutations = [];
  let plannerSystem = "";
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("api.buffer.com")) {
      const request = JSON.parse(init.body);
      if (request.query.includes("query Account")) return Response.json({ data: { account: { organizations: [{ id: "org", name: "EchoFlow" }] } } });
      if (request.query.includes("query Channels")) return Response.json({ data: { channels: connected } });
      bufferMutations.push(request.variables.input);
      return Response.json({ data: { createPost: { __typename: "PostActionSuccess", post: { id: `client-post-${bufferMutations.length}`, status: "scheduled", dueAt: request.variables.input.dueAt, channelId: request.variables.input.channelId } } } });
    }
    if (String(url).includes("/v1/responses")) {
      const request = JSON.parse(init.body); plannerSystem = request.input[0].content;
      return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ campaign: "Northstar campaign", timing: "schedule", posts: [{ concept: "Client concept", caption: "Client caption", imagePrompt: "Northstar visual", personalLinkedInCaption: "Client caption", companyLinkedInCaption: "Client caption", instagramCaption: "Northstar Instagram", facebookCaption: "Client Facebook", tiktokCaption: "Client TikTok" }] }) }] }] });
    }
    if (String(url).includes("/v1/images")) return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const env = { DB: db, UPLOADS: r2, UPLOAD_KEY: "test-key", BUFFER_API_KEY: "buffer", OPENAI_API_KEY: "openai", TEST_NOW: "2026-08-16T12:00:00Z" };
  try {
    const first = await worker.fetch(new Request("http://localhost/api/workspace", { headers: { "X-Upload-Key": "test-key" } }), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(first.status, 200);
    const initial = await first.json();
    assert.equal(initial.brands[0].id, "brand_atlasium_788_ai");
    assert.equal(initial.brands[0].channels.length, 5);
    assert.ok(initial.recentCampaigns.some((campaign) => campaign.id === "legacy-campaign-1" && campaign.brandId === "brand_atlasium_788_ai"));
    assert.equal(bufferMutations.length, 0);
    const preservedObject = await r2.get(".atlasium-campaigns/legacy-campaign-1.json");
    assert.deepEqual(await new Response(preservedObject.body).json(), legacy);

    const profile = { name: "Northstar", website: "https://northstar.example", industry: "Consulting", location: "Toronto", timezone: "America/Vancouver", whatItDoes: "Advises operators", targetAudience: "Business owners", mainOffers: "Advisory", primaryCta: "Book a call", tone: "Clear and calm", wordsUse: "practical", wordsAvoid: "hype", visualStyle: "Minimal navy and copper", instructions: "Never mention Atlasium", routingRules: "{}", channelIds: ["client-ig"] };
    const createForm = new FormData(); createForm.set("profile", JSON.stringify(profile));
    const createdResponse = await worker.fetch(new Request("http://localhost/api/brands", { method: "POST", headers: { "X-Upload-Key": "test-key" }, body: createForm }), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).brand;
    assert.equal(created.name, "Northstar");
    assert.deepEqual(created.channelIds, ["client-ig"]);

    const draftResponse = await worker.fetch(new Request(`http://localhost/api/brands/${created.id}/draft`, { method: "PUT", headers: { "content-type": "application/json", "X-Upload-Key": "test-key", "X-Brand-ID": created.id }, body: JSON.stringify({ prompt: "Northstar draft", timing: "auto", selectedChannels: ["client-ig"] }) }), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(draftResponse.status, 200);

    const editForm = new FormData(); editForm.set("profile", JSON.stringify({ ...profile, tone: "Direct and precise" }));
    const editResponse = await worker.fetch(new Request(`http://localhost/api/brands/${created.id}`, { method: "PATCH", headers: { "X-Upload-Key": "test-key", "X-Brand-ID": created.id }, body: editForm }), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(editResponse.status, 200);
    assert.equal((await editResponse.json()).brand.tone, "Direct and precise");

    const snapshotResponse = await worker.fetch(new Request("http://localhost/api/workspace", { headers: { "X-Upload-Key": "test-key" } }), env, { waitUntil() {}, passThroughOnException() {} });
    const snapshot = await snapshotResponse.json();
    const restored = snapshot.brands.find((brand) => brand.id === created.id);
    assert.equal(restored.draft.prompt, "Northstar draft");
    assert.deepEqual(restored.channelIds, ["client-ig"]);

    const unauthorized = await worker.fetch(new Request("http://localhost/api/agent", { method: "POST", headers: { "content-type": "application/json", "X-Upload-Key": "test-key", "X-Brand-ID": created.id }, body: JSON.stringify({ brandId: created.id, prompt: "Create one post", channels: ["lic"], timing: "auto" }) }), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(unauthorized.status, 400);
    assert.equal(bufferMutations.length, 0);

    const campaignResponse = await worker.fetch(new Request("http://localhost/api/agent", { method: "POST", headers: { "content-type": "application/json", "X-Upload-Key": "test-key", "X-Brand-ID": created.id }, body: JSON.stringify({ brandId: created.id, prompt: "Create one Northstar post next week", channels: [], timing: "auto" }) }), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(campaignResponse.status, 201);
    const campaign = await campaignResponse.json();
    assert.equal(campaign.brandId, created.id);
    assert.equal(bufferMutations.length, 1);
    assert.equal(bufferMutations[0].channelId, "client-ig");
    assert.match(plannerSystem, /Brand: Northstar|brand Northstar/i);
    assert.doesNotMatch(plannerSystem, /You are Atlasium's autonomous/);
    assert.ok([...r2.values.keys()].some((key) => key.startsWith(`brands/${created.id}/`) && key.endsWith(".png")));
    assert.ok([...r2.values.keys()].some((key) => key === `.echoflow-campaigns/${created.id}/${campaign.campaignId}.json`));

    const crossBrand = await worker.fetch(new Request(`http://localhost/api/campaign/${campaign.campaignId}`, { headers: { "X-Upload-Key": "test-key", "X-Brand-ID": "brand_atlasium_788_ai" } }), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(crossBrand.status, 403);
    assert.equal(bufferMutations.length, 1);

    const jobs = db.database.prepare("SELECT brand_id, destination_id, status FROM publish_jobs").all().map((row) => ({ ...row }));
    assert.deepEqual(jobs, [{ brand_id: created.id, destination_id: "client-ig", status: "confirmed" }]);
  } finally { globalThis.fetch = originalFetch; }
});
