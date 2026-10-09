import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CyrusStore } from "../src/store.js";
import { createToolbox } from "../src/tools.js";
import { CyrusAgent } from "../src/agent.js";
import { isConversationOnly } from "../src/conversation.js";
import { loadConfig } from "../src/config.js";
import { createOpenAiModel } from "../src/model.js";
import { shouldHandleMessage, SlackSocketRuntime } from "../src/slack.js";
import { systemPrompt } from "../src/personality.js";

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cyrus-test-"));
  return { dir, store: new CyrusStore(path.join(dir, "cyrus.sqlite")) };
}

function config(overrides = {}) {
  return {
    role: "cyrus",
    name: "Cyrus",
    blairSlackUserId: "U_BLAIR",
    slackAllowedChannelIds: new Set(["C_TEAM"]),
    httpReadAllowlist: new Set(["https://status.example.com"]),
    agentPeers: {},
    ...overrides,
  };
}

function task(store, eventId, text) {
  return store.createTask({ sourceEventId: eventId, requesterId: "U_BLAIR", channelId: "D_BLAIR", requestText: text }).task;
}

function scriptedModel(responses) {
  let index = 0;
  return { respond: async () => responses[Math.min(index++, responses.length - 1)] };
}

function call(name, args, callId = "call_1") {
  return { output: [{ type: "function_call", name, arguments: JSON.stringify(args), call_id: callId }] };
}

test("direct Blair DM is accepted and staff DM is ignored", () => {
  assert.equal(shouldHandleMessage({ type: "message", channel_type: "im", user: "U_BLAIR", text: "Check health" }, config()), true);
  assert.equal(shouldHandleMessage({ type: "message", channel_type: "im", user: "U_STAFF", text: "Check health" }, config()), false);
});

test("explicit internal diagnostics remain actions despite conversational framing and no external messaging", async () => {
  const request = "This is a conversational exercise. Do not use external messaging. Perform internal diagnostics and report the results.";
  assert.equal(isConversationOnly(request), false);

  const profiles = {
    cyrus: "Cyrus",
    malik: "Malik",
    clara: "Clara",
    mateo: "Mateo",
    kenji: "Kenji",
    amara: "Amara",
    nadia: "Nadia",
    sloane: "Sloane",
  };

  for (const [role, name] of Object.entries(profiles)) {
    const { store } = tempStore();
    const seenInstructions = [];
    let attempt = 0;
    const model = {
      respond: async ({ instructions, input }) => {
        seenInstructions.push(instructions);
        attempt += 1;
        if (attempt === 1) {
          assert.match(input[0].content, /Request routing: ACTION/);
          return { output_text: "This sounds conversation-only.", output: [] };
        }
        if (attempt === 2) return call("system_health", {}, `${role}_health`);
        return {
          output_text: "Internal diagnostics passed and were verified.",
          ...call("complete_task", { summary: "Internal diagnostics passed." }, `${role}_complete`),
        };
      },
    };
    const roleConfig = config({ role, name });
    const toolbox = createToolbox({ store, config: roleConfig, slackApi: async () => ({ ok: true }), fetchImpl: fetch });
    const agent = new CyrusAgent({ store, model, toolbox, config: roleConfig });
    const current = task(store, `Ev-routing-${role}`, request);
    const reply = await agent.handleTask(current);

    assert.equal(store.getTask(current.id).status, "completed", `${role} treated the request as conversation-only`);
    assert.equal(store.getEvidence(current.id).length, 1, `${role} completed without diagnostic evidence`);
    assert.match(reply, /verified/i);
    assert.ok(seenInstructions.every((prompt) => prompt === systemPrompt(role)), `${role} used the wrong personality`);
    store.close();
  }
});

test("Malik is configured as Head of Revenue", () => {
  const prompt = systemPrompt("malik");
  assert.match(prompt, /Head of Revenue/);
  assert.match(prompt, /department is Sales/);
  assert.doesNotMatch(prompt, /Chief Operating Officer/);
});

test("Clara has a distinct Executive Assistant identity", () => {
  const prompt = systemPrompt("clara");
  assert.match(prompt, /Executive Assistant/);
  assert.match(prompt, /Executive Operations/);
  assert.match(prompt, /Command88 Clara/);
  assert.match(prompt, /Never identify as, impersonate, or claim the identity or history of Viktor Clara/);
  assert.doesNotMatch(prompt, /You are Cyrus|You are Malik/);
});

