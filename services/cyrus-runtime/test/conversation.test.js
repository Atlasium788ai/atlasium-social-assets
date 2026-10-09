import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CyrusStore } from "../src/store.js";
import { CyrusAgent } from "../src/agent.js";
import { SlackSocketRuntime } from "../src/slack.js";
import { isConversationOnly } from "../src/conversation.js";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cyrus-conversation-"));
  const store = new CyrusStore(path.join(dir, "cyrus.sqlite"));
  return {
    store,
    task: (message, sourceEventId = "test-conversation") => store.createTask({
      sourceEventId,
      requesterId: "U_BLAIR",
      channelId: "D_BLAIR",
      requestText: message,
    }).task,
    close: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

const hypothetical = "Cyrus: this is a conversational personality test only, not a business task. Hypothetical situation: the team celebrates eight bots but has no new revenue. What would you say? Do not use tools, delegate, contact people, or change any business system.";

test("explicit conversation-only instructions never authorize operational work", () => {
  assert.equal(isConversationOnly(hypothetical), true);
  assert.equal(isConversationOnly("Cyrus, what do you think about all these bots?"), true);
  assert.equal(isConversationOnly("Cyrus, just talk to me. No tools."), true);
  assert.equal(isConversationOnly("Cyrus: CONTROLLED INTERNAL TEST ONLY. Delegate to Clara, use system_health and report evidence."), false);
  assert.equal(isConversationOnly("Run a live revenue refresh via Malik and check Instantly"), false);
  assert.equal(isConversationOnly("Please check the real CRM status"), false);
});

test("personality conversation calls no tools and cannot delegate even if model hallucinates a call", async () => {
  const f = fixture();
  try {
    const requests = [];
    let toolExecutions = 0;
    const agent = new CyrusAgent({
      store: f.store,
      config: { role: "cyrus", name: "Cyrus" },
      model: {
        respond: async (request) => {
          requests.push(request);
          return {
            output_text: "A deployed bot is not revenue. Show me a buyer, a meeting, or cash before we celebrate.",
            output: [{ type: "function_call", name: "delegate_to_agent", arguments: '{"agent":"malik","objective":"do work"}', call_id: "invalid-call" }],
          };
        },
      },
      toolbox: { definitions: [{ type: "function", name: "delegate_to_agent" }], execute: async () => { toolExecutions += 1; throw new Error("side effect attempted"); } },
    });
    const current = f.task(hypothetical);
    const reply = await agent.handleTask(current);
    assert.match(reply, /A deployed bot is not revenue/);
    assert.equal(f.store.getTask(current.id).status, "completed");
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].tools, []);
    assert.equal(requests[0].input.length, 2);
    assert.match(requests[0].input[0].content, /ATLASIUM 7\/88 OPERATING BRIEF/);
    assert.equal(requests[0].input[1].content, hypothetical);
    assert.match(requests[0].instructions, /CONVERSATION-ONLY MODE/);
    assert.equal(toolExecutions, 0);
    assert.deepEqual(f.store.getWorkItems(current.id), []);
    assert.deepEqual(f.store.getEvidence(current.id), []);
  } finally {
    f.close();
  }
});

test("conversational model errors do not trigger tool calls", async () => {
  const f = fixture();
  try {
    const agent = new CyrusAgent({
      store: f.store,
      config: { role: "cyrus", name: "Cyrus" },
      model: { respond: async () => { throw new Error("offline"); } },
      toolbox: { definitions: [], execute: async () => { throw new Error("must not execute"); } },
    });
    const current = f.task(hypothetical);
    const reply = await agent.handleTask(current);
    assert.match(reply, /AI connection failed/);
    assert.equal(f.store.getTask(current.id).status, "blocked");
  } finally {
    f.close();
  }
});

test("Slack uses received, working, and completed reactions without robotic placeholder text", async () => {
  const f = fixture();
  try {
    const calls = [];
    const runtime = new SlackSocketRuntime({
      config: { blairSlackUserId: "U_BLAIR", role: "cyrus", name: "Cyrus" },
      store: f.store,
      agent: { handleTask: async () => "I want sales, not another victory lap." },
      slackApi: async (method, payload) => {
        calls.push({ method, payload });
        return { ok: true, ts: "100.2" };
      },
      WebSocketImpl: class {},
      logger: { info() {}, warn() {}, error() {} },
    });
    await runtime.processSlackMessage({ type: "message", channel_type: "im", user: "U_BLAIR", channel: "D_BLAIR", ts: "100.1", text: "Talk to me about results" });
    assert.deepEqual(calls.map(item => item.method), [
      "reactions.add",
      "reactions.add",
      "reactions.remove",
      "chat.postMessage",
      "reactions.remove",
      "reactions.add",
    ]);
    assert.equal(calls[0].payload.name, "eyes");
    assert.equal(calls[1].payload.name, "hourglass_flowing_sand");
    assert.equal(calls[2].payload.name, "eyes");
    assert.equal(calls[4].payload.name, "hourglass_flowing_sand");
    assert.equal(calls[5].payload.name, "white_check_mark");
    assert.equal(calls[0].payload.timestamp, "100.1");
    assert.equal(calls[3].payload.text, "I want sales, not another victory lap.");
    assert.equal(calls.filter(x => /Working on it/i.test(x.payload.text || "")).length, 0);
  } finally {
    f.close();
  }
});

test("Slack replaces working status with a warning when task handling fails", async () => {
  const f = fixture();
  try {
    const calls = [];
    const runtime = new SlackSocketRuntime({
      config: { blairSlackUserId: "U_BLAIR", role: "cyrus", name: "Cyrus" },
      store: f.store,
      agent: { handleTask: async () => { throw new Error("diagnostic failed"); } },
      slackApi: async (method, payload) => {
        calls.push({ method, payload });
        return { ok: true, ts: "102.2" };
      },
      WebSocketImpl: class {},
      logger: { info() {}, warn() {}, error() {} },
    });
    await assert.rejects(
      runtime.processSlackMessage({ type: "message", channel_type: "im", user: "U_BLAIR", channel: "D_BLAIR", ts: "102.1", text: "Run diagnostics" }),
      /diagnostic failed/
    );
    assert.deepEqual(calls.map(item => [item.method, item.payload.name || null]), [
      ["reactions.add", "eyes"],
      ["reactions.add", "hourglass_flowing_sand"],
      ["reactions.remove", "eyes"],
      ["reactions.remove", "hourglass_flowing_sand"],
      ["reactions.add", "warning"],
    ]);
  } finally {
    f.close();
  }
});

test("Slack reaction permission failures do not block the real reply", async () => {
  const f = fixture();
  try {
    const calls = [];
    const runtime = new SlackSocketRuntime({
      config: { blairSlackUserId: "U_BLAIR", role: "cyrus", name: "Cyrus" },
      store: f.store,
      agent: { handleTask: async () => "The result matters." },
      slackApi: async (method, payload) => {
        calls.push(method);
        return method.startsWith("reactions.") ? { ok: false, error: "missing_scope" } : { ok: true, ts: "101.2" };
      },
      WebSocketImpl: class {},
      logger: { info() {}, warn() {}, error() {} },
    });
    assert.equal(await runtime.processSlackMessage({ type: "message", channel_type: "im", user: "U_BLAIR", channel: "D_BLAIR", ts: "101.1", text: "Just talk" }), true);
    assert.deepEqual(calls, ["reactions.add", "chat.postMessage"]);
    assert.equal(runtime.reactionPermission, "missing_scope");
  } finally {
    f.close();
  }
});
