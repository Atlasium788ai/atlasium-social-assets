import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

test("renders the Atlasium uploader", async () => {
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
  assert.match(html, /<title>Atlasium Image Upload<\/title>/i);
  assert.match(html, /Upload\. Copy\. Post\./);
  assert.match(html, /Choose from Photos/);
  assert.match(html, /Send to Buffer/);
  assert.doesNotMatch(html, /codex-preview/);
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