test("every department bot has a distinct role and reports through Cyrus", () => {
  const roles = {
    mateo: ["Head of Marketing & Content", "Marketing"],
    kenji: ["Head of Product & Development", "Product & Development"],
    amara: ["Head of Client Success, Onboarding & Delivery", "Client Success"],
    nadia: ["Head of Finance & Administration", "Finance"],
    sloane: ["Head of Legal, Compliance & People", "Legal, Compliance & People"],
  };
  for (const [role, [title, department]] of Object.entries(roles)) {
    const prompt = systemPrompt(role);
    assert.match(prompt, new RegExp(title.replace(/[&]/g, "\\&")));
    assert.match(prompt, new RegExp(`department is ${department.replace(/[&]/g, "\\&")}`));
    assert.match(prompt, /report to Cyrus, Chief of Staff/);
    assert.doesNotMatch(prompt, /You are Cyrus|You are Malik|You are Command88 Clara/);
  }
});

test("department personalities enforce distinct operating instincts", () => {
  const contracts = {
    clara: [
      /air-traffic controller/i,
      /dropped balls/i,
      /owner and date/i,
      /Protect Blair/i,
      /report through Cyrus/i,
    ],
    mateo: [
      /commercially sharp creative/i,
      /vanity engagement/i,
      /audience, problem, promise, proof, channel/i,
      /campaign as a test/i,
      /idea is forgettable/i,
    ],
    kenji: [
      /smallest safe reversible change/i,
      /Reproduce before diagnosing/i,
      /rollback/i,
      /gold-plating/i,
      /root cause/i,
    ],
    amara: [
      /fierce client advocate/i,
      /time to value/i,
      /retention risks/i,
      /Never make the client coordinate Atlasium internally/i,
      /stabilize the client first/i,
    ],
    nadia: [
      /forensic, cash-protective/i,
      /invoice is not payment/i,
      /unexplained variance/i,
      /reconcile before reporting/i,
      /disciplined controller/i,
    ],
    sloane: [
      /commercially literate risk operator/i,
      /reflexive obstruction/i,
      /allowed with controls/i,
      /strict need-to-know/i,
      /safest viable route/i,
      /do not cosplay as outside counsel/i,
    ],
  };

  const prompts = [];
  for (const [role, required] of Object.entries(contracts)) {
    const prompt = systemPrompt(role);
    prompts.push(prompt);
    for (const marker of required) assert.match(prompt, marker, `${role} is missing ${marker}`);
    if (role !== "clara") {
      assert.match(prompt, /Your scoreboard is/i);
      assert.match(prompt, /DECISION BEHAVIOR/);
      assert.match(prompt, /Route cross-department work.*through Cyrus/i);
    }
    assert.match(prompt, /Never claim completion without evidence|Completion evidence must include/i);
    assert.match(prompt, /Ask Blair only when essential/i);
  }
  assert.equal(new Set(prompts).size, prompts.length);
});

test("all eight runtime profiles resolve the correct identity and expected Slack guard", () => {
  const profiles = {
    cyrus: ["Cyrus", "Chief of Staff", "Executive"],
    malik: ["Malik", "Head of Revenue", "Sales"],
    clara: ["Clara", "Executive Assistant", "Executive Operations"],
    mateo: ["Mateo", "Head of Marketing & Content", "Marketing"],
    kenji: ["Kenji", "Head of Product & Development", "Product & Development"],
    amara: ["Amara", "Head of Client Success, Onboarding & Delivery", "Client Success"],
    nadia: ["Nadia", "Head of Finance & Administration", "Finance"],
    sloane: ["Sloane", "Head of Legal, Compliance & People", "Legal, Compliance & People"],
  };
  for (const [role, [name, title, department]] of Object.entries(profiles)) {
    const loaded = loadConfig({
      BOT_ROLE: role,
      SLACK_APP_TOKEN: "xapp-test",
      SLACK_BOT_TOKEN: "xoxb-test",
      EXPECTED_SLACK_BOT_USER_ID: `U_${role.toUpperCase()}`,
      BLAIR_SLACK_USER_ID: "U_BLAIR",
      OPENAI_API_KEY: "test-key",
    });
    assert.equal(loaded.name, name);
    assert.equal(loaded.title, title);
    assert.equal(loaded.department, department);
    assert.equal(loaded.slackExpectedBotUserId, `U_${role.toUpperCase()}`);
    assert.match(loaded.databasePath, new RegExp(`${role}\\.sqlite$`));
    assert.equal(loaded.autonomyEnabled, false);
  }
});

