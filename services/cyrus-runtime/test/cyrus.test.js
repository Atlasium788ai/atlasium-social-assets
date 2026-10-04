import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CyrusStore } from "../src/store.js";
import { createToolbox } from "../src/tools.js";
import { CyrusAgent } from "../src/agent.js";
import { shouldHandleMessage, SlackSocketRuntime } from "../src/slack.js";

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
