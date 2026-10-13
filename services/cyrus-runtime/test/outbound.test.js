import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CyrusStore } from "../src/store.js";
import { loadConfig } from "../src/config.js";
import { createToolbox } from "../src/tools.js";
import { createMicrosoftGraphTransport, createUnsubscribeToken, emailFingerprint, verifyUnsubscribeToken } from "../src/outbound.js";

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command88-outbound-"));
  return { dir, store: new CyrusStore(path.join(dir, "malik.sqlite")) };
}

function task(store, event = "outbound-event") {
  return store.createTask({ sourceEventId: event, requesterId: "U_BLAIR", channelId: "D_BLAIR", requestText: "Send the approved pilot email" }).task;
}

function tokenFor(tenantId, roles = ["Mail.Send"]) {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ tid: tenantId, roles, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${header}.${payload}.signature`;
}

function malikConfig(overrides = {}) {
  return {
    role: "malik",
    name: "Malik",
    blairSlackUserId: "U_BLAIR",
    agentPeers: {},
    slackAllowedChannelIds: new Set(),
    httpReadAllowlist: new Set(),
    reeviqApiKeys: [],
    instantlyEnabled: false,
    outboundEmailProvider: "microsoft_graph",
    outboundSendEnabled: true,
    outboundDailyCap: 5,
    outboundPhysicalAddress: "100 Test Street, Toronto, ON",
    outboundPublicBaseUrl: "https://atlasium-swarm-production.up.railway.app",
    outboundUnsubscribeSecret: "offline-test-secret",
    microsoftGraphTenantId: "tenant-123",
    microsoftGraphClientId: "client-123",
    microsoftGraphClientSecret: "secret-123",
    microsoftGraphSender: "info@atlasium788.ca",
    ...overrides,
  };
}

const sendArgs = {
  email: "buyer@example.com",
  source_lead_id: "lead-123",
  source_email_verified: true,
  subject: "A relevant business question",
  text: "Can we discuss the verified business problem?",
  consent_basis: "recent_inquiry",
  consent_evidence: "Inbound request received on 2026-10-10",
};

test("outbound configuration is disabled by default and parses an explicit Microsoft provider", () => {
  const base = {
    BOT_ROLE: "malik",
    SLACK_APP_TOKEN: "xapp-test",
    SLACK_BOT_TOKEN: "xoxb-test",
    BLAIR_SLACK_USER_ID: "U_BLAIR",
    OPENAI_API_KEY: "test",
  };
  assert.equal(loadConfig(base).outboundEmailProvider, "disabled");
  const configured = loadConfig({ ...base, OUTBOUND_EMAIL_PROVIDER: "microsoft_graph", OUTBOUND_SEND_ENABLED: "true", OUTBOUND_DAILY_CAP: "3" });
  assert.equal(configured.outboundEmailProvider, "microsoft_graph");
  assert.equal(configured.outboundSendEnabled, true);
  assert.equal(configured.outboundDailyCap, 3);
});

test("Microsoft Graph preflight verifies the exact tenant and Mail.Send role without sending", async () => {
  const cfg = malikConfig({ outboundSendEnabled: false });
  const calls = [];
  const transport = createMicrosoftGraphTransport({
    config: cfg,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), method: options.method });
      return new Response(JSON.stringify({ access_token: tokenFor(cfg.microsoftGraphTenantId), expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const result = await transport.preflight();
  assert.equal(result.tenantMatched, true);
  assert.equal(result.mailSendAuthorized, true);
  assert.equal(result.sendEnabled, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /login\.microsoftonline\.com/);
});

test("Microsoft Graph preflight rejects a wrong tenant or missing Mail.Send role", async () => {
  const cfg = malikConfig();
  const wrongTenant = createMicrosoftGraphTransport({
    config: cfg,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: tokenFor("other-tenant"), expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(() => wrongTenant.preflight(), /tenant does not match/i);
  const wrongRole = createMicrosoftGraphTransport({
    config: cfg,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: tokenFor(cfg.microsoftGraphTenantId, ["User.Read.All"]), expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(() => wrongRole.preflight(), /lacks the Mail\.Send/i);
});

test("one approved email is accepted once, recorded without plaintext recipient, and never claimed delivered", async () => {
  const { store } = tempStore();
  const current = task(store);
  const cfg = malikConfig();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), body: String(options.body || ""), contentType: options.headers?.["content-type"] });
    if (String(url).includes("login.microsoftonline.com")) {
      return new Response(JSON.stringify({ access_token: tokenFor(cfg.microsoftGraphTenantId), expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("", { status: 202, headers: { "request-id": "graph-request-1" } });
  };
  const toolbox = createToolbox({ store, config: cfg, slackApi: async () => ({ ok: true }), fetchImpl });
  const first = await toolbox.execute("outbound_email_send", sendArgs, { taskId: current.id, requiresEvidence: true });
  assert.equal(first.ok, true);
  assert.equal(first.data.accepted, true);
  assert.equal(first.data.delivered, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].contentType, "text/plain");
  const mime = Buffer.from(calls[1].body, "base64").toString("utf8");
  assert.match(mime, /List-Unsubscribe:/);
  assert.match(mime, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/);
  assert.match(mime, /multipart\/alternative/);

  const repeated = await toolbox.execute("outbound_email_send", sendArgs, { taskId: current.id, requiresEvidence: true });
  assert.equal(repeated.ok, true);
  assert.equal(repeated.data.duplicate, true);
  assert.equal(calls.length, 2, "idempotent retry sent a duplicate email");

  const persisted = JSON.stringify(store.db.prepare("SELECT * FROM outbound_email_attempts").all());
  assert.doesNotMatch(persisted, /buyer@example\.com/i);
  assert.match(persisted, /graph-request-1/);
  store.close();
});

test("suppression, missing approval, unverified sources, and disabled sending stop before the network", async () => {
  const { store } = tempStore();
  const current = task(store, "outbound-guards");
  let fetches = 0;
  const cfg = malikConfig();
  const toolbox = createToolbox({ store, config: cfg, slackApi: async () => ({ ok: true }), fetchImpl: async () => { fetches += 1; throw new Error("network must not run"); } });
  const suppressed = await toolbox.execute("outbound_email_suppress", { email: sendArgs.email, reason: "unsubscribe", evidence_reference: "recipient-request" }, { taskId: current.id });
  assert.equal(suppressed.ok, true);
  assert.equal((await toolbox.execute("outbound_email_send", sendArgs, { taskId: current.id })).ok, false);
  const unapproved = store.createTask({ sourceEventId: "prepare-only", requesterId: "U_BLAIR", channelId: "D_OTHER", requestText: "Prepare an email draft but do not send it" }).task;
  const noApproval = await toolbox.execute("outbound_email_send", { ...sendArgs, email: "other@example.com" }, { taskId: unapproved.id });
  assert.equal(noApproval.ok, false);
  assert.match(noApproval.error, /not a direct, explicit email approval/i);
  assert.equal((await toolbox.execute("outbound_email_send", { ...sendArgs, email: "other@example.com", source_email_verified: false }, { taskId: current.id })).ok, false);
  const disabled = createToolbox({ store, config: malikConfig({ outboundSendEnabled: false }), slackApi: async () => ({ ok: true }), fetchImpl: async () => { fetches += 1; } });
  assert.equal((await disabled.execute("outbound_email_send", { ...sendArgs, email: "third@example.com" }, { taskId: current.id })).ok, false);
  assert.equal(fetches, 0);
  store.close();
});

test("uncertain outbound attempts survive restart and cannot be retried automatically", () => {
  const { dir, store } = tempStore();
  const current = task(store, "outbound-restart");
  store.reserveOutboundEmail({
    idempotencyKey: "attempt-1",
    taskId: current.id,
    provider: "microsoft_graph",
    recipientHash: emailFingerprint("buyer@example.com"),
    sourceLeadId: "lead-1",
    subjectHash: "subject-hash",
    consentBasis: "recent_inquiry",
    consentEvidence: "inquiry",
    approvalReference: current.source_event_id,
  });
  store.updateOutboundEmail("attempt-1", { status: "sending" });
  const databasePath = path.join(dir, "malik.sqlite");
  store.close();
  const restarted = new CyrusStore(databasePath);
  restarted.recoverInterruptedTasks();
  assert.equal(restarted.getOutboundEmail("attempt-1").status, "unknown");
  assert.equal(restarted.health().outboundUnknown, 1);
  restarted.close();
});

test("signed one-click unsubscribe tokens reject tampering and map to a suppression fingerprint", () => {
  const secret = "test-secret";
  const token = createUnsubscribeToken("Buyer@Example.com", secret);
  assert.doesNotMatch(token, /Buyer|buyer|example/i);
  assert.equal(verifyUnsubscribeToken(token, secret), emailFingerprint("buyer@example.com"));
  assert.equal(verifyUnsubscribeToken(`${token}x`, secret), null);
  assert.equal(emailFingerprint("Buyer@Example.com"), emailFingerprint("buyer@example.com"));
});

test("expired Instantly is terminal and forged revenue calls from other executives are rejected", async () => {
  const { store } = tempStore();
  let fetches = 0;
  const current = task(store, "provider-guards");
  const malik = createToolbox({ store, config: malikConfig({ instantlyEnabled: false }), slackApi: async () => ({ ok: true }), fetchImpl: async () => { fetches += 1; } });
  const unavailable = await malik.execute("instantly_campaign", {}, { taskId: current.id });
  assert.equal(unavailable.ok, false);
  assert.match(unavailable.error, /HTTP 402/);
  const cyrus = createToolbox({ store, config: { ...malikConfig(), role: "cyrus", name: "Cyrus" }, slackApi: async () => ({ ok: true }), fetchImpl: async () => { fetches += 1; } });
  const forged = await cyrus.execute("outbound_email_send", sendArgs, { taskId: current.id });
  assert.equal(forged.ok, false);
  assert.match(forged.error, /restricted to Malik/i);
  assert.equal(fetches, 0);
  store.close();
});

test("ReeVIQ tries the next existing credential after an unscoped 400 and accepts only authenticated data", async () => {
  const { store } = tempStore();
  const current = task(store, "reeviq-fallback");
  const keys = ["old-key", "valid-key"];
  let calls = 0;
  const toolbox = createToolbox({
    store,
    config: malikConfig({ reeviqBaseUrl: "https://reeviq.example.com", reeviqApiKeys: keys }),
    slackApi: async () => ({ ok: true }),
    fetchImpl: async (_url, options) => {
      calls += 1;
      assert.equal(options.headers["X-Api-Key"], keys[calls - 1]);
      if (calls === 1) return new Response(JSON.stringify({ message: "coreiqUserId is required (pass in filter/body, or call with a valid Bearer token)" }), { status: 400, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ data: [{ id: "lead-1", email: "verified@example.com", emailVerified: true }], count: 1 }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const result = await toolbox.execute("reeviq_leads", { limit: 1 }, { taskId: current.id });
  assert.equal(result.ok, true);
  assert.equal(result.data.count, 1);
  assert.equal(calls, 2);
  store.close();
});