test("revenue execution tools belong to Malik only", () => {
  for (const role of ["cyrus", "clara", "mateo", "kenji", "amara", "nadia", "sloane", "malik"]) {
    const { store } = tempStore();
    const toolbox = createToolbox({ store, config: config({ role, name: role }), slackApi: async () => ({ ok: false }) });
    const tools = new Set(toolbox.definitions.map((item) => item.name));
    assert.equal(tools.has("instantly_activate_campaign"), role === "malik");
    assert.equal(tools.has("reeviq_leads"), role === "malik");
    assert.equal(tools.has("upsert_operating_item"), role === "cyrus");
    store.close();
  }
});

test("model requests enforce the configured output-token ceiling", async () => {
  let requestBody;
  const model = createOpenAiModel({
    apiKey: "offline-test-key",
    model: "gpt-6-luna",
    maxOutputTokens: 600,
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ output: [] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  await model.respond({ instructions: "Test", input: "Test", tools: [] });
  assert.equal(requestBody.max_output_tokens, 600);
  assert.equal(requestBody.parallel_tool_calls, false);
});

test("deduplicates by Slack event id, not repeated request text", () => {
  const { store } = tempStore();
  const first = store.createTask({ sourceEventId: "Ev1", requesterId: "U_BLAIR", channelId: "D1", requestText: "Check health" });
  const retry = store.createTask({ sourceEventId: "Ev1", requesterId: "U_BLAIR", channelId: "D1", requestText: "Check health" });
  const newRequest = store.createTask({ sourceEventId: "Ev2", requesterId: "U_BLAIR", channelId: "D1", requestText: "Check health" });
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(newRequest.created, true);
  assert.notEqual(first.task.id, newRequest.task.id);
  store.close();
});

test("decision memory survives a restart", () => {
  const { dir, store } = tempStore();
  const db = path.join(dir, "cyrus.sqlite");
  store.rememberDecision({ topic: "Viktor", decision: "Keep Viktor until Cyrus passes parity", rationale: "Avoid disruption", sourceTaskId: null });
  store.close();
  const restarted = new CyrusStore(db);
  assert.equal(restarted.recallDecisions("Viktor")[0].decision, "Keep Viktor until Cyrus passes parity");
  restarted.close();
});

test("action uses a tool, records evidence, and verifies completion", async () => {
  const { store } = tempStore();
  const model = scriptedModel([
    call("system_health", {}),
    call("complete_task", { summary: "Health check passed." }, "call_2"),
    { output_text: "Health check passed. I verified the durable store.", output: [] },
  ]);
  const toolbox = createToolbox({ store, config: config(), slackApi: async () => ({ ok: true }), fetchImpl: fetch });
  const agent = new CyrusAgent({ store, model, toolbox });
  const current = task(store, "Ev-health", "Check and verify your health");
  const reply = await agent.handleTask(current);
  assert.match(reply, /verified/i);
  assert.equal(store.getTask(current.id).status, "completed");
  assert.equal(store.getEvidence(current.id).length, 1);
  store.close();
});

test("failed step is recorded and a safe alternative can complete the task", async () => {
  const { store } = tempStore();
  const model = scriptedModel([
    call("http_read", { url: "https://blocked.example.com/health" }),
    call("system_health", {}, "call_2"),
    call("complete_task", { summary: "Used the local health check after the remote check was unavailable." }, "call_3"),
    { output_text: "The remote check was unavailable. I used the local health check and verified the runtime is healthy.", output: [] },
  ]);
  const toolbox = createToolbox({ store, config: config(), slackApi: async () => ({ ok: true }), fetchImpl: fetch });
  const agent = new CyrusAgent({ store, model, toolbox });
  const current = task(store, "Ev-recover", "Check health even if the first method fails");
  const reply = await agent.handleTask(current);
  assert.match(reply, /local health check/i);
  const failed = store.db.prepare("SELECT count(*) AS count FROM task_steps WHERE task_id=? AND status='failed'").get(current.id);
  assert.equal(Number(failed.count), 1);
  assert.equal(store.getTask(current.id).status, "completed");
  store.close();
});

test("retryable tool failure is retried and verified before completion", async () => {
  const { store } = tempStore();
  let reads = 0;
  const model = scriptedModel([
    call("http_read", { url: "https://status.example.com/health" }),
    call("complete_task", { summary: "Recovered the status read and verified HTTP 200." }, "call_2"),
    { output_text: "The first status read failed. I retried it and verified HTTP 200.", output: [] },
  ]);
  const toolbox = createToolbox({
    store,
    config: config(),
    slackApi: async () => ({ ok: true }),
    fetchImpl: async () => {
      reads += 1;
      if (reads === 1) throw new Error("temporary network failure");
      return new Response("healthy", { status: 200 });
    },
  });
  const agent = new CyrusAgent({ store, model, toolbox });
  const current = task(store, "Ev-tool-retry", "Check the status page and recover from a temporary failure");
  const reply = await agent.handleTask(current);
  assert.match(reply, /retried/i);
  assert.equal(reads, 2);
  assert.equal(store.getTask(current.id).status, "completed");
  assert.equal(store.getEvidence(current.id).length, 1);
  const steps = store.db.prepare("SELECT status FROM task_steps WHERE task_id=? ORDER BY id").all(current.id);
  assert.deepEqual(steps.map((row) => row.status), ["failed", "recovered", "ok"]);
  store.close();
});

test("completion without evidence is rejected and becomes an honest blocker", async () => {
  const { store } = tempStore();
  const model = scriptedModel([
    call("complete_task", { summary: "Done" }),
    call("report_blocker", { blocker: "The required external system is not connected" }, "call_2"),
    { output_text: "Blocked. The required external system is not connected.", output: [] },
  ]);
  const toolbox = createToolbox({ store, config: config(), slackApi: async () => ({ ok: true }), fetchImpl: fetch });
  const agent = new CyrusAgent({ store, model, toolbox });
  const current = task(store, "Ev-blocked", "Update the external record");
  const reply = await agent.handleTask(current);
  assert.match(reply, /^Blocked\./);
  assert.equal(store.getTask(current.id).status, "blocked");
  assert.equal(store.getEvidence(current.id).length, 0);
  store.close();
});

test("interrupted running task is recovered after restart", () => {
  const { dir, store } = tempStore();
  const db = path.join(dir, "cyrus.sqlite");
  const current = task(store, "Ev-interrupted", "Inspect the system");
  store.setTaskStatus(current.id, "running");
  store.close();
  const restarted = new CyrusStore(db);
  assert.equal(restarted.recoverInterruptedTasks(), 1);
  assert.equal(restarted.getTask(current.id).status, "received");
  restarted.close();
});

test("reply outbox survives restart and marks a single Slack delivery", () => {
  const { dir, store } = tempStore();
  const db = path.join(dir, "cyrus.sqlite");
  const current = task(store, "Ev-outbox", "Check health");
  const replyId = store.queueReply(current.id, "D_BLAIR", "Verified healthy.");
  store.close();
  const restarted = new CyrusStore(db);
  assert.equal(restarted.pendingReplies().length, 1);
  restarted.markReplySent(replyId, "123.456");
  assert.equal(restarted.pendingReplies().length, 0);
  const sent = restarted.db.prepare("SELECT status, slack_ts FROM reply_outbox_messages WHERE id=?").get(replyId);
  assert.deepEqual({ ...sent }, { status: "sent", slack_ts: "123.456" });
  restarted.close();
});

test("restart recovery resumes a task and flushes its reply", async () => {
  const { store } = tempStore();
  const current = task(store, "Ev-resume", "Check the system");
  store.setTaskStatus(current.id, "running");
  store.recoverInterruptedTasks();
  const posts = [];
  const runtime = new SlackSocketRuntime({
    config: config(),
    store,
    agent: { handleTask: async (pending) => {
      store.addEvidence(pending.id, { source: "test", claim: "Recovered check passed", detail: {} });
      store.setTaskStatus(pending.id, "completed", { summary: "Recovered." });
      return "Recovered and verified.";
    } },
    slackApi: async (method, payload) => {
      posts.push({ method, payload });
      return { ok: true, ts: "999.001" };
    },
    WebSocketImpl: class {},
    logger: { info() {}, error() {} },
  });
  await runtime.recover();
  assert.equal(store.getTask(current.id).status, "completed");
  assert.equal(posts.length, 1);
  assert.notEqual(posts[0].payload.client_msg_id, current.id);
  assert.equal(typeof posts[0].payload.client_msg_id, "string");
  assert.equal(store.pendingReplies().length, 0);
  store.close();
});

test("missing reactions scope disables optional acknowledgements without blocking Slack task handling", async () => {
  const { store } = tempStore();
  const warnings = [];
  const posts = [];
  let reactionCalls = 0;
  let executions = 0;
  const runtime = new SlackSocketRuntime({
    config: config(),
    store,
    agent: { handleTask: async (current) => {
      executions += 1;
      store.setTaskStatus(current.id, "completed", { summary: "Handled." });
      return "Handled.";
    } },
    slackApi: async (method, payload) => {
      if (method.startsWith("reactions.")) {
        reactionCalls += 1;
        return { ok: false, error: "missing_scope", needed: "reactions:write", provided: "chat:write,im:history" };
      }
      if (method === "chat.postMessage") {
        posts.push(payload);
        return { ok: true, ts: `300.${posts.length}` };
      }
      return { ok: true };
    },
    WebSocketImpl: class {},
    logger: { info() {}, error() {}, warn(message, detail) { warnings.push({ message, detail }); } },
  });
  const event = { type: "message", channel_type: "im", channel: "D_BLAIR", ts: "300.0", user: "U_BLAIR", text: "Handle this" };

  assert.equal(await runtime.setMessageReaction(event, "eyes", true), false);
  assert.equal(await runtime.setMessageReaction(event, "eyes", false), false);
  assert.equal(reactionCalls, 1, "missing scope should suppress repeated reaction attempts");
  assert.equal(runtime.reactionPermission, "missing_scope");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].detail.requiredScope, "reactions:write");
  assert.match(warnings[0].detail.authorizationRequired, /existing Slack app.*re-authorize/i);

  assert.equal(await runtime.processSlackMessage(event), true);
  assert.equal(executions, 1);
  assert.equal(posts.length, 1, "the final reply should still be sent without a reaction acknowledgement");
  store.close();
});

