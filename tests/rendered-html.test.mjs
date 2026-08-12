import assert from "node:assert/strict";
import test from "node:test";

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

test("selects explicitly named platforms and defaults to every channel", async () => {
  const worker = await loadWorker();
  const channels = [
    { id: "ig", service: "instagram", displayName: "Atlasium" },
    { id: "li1", service: "linkedin", displayName: "Blair" },
    { id: "li2", service: "linkedin", displayName: "Atlasium" },
    { id: "fb", service: "facebook", displayName: "Atlasium" },
  ];
  const named = await preview(worker, "Create posts for Instagram and LinkedIn", 2, { channels });
  assert.deepEqual(named.channels.map((channel) => channel.id), ["ig", "li1", "li2"]);
  const automatic = await preview(worker, "Create a launch campaign", 2, { channels });
  assert.equal(automatic.channels.length, 4);
});

test("publishes sample content through the complete Buffer scheduling mutation path", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  const mutations = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.query.includes("query Account")) return Response.json({ data: { account: { organizations: [{ id: "org", name: "Atlasium" }] } } });
    if (request.query.includes("query Channels")) return Response.json({ data: { channels: [{ id: "ig", name: "Atlasium", displayName: "Atlasium", service: "instagram" }, { id: "li", name: "Atlasium", displayName: "Atlasium", service: "linkedin" }] } });
    mutations.push(request.variables.input);
    return Response.json({ data: { createPost: { __typename: "PostActionSuccess", post: { id: `post-${mutations.length}`, status: "scheduled", dueAt: request.variables.input.dueAt, channelId: request.variables.input.channelId } } } });
  };
  try {
    const form = new FormData();
    form.set("image", new File([new Uint8Array([137, 80, 78, 71])], "sample.png", { type: "image/png" }));
    form.set("caption", "Sample Atlasium launch post");
    form.set("channels", JSON.stringify(["ig", "li"]));
    form.set("mode", "smartSchedule");
    form.set("timeZone", "America/Toronto");
    const response = await worker.fetch(new Request("http://localhost/api/publish", { method: "POST", headers: { "X-Upload-Key": "test-key" }, body: form }), { UPLOAD_KEY: "test-key", BUFFER_API_KEY: "buffer-test", UPLOADS: { put: async () => {} } }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 201);
    assert.equal(mutations.length, 2);
    assert.ok(mutations.every((input) => input.mode === "customScheduled" && Date.parse(input.dueAt) > Date.now() && input.assets[0].image.url.startsWith("http://localhost/i/")));
  } finally { globalThis.fetch = originalFetch; }
});
