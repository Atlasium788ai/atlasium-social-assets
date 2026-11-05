import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const origin = "https://echo.test";
const owner = "afc062b2-7ef8-44bc-9678-6a2316ebd7f3";
const customerA = "29c8c8b5-e1a2-4d88-9d9a-3d50cbedb3fa";
const customerB = "8e15ccf0-e750-4a67-8134-81a62de94f41";
const secret = "distinct-sso-bridge-secret-with-at-least-forty-eight-chars-000";
const sessionSecret = "distinct-cookie-session-secret-with-at-least-forty-eight-chars";
const env = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  UPLOADS: { get: async () => null },
  UPLOAD_KEY: "original-private-key",
  ATLASIUM_ECHOFLOW_SSO_ENABLED: "true",
  ATLASIUM_ECHOFLOW_TENANTS_ENABLED: "true",
  ATLASIUM_ECHOFLOW_OWNER_SUBJECT: owner,
  ATLASIUM_ECHOFLOW_SHARED_SECRET: secret,
  ATLASIUM_ECHOFLOW_SESSION_SECRET: sessionSecret,
  ATLASIUM_CORE_FRONTEND_URL: "https://crm.test",
  ATLASIUM_CORE_API_URL: "https://crm-api.test",
  ATLASIUM_ECHOFLOW_PUBLIC_URL: origin,
};
const ctx = { waitUntil() {}, passThroughOnException() {} };
async function worker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("tenant", String(Date.now()));
  return (await import(url.href)).default;
}
async function memoryD1() {
  const database = new DatabaseSync(":memory:");
  const migration = await readFile(new URL("../drizzle/0000_fast_thaddeus_ross.sql", import.meta.url), "utf8");
  for (const sql of migration.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) database.exec(sql);
  class Statement {
    constructor(sql, binds = []) { this.sql = sql; this.binds = binds; }
    bind(...args) { return new Statement(this.sql, args); }
    async first() { return database.prepare(this.sql).get(...this.binds) || null; }
    async all() { return { results: database.prepare(this.sql).all(...this.binds) }; }
    async run() { const out = database.prepare(this.sql).run(...this.binds); return { success: true, meta: { changes: Number(out.changes) } }; }
  }
  return {
    database,
    prepare(sql) { return new Statement(sql); },
    async batch(statements) { return Promise.all(statements.map((s) => s.run())); },
  };
}
function cookie(response, cookieName) {
  const value = response.headers.get("set-cookie") || "";
  const match = value.match(new RegExp(cookieName + "=([^;,]+)"));
  assert.ok(match, cookieName + " cookie must exist");
  return cookieName + "=" + match[1];
}
async function tenantCookie(application, db, subject) {
  const started = await application.fetch(new Request(origin + "/auth/atlasium/start"), { ...env, DB: db }, ctx);
  assert.equal(started.status, 302);
  const nonce = decodeURIComponent(cookie(started, "__Host-atlasium-echo-nonce").split("=")[1]);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/exchange")) return Response.json({
      data: { subject, workspaceId: subject, emailVerified: true, nonce },
    });
    if (String(url).endsWith("/entitlement")) return Response.json({
      data: { workspaceOwnerId: subject, subscribed: false, creditsRemaining: 0, canPublish: false },
    });
    throw new Error("Unexpected internal request");
  };
  try {
    const result = await application.fetch(new Request(origin + "/auth/atlasium/finish?ticket=" + "Q".repeat(43), {
      headers: { Cookie: cookie(started, "__Host-atlasium-echo-nonce") },
    }), { ...env, DB: db }, ctx);
    assert.equal(result.status, 303);
    assert.equal(result.headers.get("location"), origin + "/atlasium/workspace");
    return cookie(result, "__Host-atlasium-echo-tenant");
  } finally { globalThis.fetch = oldFetch; }
}

test("customer workspace data is isolated from Atlasium and other customers", async () => {
  const application = await worker();
  const db = await memoryD1();

  const a = await tenantCookie(application, db, customerA);
  const b = await tenantCookie(application, db, customerB);
  const settings = { ...env, DB: db };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/entitlement")) {
      return Response.json({ data: { workspaceOwnerId: customerA, subscribed: false, creditsRemaining: 0, canPublish: false } });
    }
    throw new Error("Unexpected request");
  };
  try {
    const noAuth = await application.fetch(new Request(origin + "/api/atlasium/customer/workspace"), settings, ctx);
    assert.equal(noAuth.status, 401);
    const created = await application.fetch(new Request(origin + "/api/atlasium/customer/brands", {
      method: "POST",
      headers: { Cookie: a, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Company A", workspaceId: "workspace_atlasium" }),
    }), settings, ctx);
    assert.equal(created.status, 201);
    const brandA = (await created.json()).brand;
    assert.ok(brandA.workspaceId.startsWith("workspace_customer_"));
    assert.notEqual(brandA.workspaceId, "workspace_atlasium");
    const listA = await application.fetch(new Request(origin + "/api/atlasium/customer/workspace", {
      headers: { Cookie: a, "X-Workspace-ID": "workspace_atlasium" },
    }), settings, ctx);
    assert.equal(listA.status, 200);
    const bodyA = await listA.json();
    assert.equal(bodyA.brands.length, 1);
    assert.equal(bodyA.brands[0].name, "Company A");
    assert.equal(bodyA.publishingEnabled, false);
    assert.equal(bodyA.access.canPublish, false);
    const listB = await application.fetch(new Request(origin + "/api/atlasium/customer/workspace", {
      headers: { Cookie: b, "X-Workspace-ID": brandA.workspaceId },
    }), settings, ctx);
    assert.equal(listB.status, 200);
    const bodyB = await listB.json();
    assert.deepEqual(bodyB.brands, []);
    assert.notEqual(bodyA.workspace.id, bodyB.workspace.id);

    const forbidden = await application.fetch(new Request(origin + "/api/agent", {
      method: "POST",
      headers: { Cookie: a, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Publish for Atlasium" }),
    }), settings, ctx);
    assert.equal(forbidden.status, 401);

    const csrf = await application.fetch(new Request(origin + "/api/atlasium/customer/brands", {
      method: "POST",
      headers: { Cookie: a, Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Impersonation" }),
    }), settings, ctx);
    assert.equal(csrf.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
    db.database.close();
  }
});

test("tenant session cannot be forged to enter Atlasium's legacy workspace", async () => {
  const application = await worker();
  const db = await memoryD1();
  try {
    const valid = await tenantCookie(application, db, customerA);
    const bad = valid + "tamper";
    const result = await application.fetch(new Request(origin + "/api/atlasium/customer/workspace", {
      headers: { Cookie: bad },
    }), { ...env, DB: db }, ctx);
    assert.equal(result.status, 401);
  } finally { db.database.close(); }
});