test("socket and DM polling use one canonical Slack message identity", async () => {
  const { store } = tempStore();
  let executions = 0;
  const posts = [];
  const runtime = new SlackSocketRuntime({
    config: config(),
    store,
    agent: { handleTask: async () => { executions += 1; return "Handled once."; } },
    slackApi: async (method, payload) => {
      if (method === "conversations.open") return { ok: true, channel: { id: "D_BLAIR" } };
      if (method === "conversations.history") return { ok: true, messages: [{ ts: "100.1", user: "U_BLAIR", text: "Same request" }] };
      if (method === "chat.postMessage") { posts.push(payload); return { ok: true, ts: "100.2" }; }
      return { ok: true };
    },
    WebSocketImpl: class {},
    logger: { info() {}, error() {} },
  });
  const socket = { send() {} };
  await runtime.onEnvelope(socket, JSON.stringify({
    envelope_id: "env-1",
    type: "events_api",
    payload: { event_id: "Ev-socket", event: { type: "message", channel_type: "im", channel: "D_BLAIR", ts: "100.1", user: "U_BLAIR", text: "Same request" } },
  }));
  await runtime.pollDirectMessages();
  assert.equal(executions, 1);
  assert.equal(posts.length, 1);
  assert.equal(posts.filter((post) => post.client_msg_id).length, 1);
  assert.equal(store.getTaskBySourceEvent("slack-message:D_BLAIR:100.1").request_text, "Same request");
  store.close();
});

