import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

test("renders the Atlasium social agent", async () => {
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
  assert.match(html, /<title>Atlasium Social Agent<\/title>/i);
  assert.match(html, /What should/);
  assert.match(html, /Create &amp; Publish/);
  assert.doesNotMatch(html, /codex-preview/);
});

test("client allows automatic channel routing and never silently ignores a publish click", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /!selected\.length\s*\|\|\s*busy/);
  assert.match(source, /channels:\s*selected/);
  assert.match(source, /if \(!prompt\.trim\(\)\) \{ setStatus/);
  assert.match(source, /if \(!channels\.length\) \{ setStatus/);
  assert.match(source, /disabled=\{busy\}/);
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

test("selects distinct LinkedIn destinations and intelligently distributes an 8-day Atlasium campaign", async () => {
  const worker = await loadWorker();
  const channels = [
    { id: "ig", service: "instagram", displayName: "atlasium788ai" },
    { id: "li1", service: "linkedin", displayName: "Blair Ryan Barton" },
    { id: "li2", service: "linkedin", displayName: "Atlasium 7/88 AI" },
    { id: "fb", service: "facebook", displayName: "Atlasium 7/88 AI Facebook" },
    { id: "tt", service: "tiktok", displayName: "atlasium.788.ai" },
  ];
  const named = await preview(worker, "Create posts for Instagram and LinkedIn", 2, { channels });
  assert.deepEqual(named.channels.map((channel) => channel.id), ["ig", "li2"]);
  const personal = await preview(worker, "Share my founder perspective on LinkedIn", 1, { channels });
  assert.deepEqual(personal.channels.map((channel) => channel.id), ["li1"]);
  const samplePosts = Array.from({ length: 8 }, (_, index) => ({ concept: `Atlasium campaign concept ${index + 1}`, caption: `Distinct Atlasium business message ${index + 1}`, imagePrompt: `Visual ${index + 1}` }));
  const campaign = await preview(worker, "Create an 8-day Atlasium business campaign", 8, { channels, samplePosts });
  assert.deepEqual(campaign.assignments.map((item) => item.channel), ["Atlasium 7/88 AI", "atlasium788ai", "Atlasium 7/88 AI Facebook", "Atlasium 7/88 AI", "atlasium788ai", "Atlasium 7/88 AI Facebook", "Atlasium 7/88 AI", "atlasium788ai"]);
  assert.deepEqual(new Set(campaign.assignments.map((item) => item.service)), new Set(["linkedin", "instagram", "facebook"]));
  assert.ok(campaign.assignments.every((item) => item.channel !== "Blair Ryan Barton"));
  assert.equal(campaign.assignments.filter((item) => item.service === "linkedin").length, 3);
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
    assert.equal(mutations.length, 1);
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
    assert.equal(mutations.length, 15);
    assert.deepEqual(mutations.map((input) => input.dueAt), expected);
    assert.equal(new Set(data.results.map((result) => result.id)).size, 15);
    assert.deepEqual(data.results.map((result) => result.dueAt), expected);
    assert.ok(data.results.every((result, index) => result.channelId === mutations[index].channelId && result.status === "SCHEDULED"));
    assert.ok(data.results.every((result) => result.channel !== "Blair Ryan Barton"));
  } finally { globalThis.fetch = originalFetch; }
});

test("manual channel selection overrides automatic routing", async () => {
  const worker = await loadWorker();
  const channels = [{ id: "ig", service: "instagram", displayName: "Instagram" }, { id: "fb", service: "facebook", displayName: "Facebook" }];
  const samplePosts = Array.from({ length: 3 }, (_, index) => ({ concept: `Concept ${index}`, caption: `Caption ${index}`, imagePrompt: "Image" }));
  const data = await preview(worker, "Create an Atlasium campaign", 3, { channels, selected: ["fb"], samplePosts });
  assert.ok(data.assignments.every((item) => item.channelId === "fb"));
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
    assert.deepEqual(mutations.at(-1).metadata.tiktok, { title: "Atlasium TikTok photo update", isAiGenerated: false });
  } finally { globalThis.fetch = originalFetch; }
});
