import assert from "node:assert/strict";
import test from "node:test";

const owner = "afc062b2-7ef8-44bc-9678-6a2316ebd7f3";
const shared = "test-atlasium-echoflow-server-secret-must-be-at-least-forty-eight-chars";
const session = "a-separate-random-secret-for-signed-echoflow-sessions-not-shared";
const origin = "https://echo.test";
const envBase = {
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  UPLOADS: { get: async () => null },
  UPLOAD_KEY: "legacy-private-key",
  ATLASIUM_ECHOFLOW_SSO_ENABLED: "true",
  ATLASIUM_ECHOFLOW_OWNER_SUBJECT: owner,
  ATLASIUM_ECHOFLOW_SHARED_SECRET: shared,
  ATLASIUM_ECHOFLOW_SESSION_SECRET: session,
  ATLASIUM_CORE_FRONTEND_URL: "https://crm.test",
  ATLASIUM_CORE_API_URL: "https://crm-api.test",
  ATLASIUM_ECHOFLOW_PUBLIC_URL: origin,
};
const context = { waitUntil() {}, passThroughOnException() {} };

async function loadWorker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("isolated", String(Date.now()));
  return (await import(url.href)).default;
}

function nonceFromCookie(response) {
  const raw = response.headers.get("set-cookie") || "";
  const match = raw.match(/__Host-atlasium-echo-nonce=([^;,]+)/);
  assert.ok(match, "nonce cookie must be set");
  return decodeURIComponent(match[1]);
}

test("public sign-in link stays hidden when optional bridge is disabled", async () => {
  const worker = await loadWorker();
  const blocked = await worker.fetch(new Request(origin + "/api/atlasium/availability"), {
    ...envBase, ATLASIUM_ECHOFLOW_SSO_ENABLED: "false",
  }, context);
  assert.deepEqual(await blocked.json(), { ownerSignInAvailable: false });
  const on = await worker.fetch(new Request(origin + "/api/atlasium/availability"), envBase, context);
  assert.deepEqual(await on.json(), { ownerSignInAvailable: true });
});

test("EchoFlow single-sign-on defaults to disabled and never replaces legacy private access", async () => {
  const worker = await loadWorker();
  const disabled = await worker.fetch(new Request(origin + "/auth/atlasium/start"), {
    ...envBase, ATLASIUM_ECHOFLOW_SSO_ENABLED: "false",
  }, context);
  assert.equal(disabled.status, 503);
  const untrusted = await worker.fetch(new Request(origin + "/api/workspace"), envBase, context);
  assert.equal(untrusted.status, 401);
  const original = await worker.fetch(new Request(origin + "/api/workspace", {
    headers: { "X-Upload-Key": "legacy-private-key" },
  }), envBase, context);
  assert.notEqual(original.status, 401);
});

test("owner sign-in must verify nonce, owner identity and signed cookie; no customer tenancy leakage", async () => {
  const worker = await loadWorker();
  const started = await worker.fetch(new Request(origin + "/auth/atlasium/start"), envBase, context);
  assert.equal(started.status, 302);
  assert.match(started.headers.get("location") || "", /^https:\/\/crm\.test\/core\/echoflow\/continue\?nonce=/);
  assert.match(started.headers.get("set-cookie") || "", /HttpOnly/);
  assert.match(started.headers.get("set-cookie") || "", /Secure/);
  const nonce = nonceFromCookie(started);
  const ticket = "C".repeat(43);
  const stateCookie = `__Host-atlasium-echo-nonce=${encodeURIComponent(nonce)}`;
  const originalFetch = globalThis.fetch;
  let count = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      count += 1;
      assert.equal(init.headers["X-Atlasium-EchoFlow-Secret"], shared);
      return Response.json({ data: { subject: owner, workspaceId: owner, emailVerified: true, nonce } });
    };
    const finished = await worker.fetch(new Request(origin + "/auth/atlasium/finish?ticket=" + ticket, {
      headers: { Cookie: stateCookie },
    }), envBase, context);
    assert.equal(finished.status, 303);
    assert.equal(finished.headers.get("location"), origin + "/echo");
    const cookieHeader = finished.headers.get("set-cookie") || "";
    const sessionMatch = cookieHeader.match(/__Host-atlasium-echo-session=([^;,]+)/);
    assert.ok(sessionMatch);
    assert.equal(count, 1);
    const validCookie = "__Host-atlasium-echo-session=" + sessionMatch[1];
    const allowed = await worker.fetch(new Request(origin + "/api/workspace", {
      headers: { Cookie: validCookie },
    }), envBase, context);
    assert.notEqual(allowed.status, 401);
    const invalid = await worker.fetch(new Request(origin + "/api/workspace", {
      headers: { Cookie: validCookie + "tampered" },
    }), envBase, context);
    assert.equal(invalid.status, 401);

    const differentOwner = await worker.fetch(new Request(origin + "/api/workspace", {
      headers: { Cookie: validCookie },
    }), { ...envBase, ATLASIUM_ECHOFLOW_OWNER_SUBJECT: "48e8e661-7d3d-423e-a096-e7763401f00f" }, context);
    assert.equal(differentOwner.status, 401);

    const logout = await worker.fetch(new Request(origin + "/auth/atlasium/logout", { method: "POST" }), envBase, context);
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get("set-cookie") || "", /Max-Age=0/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sign-in rejects state mismatch, impersonated identities and unsafe origins", async () => {
  const worker = await loadWorker();
  const started = await worker.fetch(new Request(origin + "/auth/atlasium/start"), envBase, context);
  const nonce = nonceFromCookie(started);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ data: {
      subject: "48e8e661-7d3d-423e-a096-e7763401f00f",
      workspaceId: "48e8e661-7d3d-423e-a096-e7763401f00f", emailVerified: true, nonce,
    } });
    const rejected = await worker.fetch(new Request(origin + "/auth/atlasium/finish?ticket=" + "B".repeat(43), {
      headers: { Cookie: "__Host-atlasium-echo-nonce=" + nonce },
    }), envBase, context);
    assert.equal(rejected.status, 403);
    assert.doesNotMatch(rejected.headers.get("set-cookie") || "", /__Host-atlasium-echo-session=/);
    const originRejected = await worker.fetch(new Request("https://unknown-site.test/auth/atlasium/start"), envBase, context);
    assert.equal(originRejected.status, 503);
  } finally { globalThis.fetch = originalFetch; }
});