test("DM polling processes distinct unanswered messages and ignores answered history", async () => {
  const { store } = tempStore();
  const handled = [];
  const runtime = new SlackSocketRuntime({
    config: config(),
    store,
    agent: { handleTask: async (current) => { handled.push(current.request_text); return `Handled ${current.request_text}`; } },
    slackApi: async (method) => {
      if (method === "conversations.open") return { ok: true, channel: { id: "D_BLAIR" } };
      if (method === "conversations.history") return { ok: true, messages: [
        { ts: "203.0", user: "U_BLAIR", text: "Repeat" },
        { ts: "202.0", user: "U_BLAIR", text: "Repeat" },
        { ts: "201.0", bot_id: "B_BOT", text: "Earlier answer" },
        { ts: "200.0", user: "U_BLAIR", text: "Already answered" },
      ] };
      if (method === "chat.postMessage") return { ok: true, ts: "204.0" };
      return { ok: true };
    },
    WebSocketImpl: class {},
    logger: { info() {}, error() {} },
  });
  assert.equal(await runtime.pollDirectMessages(), 2);
  assert.deepEqual(handled, ["Repeat", "Repeat"]);
  assert.ok(store.getTaskBySourceEvent("slack-message:D_BLAIR:202.0"));
  assert.ok(store.getTaskBySourceEvent("slack-message:D_BLAIR:203.0"));
  assert.equal(store.getTaskBySourceEvent("slack-message:D_BLAIR:200.0"), undefined);
  store.close();
});

