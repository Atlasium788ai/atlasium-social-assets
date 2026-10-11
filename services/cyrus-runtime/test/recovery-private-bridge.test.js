import test from "node:test";
import assert from "node:assert/strict";
import { createToolbox } from "../src/tools.js";
import { loadConfig, loadSharedRoleConfigs } from "../src/config.js";

const endpoint = "https://qywkyngkxaqfvcumgaro.supabase.co/functions/v1/atlasium-recovery-inventory";

const config = {
  role: "malik",
  name: "Malik",
  recoveryInventoryUrl: endpoint,
  recoveryReadToken: "offline-test-token"
};

function toolbox(data, status = 200, extra = {}) {
  const requests = [];
  const tb = createToolbox({
    store: {},
    config: { ...config, ...extra },
    slackApi: async () => { throw Error("No Slack writes during recovery tests"); },
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), method: init.method, bearerSet: init.headers.Authorization === "Bearer offline-test-token" });
      return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    }
  });
  return { ...tb, requests };
}

test("recovery inventory gives Malik a verifiable, strictly non-sending read", async () => {
  const { definitions, execute, requests } = toolbox({
    system: "atlasium_recovery_quarantine",
    originalReeviqCRMRestored: false,
    emailCandidates: 3401,
    phoneOnlyReview: 577,
    verifiedContacts: 0,
    suppressionChecked: 0,
    outreachEligible: false
  });
  assert.ok(definitions.some(tool => tool.name === "recovery_candidates"));
  const result = await execute("recovery_candidates", { mode: "summary" }, {});
  assert.equal(result.ok, true);
  assert.equal(result.data.emailCandidates, 3401);
  assert.equal(result.data.phoneOnlyReview, 577);
  assert.equal(result.data.canSend, false);
  assert.equal(result.data.crmRestored, false);
  assert.equal(requests[0].bearerSet, true);
  assert.equal(requests[0].method, "GET");
  assert.ok(requests[0].url.includes("mode=summary"));
});

test("recovery research strips contact information and cannot clear suppression", async () => {
  const { execute, requests } = toolbox({
    system: "atlasium_recovery_quarantine",
    originalReeviqCRMRestored: false,
    outreachEligible: false,
    candidates: [{ recoveryId: 3, company: "Example Plumbing", jobTitle: "Manager", industry: "Plumbing", location: "Ontario", email: "confidential@example.com", outreachEligible: true }],
  });
  const result = await execute("recovery_candidates", { mode: "research", limit: 2 }, {});
  assert.equal(result.ok, true);
  assert.equal(result.data.canSend, false);
  assert.equal(result.data.candidates[0].outreachEligible, false);
  assert.equal(result.data.candidates[0].email, undefined);
  assert.ok(requests[0].url.includes("mode=research"));
});

test("missing authorization, a live CRM claim, or invalid endpoint fail closed", async () => {
  const blocked = toolbox({ error: "unauthorized" }, 401);
  assert.equal((await blocked.execute("recovery_candidates", { mode: "summary" }, {})).ok, false);
  const untrusted = toolbox({ system: "atlasium_recovery_quarantine", originalReeviqCRMRestored: true, outreachEligible: true });
  assert.equal((await untrusted.execute("recovery_candidates", { mode: "summary" }, {})).ok, false);
  const otherHost = toolbox({}, 200, { recoveryInventoryUrl: "https://untrusted.example.com/steal" });
  assert.equal((await otherHost.execute("recovery_candidates", { mode: "summary" }, {})).ok, false);
  assert.equal(otherHost.requests.length, 0);
});

test("other executive roles cannot call Malik's private recovery interface", async () => {
  const tb = toolbox({}, 200, { role: "cyrus" });
  assert.equal(tb.definitions.some(tool => tool.name === "recovery_candidates"), false);
  assert.equal((await tb.execute("recovery_candidates", {}, {})).ok, false);
  assert.equal(tb.requests.length, 0);
});
