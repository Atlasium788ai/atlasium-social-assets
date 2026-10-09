import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CyrusStore } from "../src/store.js";
import { CyrusAgent, looksLikeAction } from "../src/agent.js";
import { createToolbox } from "../src/tools.js";
import { loadConfig } from "../src/config.js";

let caseCount = 0;

function createScenario(role, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-scenario-"));
  const store = new CyrusStore(path.join(dir, role + ".sqlite"));
  const cfg = loadConfig({
    BOT_ROLE: role,
    BOT_DATA_DIR: dir,
    SLACK_APP_TOKEN: "test-app-token",
    SLACK_BOT_TOKEN: "test-bot-token",
    BLAIR_SLACK_USER_ID: "U_BLAIR",
    OPENAI_API_KEY: "test-model-key",
  });
  Object.assign(cfg, extra);
  return { store, cfg };
}

function currentTask(store, text) {
  caseCount += 1;
  return store.createTask({
    sourceEventId: "scenario:" + caseCount,
    requesterId: "U_BLAIR",
    channelId: "D_BLAIR",
    requestText: text,
  }).task;
}

function call(name, args = {}, id = "call_1", message = "") {
  return {
    output_text: message,
    output: [{ type: "function_call", name, arguments: JSON.stringify(args), call_id: id }],
  };
}

function model(script) {
  const calls = [];
  let cursor = 0;
  return {
    calls,
    async respond(request) {
      calls.push(request);
      return script[Math.min(cursor++, script.length - 1)];
    },
  };
}

test("critical revenue actions all require verification, not merely plausible narration", () => {
  for (const action of [
    "Book a prospect meeting", "Send 50 emails", "Collect the payment", "Invoice this client",
    "Deploy the fix", "Publish a campaign", "Contact this buyer", "Follow up with a lead",
    "Onboard the customer", "Clone the team", "Approve this deal", "Cancel a campaign",
  ]) assert.equal(looksLikeAction(action), true, action + " was classified as informational");
});

test("a fake booked meeting with no external receipt is blocked, not marked complete", async () => {
  const { store, cfg } = createScenario("malik");
  try {
    const agent = new CyrusAgent({
      store, config: cfg, maxTurns: 2,
      model: model([{ output_text: "Booked. The meeting is at 2 PM.", output: [] }]),
      toolbox: createToolbox({ store, config: cfg, slackApi: async () => ({ ok: true }) }),
    });
    const task = currentTask(store, "Book a qualified prospect meeting");
    const result = await agent.handleTask(task);
    assert.equal(store.getTask(task.id).status, "blocked");
    assert.match(result, /^Blocked\./);
    assert.doesNotMatch(result, /2 PM/);
  } finally { store.close(); }
});

test("a healthcheck receipt does not automatically complete an unrelated email send", async () => {
  const { store, cfg } = createScenario("malik");
  try {
    const agent = new CyrusAgent({
      store, config: cfg, maxTurns: 2,
      model: model([
        call("system_health", {}, "a1", "I've sent the emails."),
        { output_text: "Sent 100 prospect emails.", output: [] },
      ]),
      toolbox: createToolbox({ store, config: cfg, slackApi: async () => ({ ok: true }) }),
    });
    const task = currentTask(store, "Send 100 prospect emails");
    const result = await agent.handleTask(task);
    assert.equal(store.getTask(task.id).status, "blocked");
    assert.equal(store.getEvidence(task.id).length, 1);
    assert.match(result, /^Blocked\./);
    assert.doesNotMatch(result, /Sent 100 prospect emails/);
  } finally { store.close(); }
});

test("a model cannot override a recorded blocker with an invented campaign success", async () => {
  const { store, cfg } = createScenario("malik");
  try {
    const agent = new CyrusAgent({
      store, config: cfg, maxTurns: 2,
      model: model([call("report_blocker", { blocker: "No authorized outbound sending connector" }, "a1", "Done. 50 emails sent.")]),
      toolbox: createToolbox({ store, config: cfg, slackApi: async () => ({ ok: true }) }),
    });
    const task = currentTask(store, "Send 50 outbound emails");
    const result = await agent.handleTask(task);
    assert.match(result, /No authorized outbound sending connector/);
    assert.doesNotMatch(result, /Done\. 50 emails sent/);
    assert.equal(store.getTask(task.id).status, "blocked");
  } finally { store.close(); }
});