test("operational work items cannot complete without task evidence", () => {
  const { store } = tempStore();
  const current = task(store, "Ev-plan", "Break this objective into executable work");
  store.createWorkPlan(current.id, [{ id: "inspect", title: "Inspect runtime", owner: "malik" }]);
  assert.throws(() => store.updateWorkItem(current.id, "inspect", { status: "completed" }), /evidence_id/);
  const evidence = store.addEvidence(current.id, { source: "runtime", claim: "Runtime inspected", detail: { ok: true } });
  const item = store.updateWorkItem(current.id, "inspect", { status: "completed", evidenceId: evidence.id });
  assert.equal(item.status, "completed");
  assert.equal(store.openWorkItems(current.id).length, 0);
  store.close();
});

test("restart closes work items whose parent task is terminal", () => {
  const { dir, store } = tempStore();
  const db = path.join(dir, "cyrus.sqlite");
  const current = task(store, "Ev-terminal-plan", "Build and finish a plan");
  store.createWorkPlan(current.id, [{ id: "old-open-item", title: "Old step", owner: "malik" }]);
  store.setTaskStatus(current.id, "completed", { summary: "Task settled" });
  store.close();

  const restarted = new CyrusStore(db);
  restarted.recoverInterruptedTasks();
  assert.equal(restarted.getWorkItems(current.id)[0].status, "completed");
  assert.equal(restarted.health().openWorkItems, 0);
  restarted.close();
});

test("automatic follow-up survives restart and becomes due once", () => {
  const { dir, store } = tempStore();
  const db = path.join(dir, "cyrus.sqlite");
  const current = task(store, "Ev-follow", "Follow up automatically");
  store.setTaskStatus(current.id, "running");
  store.scheduleFollowup(current.id, { dueAt: new Date(Date.now() - 1_000).toISOString(), reason: "Verify the next step" });
  store.close();

  const restarted = new CyrusStore(db);
  assert.equal(restarted.recoverInterruptedTasks(), 0);
  assert.equal(restarted.getTask(current.id).status, "running");
  const due = restarted.claimDueFollowups();
  assert.equal(due.length, 1);
  assert.equal(restarted.claimDueFollowups().length, 0);
  restarted.completeFollowup(due[0].id);
  restarted.close();
});

test("an automatic follow-up cannot reschedule the same wait loop", async () => {
  const { store } = tempStore();
  const current = task(store, "Ev-follow-loop", "Reassess once and finish");
  const toolbox = createToolbox({ store, config: config(), slackApi: async () => ({ ok: true }), fetchImpl: fetch });
  const result = await toolbox.execute(
    "schedule_followup",
    { seconds: 20, reason: "Repeat the same check" },
    { taskId: current.id, requiresEvidence: true, isFollowup: true },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /do not schedule the same follow-up again/i);
  assert.equal(store.hasPendingFollowup(current.id), false);
  store.close();
});

test("restart recovery does not rerun a task that is waiting for its follow-up", async () => {
  const { store } = tempStore();
  const current = task(store, "Ev-follow-recover", "Wait and reassess");
  store.setTaskStatus(current.id, "running");
  store.scheduleFollowup(current.id, { dueAt: new Date(Date.now() + 60_000).toISOString(), reason: "Reassess later" });
  let executions = 0;
  const runtime = new SlackSocketRuntime({
    config: config(),
    store,
    agent: { handleTask: async () => { executions += 1; return "should not run"; } },
    slackApi: async () => ({ ok: true }),
    WebSocketImpl: class {},
    logger: { info() {}, error() {} },
  });
  await runtime.recover();
  assert.equal(executions, 0);
  assert.equal(store.getTask(current.id).status, "running");
  assert.equal(store.hasPendingFollowup(current.id), true);
  store.close();
});

test("connected agent handoff returns verifiable evidence", async () => {
  const { store } = tempStore();
  const cfg = config({ role: "malik", name: "Malik", agentPeers: { cyrus: "http://cyrus.internal:3001" } });
  const toolbox = createToolbox({
    store,
    config: cfg,
    slackApi: async () => ({ ok: true }),
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, status: "completed", evidenceCount: 1 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  const current = task(store, "Ev-handoff", "Escalate this objective to Cyrus");
  const result = await toolbox.execute("delegate_to_agent", { agent: "cyrus", objective: "Resolve priority" }, { taskId: current.id, requiresEvidence: true });
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "completed");
  assert.match(result.evidence.claim, /Verified handoff/);
  store.close();
});
