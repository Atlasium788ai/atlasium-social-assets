import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BOT_PROFILES, loadConfig, loadSharedRoleConfigs } from "../src/config.js";
import { createRelentlessController, relentlessPrompt } from "../src/relentless.js";
import { CyrusStore } from "../src/store.js";

function configFor(role, dataDir, extra = {}) {
  return loadConfig({
    BOT_ROLE: role,
    BOT_DATA_DIR: dataDir,
    SLACK_APP_TOKEN: "xapp-test",
    SLACK_BOT_TOKEN: "xoxb-test",
    BLAIR_SLACK_USER_ID: "U_BLAIR",
    OPENAI_API_KEY: "offline",
    CYRUS_AUTONOMY_ENABLED: "true",
    BOT_RELENTLESS_INTERVAL_MS: "3600000",
    ...extra,
  });
}

test("all eight executives have distinct relentless business directives and common safeguards", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command88-directives-"));
  const prompts = Object.keys(BOT_PROFILES).map((role) => relentlessPrompt(configFor(role, path.join(dir, role))));
  assert.equal(new Set(prompts).size, 8);
  for (const prompt of prompts) {
    assert.match(prompt, /next safe executable action/i);
    assert.match(prompt, /cross-functional|another executive/i);
    assert.match(prompt, /Completion requires evidence/i);
    assert.match(prompt, /consent, suppression, privacy, security, legal, spending/i);
  }
  assert.match(prompts[0], /represent Sloane/i);
  assert.match(prompts[1], /conversation, meeting, proposal, and cash/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a relentless pulse persists one internal task, skips busy work, and deduplicates its bucket", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command88-pulse-"));
  const config = configFor("mateo", dir);
  const store = new CyrusStore(config.databasePath);
  let calls = 0;
  const agent = {
    async handleTask(task) {
      calls += 1;
      const evidence = store.addEvidence(task.id, { source: "offline:test", claim: "Verified marketing pulse", detail: { ok: true } });
      store.setTaskStatus(task.id, "completed", { summary: `Evidence ${evidence.id}` });
      return "Verified.";
    },
  };
  const controller = createRelentlessController({
    runtime: { config, store, agent },
    logger: { info() {}, error() {} },
    now: () => Date.parse("2026-10-13T12:00:00.000Z"),
  });
  const first = await controller.run();
  const second = await controller.run();
  assert.equal(first.status, "completed");
  assert.equal(first.evidenceCount, 1);
  assert.equal(second.reason, "deduplicated");
  assert.equal(calls, 1);
  const persisted = store.getTask(first.taskId);
  assert.equal(persisted.requester_id, "system:relentless");
  assert.equal(persisted.channel_id, "internal:relentless:mateo");
  assert.match(persisted.source_event_id, /^relentless:mateo:v1:/);

  store.createTask({ sourceEventId: "manual", requesterId: "U_BLAIR", channelId: "D_BLAIR", requestText: "Work this first" });
  const busy = await createRelentlessController({ runtime: { config, store, agent }, logger: { info() {}, error() {} }, now: () => Date.parse("2026-10-13T14:00:00.000Z") }).run();
  assert.equal(busy.reason, "open_tasks");
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a relentless pulse does not collide with an executive already handling work", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command88-pulse-busy-agent-"));
  const config = configFor("kenji", dir);
  const store = new CyrusStore(config.databasePath);
  const controller = createRelentlessController({
    runtime: { config, store, agent: { isBusy: () => true } },
    logger: { info() {}, error() {} },
  });
  const result = await controller.run();
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "agent_busy");
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM tasks").get().count, 0);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("an external blocker permits one independent alternative then backs off across restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command88-pulse-backoff-"));
  const config = configFor("malik", dir, { RELENTLESS_BLOCKED_BACKOFF_MS: "21600000" });
  const store = new CyrusStore(config.databasePath);
  const previous = store.createTask({
    sourceEventId: "relentless:malik:v1:previous",
    requesterId: "system:relentless",
    channelId: "internal:relentless:malik",
    requestText: "Find the next legitimate revenue move",
  }).task;
  store.setTaskStatus(previous.id, "blocked", { blocker: "Original ReeVIQ CRM access is not authorized" });
  let calls = 0;
  const agent = { isBusy: () => false, handleTask: async (task) => {
    calls += 1;
    assert.match(task.request_text, /ALTERNATIVE WORK/);
    assert.match(task.request_text, /Original ReeVIQ CRM access is not authorized/);
    const draft = store.saveWorkProduct({ id: "buyer-followup", title: "Buyer follow-up draft", content: "Draft for an existing qualified buyer. Verify their name and context before use.", sourceTaskId: task.id });
    store.addEvidence(task.id, { source: "malik_drafts", claim: "Internal draft saved", detail: { id: draft.id } });
    store.setTaskStatus(task.id, "completed", { summary: "Saved an internal draft only" });
    return "Internal draft saved, not sent.";
  } };
  const result = await createRelentlessController({
    runtime: { config, store, agent },
    logger: { info() {}, error() {} },
  }).run();
  assert.equal(result.status, "completed");
  assert.equal(store.getTask(previous.id).status, "blocked");
  const second = await createRelentlessController({ runtime: { config, store, agent }, logger: { info() {}, error() {} } }).run();
  assert.equal(second.reason, "blocked_backoff");
  assert.match(second.retryAt, /T/);
  assert.equal(calls, 1);
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM tasks").get().count, 2);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("shared roles inherit autonomy without sharing databases or Slack identities", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command88-shared-autonomy-"));
  const primary = configFor("cyrus", dir);
  const configs = loadSharedRoleConfigs({
    SHARED_BOT_ROLES: "clara,mateo,kenji,amara,nadia,sloane",
    SHARED_BOT_DATA_DIR: path.join(dir, "executives"),
    SHARED_SWARM_AUTONOMY_ENABLED: "true",
    SHARED_SWARM_RELENTLESS_INTERVAL_MS: "7200000",
    CLARA_SLACK_APP_TOKEN: "xapp-clara",
    CLARA_SLACK_BOT_TOKEN: "xoxb-clara",
  }, primary);
  assert.ok(configs.every((item) => item.autonomyEnabled));
  assert.ok(configs.every((item) => item.relentlessIntervalMs === 7200000));
  assert.equal(new Set(configs.map((item) => item.databasePath)).size, 6);
  assert.equal(configs.find((item) => item.role === "clara").slackSocketEnabled, true);
  assert.equal(configs.find((item) => item.role === "sloane").slackSocketEnabled, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

