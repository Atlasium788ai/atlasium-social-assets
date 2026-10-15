import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CyrusStore } from "../src/store.js";
import { receiveHandoff } from "../src/handoff.js";
import { SlackSocketRuntime } from "../src/slack.js";
import { createToolbox } from "../src/tools.js";

test("busy handoffs survive restart, preserve distinct objectives and execute once without Slack posts", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command88-handoff-queue-"));
  const db = path.join(dir, "cyrus.sqlite");
  let store = new CyrusStore(db);
  let busy = true;
  const runs = [];
  let slackCalls = 0;
  const config = { role: "cyrus", name: "Cyrus", agentPeers: {} };
  const agent = { isBusy: () => busy, handleTask: async (task) => {
    runs.push(task.id);
    store.setTaskStatus(task.id, "running");
    store.addEvidence(task.id, { source: "test", claim: "Verified", detail: {} });
    store.setTaskStatus(task.id, "completed", { summary: "Verified" });
    return "Verified";
  } };
  const receive = (id) => receiveHandoff({ config, store, agent, from: "nadia", id, message: `Verify ${id}` });
  try {
    const first = await receive("one");
    const second = await receive("two");
    assert.equal(first.queued, true);
    assert.equal(second.queued, true);
    assert.equal(store.getTask(first.taskId).status, "received");
    assert.equal((await receive("one")).taskId, first.taskId);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM followups").get().n, 2);
    store.close();
    store = new CyrusStore(db);
    store.recoverInterruptedTasks();
    store.db.prepare("UPDATE followups SET due_at='2000-01-01T00:00:00.000Z'").run();
    const socket = new SlackSocketRuntime({ config, store, agent, slackApi: async () => { slackCalls++; return { ok: true }; }, WebSocketImpl: class {} });
    await socket.processDueFollowups();
    assert.equal(runs.length, 0, "busy executive must leave queued work unclaimed");
    busy = false;
    await socket.processDueFollowups();
    await socket.processDueFollowups();
    assert.deepEqual(runs.sort(), [first.taskId, second.taskId].sort());
    const settled = await receive("one");
    assert.equal(settled.status, "completed");
    assert.equal(settled.evidenceCount, 1);
    assert.equal(settled.queued, false);
    assert.equal(slackCalls, 0);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("busy conversations stay read-only and are not promoted into background actions", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command88-handoff-chat-"));
  const store = new CyrusStore(path.join(dir, "cyrus.sqlite"));
  try {
    const result = await receiveHandoff({ config: { name: "Cyrus" }, store, agent: { isBusy: () => true }, from: "nadia", id: "chat", message: "Discuss my take", mode: "conversation" });
    assert.equal(result.ok, false);
    assert.equal(result.retryable, true);
    assert.equal(store.health().openTasks, 0);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const transport of ["local", "private"]) {
  test(`${transport} queued acceptance produces no completion evidence`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command88-handoff-evidence-"));
    const store = new CyrusStore(path.join(dir, "source.sqlite"));
    try {
      const source = store.createTask({ sourceEventId: "source", requesterId: "U_BLAIR", channelId: "D_BLAIR", requestText: "Delegate verification" }).task;
      const body = { ok: true, taskId: "target", status: "received", queued: true, evidenceCount: 0 };
      const toolbox = createToolbox({ store, config: { role: "nadia", agentPeers: { cyrus: "http://cyrus.internal:3001" } }, slackApi: async () => ({ ok: true }),
        agentDispatcher: transport === "local" ? { has: () => true, dispatch: async () => body } : null,
        fetchImpl: async () => ({ ok: true, json: async () => body }),
      });
      const result = await toolbox.execute("delegate_to_agent", { agent: "cyrus", objective: "Verify health", mode: "task" }, { taskId: source.id, requiresEvidence: true });
      assert.equal(result.ok, true);
      assert.equal(result.data.queued, true);
      assert.equal(result.evidence, undefined);
      assert.match(result.data.nextAction, /not completed/);
    } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