test("all six specialist roles block false completion and preserve their unique swarm instructions", async () => {
  for (const role of ["clara", "mateo", "kenji", "amara", "nadia", "sloane"]) {
    const { store, cfg } = createScenario(role);
    try {
      const scripted = model([
        call("complete_task", { summary: "External work is finished" }, "a1"),
        call("report_blocker", { blocker: "Missing external proof for the requested action" }, "a2", "Done. External work finished."),
      ]);
      const agent = new CyrusAgent({
        store, config: cfg, maxTurns: 3, model: scripted,
        toolbox: createToolbox({ store, config: cfg, slackApi: async () => ({ ok: true }) }),
      });
      const task = currentTask(store, "Verify the customer-impact incident before closing it");
      const result = await agent.handleTask(task);
      assert.match(result, /^Blocked\./, role);
      assert.equal(store.getTask(task.id).status, "blocked", role);
      assert.match(scripted.calls[0].instructions, /SWARM HANDOFF PACKET/);
      assert.ok(scripted.calls[0].instructions.includes(cfg.title), role + " has wrong personality");
    } finally { store.close(); }
  }
});

test("unconnected peers do not count as delegation and cannot produce a false swarm win", async () => {
  const { store, cfg } = createScenario("cyrus", { agentPeers: {} });
  try {
    const agent = new CyrusAgent({
      store, config: cfg, maxTurns: 3,
      model: model([
        call("delegate_to_agent", { agent: "kenji", objective: "Fix broken booking pipeline" }, "a1"),
        call("report_blocker", { blocker: "Kenji is not connected; booking fix was not delegated" }, "a2", "Delegated and fixed."),
      ]),
      toolbox: createToolbox({ store, config: cfg, slackApi: async () => ({ ok: true }) }),
    });
    const task = currentTask(store, "Delegate booking issue to Kenji and verify his fix");
    const reply = await agent.handleTask(task);
    assert.equal(store.getEvidence(task.id).length, 0);
    assert.equal(store.getTask(task.id).status, "blocked");
    assert.match(reply, /not connected/);
    assert.doesNotMatch(reply, /Delegated and fixed/);
  } finally { store.close(); }
});

test("a peer receiving work is not proof that the objective is complete", async () => {
  const { store, cfg } = createScenario("cyrus", { agentPeers: { kenji: "http://kenji.railway.internal:3001" } });
  try {
    const received = async () => new Response(JSON.stringify({ ok: true, status: "received", evidenceCount: 0 }), {
      status: 200, headers: { "content-type": "application/json" },
    });
    const agent = new CyrusAgent({
      store, config: cfg, maxTurns: 3,
      model: model([
        call("delegate_to_agent", { agent: "kenji", objective: "Repair booking" }, "a1"),
        call("complete_task", { summary: "Booking repaired" }, "a2"),
        call("report_blocker", { blocker: "Kenji accepted the work but no fix evidence exists" }, "a3"),
      ]),
      toolbox: createToolbox({ store, config: cfg, slackApi: async () => ({ ok: true }), fetchImpl: received }),
    });
    const task = currentTask(store, "Fix booking flow via Kenji and verify end-to-end");
    const reply = await agent.handleTask(task);
    const failures = store.db.prepare("SELECT status FROM task_steps WHERE task_id=? ORDER BY id").all(task.id).map(x => x.status);
    assert.deepEqual(failures, ["ok", "failed", "ok"]);
    assert.match(reply, /accepted the work but no fix evidence exists/);
    assert.equal(store.getTask(task.id).status, "blocked");
  } finally { store.close(); }
});

test("a peer handoff can complete when the peer actually returns verifiable completion", async () => {
  const { store, cfg } = createScenario("cyrus", { agentPeers: { kenji: "http://kenji.railway.internal:3001" } });
  try {
    const complete = async () => new Response(JSON.stringify({
      ok: true, status: "completed", evidenceCount: 2, summary: "Verified onboarding end-to-end",
    }), { status: 200, headers: { "content-type": "application/json" } });
    const agent = new CyrusAgent({
      store, config: cfg, maxTurns: 3,
      model: model([
        call("delegate_to_agent", { agent: "kenji", objective: "Verify onboarding path" }, "a1"),
        call("complete_task", { summary: "Peer verified onboarding" }, "a2"),
        { output_text: "Kenji returned a completed handoff and two evidence entries.", output: [] },
      ]),
      toolbox: createToolbox({ store, config: cfg, slackApi: async () => ({ ok: true }), fetchImpl: complete }),
    });
    const task = currentTask(store, "Verify onboarding flow with Kenji and close after proof");
    const reply = await agent.handleTask(task);
    assert.equal(store.getTask(task.id).status, "completed");
    assert.equal(store.getEvidence(task.id).length, 1);
    assert.match(reply, /two evidence entries/);
  } finally { store.close(); }
});
