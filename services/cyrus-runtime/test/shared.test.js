import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CyrusAgent } from "../src/agent.js";
import { BOT_PROFILES, loadConfig, loadSharedRoleConfigs, SHARED_EXECUTIVE_ROLES } from "../src/config.js";
import { createLocalAgentDispatcher, createSharedSwarmRuntime } from "../src/shared.js";
import { CyrusStore } from "../src/store.js";
import { createToolbox } from "../src/tools.js";

function environment(dataDir, extra = {}) {
  return {
    BOT_ROLE: "cyrus",
    BOT_DATA_DIR: dataDir,
    SLACK_APP_TOKEN: "xapp-cyrus-test",
    SLACK_BOT_TOKEN: "xoxb-cyrus-test",
    BLAIR_SLACK_USER_ID: "U_BLAIR",
    OPENAI_API_KEY: "offline-test-key",
    ...extra,
  };
}

function toolCall(name, args, callId) {
  return { type: "function_call", name, arguments: JSON.stringify(args), call_id: callId };
}

function offlineExecutionModel() {
  let calls = 0;
  return {
    get calls() { return calls; },
    async respond({ instructions, input }) {
      calls += 1;
      const name = /You are (?:Command88 )?([^,]+)/.exec(instructions)?.[1] || "Executive";
      const outputs = input.filter((item) => item.type === "function_call_output").length;
      if (outputs === 0) return { output: [toolCall("system_health", {}, `${name}-health-${calls}`)] };
      if (outputs === 1) return { output: [toolCall("complete_task", { summary: `${name} verified the assigned runtime objective.` }, `${name}-done-${calls}`)] };
      return { output_text: `${name}: verified and complete.`, output: [] };
    },
  };
}

function task(store, id, text) {
  return store.createTask({ sourceEventId: id, requesterId: "U_BLAIR", channelId: "D_BLAIR", requestText: text }).task;
}

test("all eight executives independently execute a tool-backed offline task", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command88-eight-executives-"));
  for (const [role, profile] of Object.entries(BOT_PROFILES)) {
    const env = environment(path.join(dir, role), { BOT_ROLE: role });
    const config = loadConfig(env);
    const store = new CyrusStore(config.databasePath);
    const toolbox = createToolbox({ store, config, slackApi: async () => ({ ok: false, error: "offline" }) });
    const agent = new CyrusAgent({ store, model: offlineExecutionModel(), toolbox, config, maxTurns: 5 });
    const current = task(store, `offline-execution:${role}`, `Identify as ${profile.name}, verify your durable runtime health with a tool, and complete only with evidence.`);
    const reply = await agent.handleTask(current);
    assert.equal(store.getTask(current.id).status, "completed", `${profile.name} did not complete`);
    assert.equal(store.getEvidence(current.id)[0].source, `${role}_runtime`);
    assert.match(reply, new RegExp(`\\b${profile.name}\\b`, "i"));
    store.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("six executives share Cyrus infrastructure while keeping isolated identities and databases", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command88-shared-config-"));
  const env = environment(dir, {
    SHARED_BOT_ROLES: SHARED_EXECUTIVE_ROLES.join(","),
    CLARA_SLACK_APP_TOKEN: "xapp-clara-test",
    CLARA_SLACK_BOT_TOKEN: "xoxb-clara-test",
    CLARA_EXPECTED_SLACK_BOT_USER_ID: "U_CLARA",
  });
  const configs = loadSharedRoleConfigs(env, loadConfig(env));
  assert.deepEqual(configs.map((item) => item.role), SHARED_EXECUTIVE_ROLES);
  assert.equal(new Set(configs.map((item) => item.databasePath)).size, 6);
  assert.ok(configs.every((item) => item.databasePath.startsWith(path.join(dir, "executives"))));
  assert.equal(configs.find((item) => item.role === "clara").slackSocketEnabled, true);
  assert.equal(configs.find((item) => item.role === "clara").slackExpectedBotUserId, "U_CLARA");
  assert.equal(configs.find((item) => item.role === "sloane").slackSocketEnabled, false);
  assert.equal(configs.find((item) => item.role === "sloane").name, "Sloane");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Cyrus and shared executives exchange verified idempotent handoffs only through Cyrus", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command88-shared-routing-"));
  const env = environment(dir, { SHARED_BOT_ROLES: "clara,mateo" });
  const primaryConfig = loadConfig(env);
  const model = offlineExecutionModel();
  const dispatcher = createLocalAgentDispatcher();
  const cyrusStore = new CyrusStore(primaryConfig.databasePath);
  const cyrusToolbox = createToolbox({
    store: cyrusStore,
    config: primaryConfig,
    slackApi: async () => ({ ok: false, error: "offline" }),
    agentDispatcher: dispatcher,
  });
  const cyrusAgent = new CyrusAgent({ store: cyrusStore, model, toolbox: cyrusToolbox, config: primaryConfig });
  dispatcher.register("cyrus", { config: primaryConfig, store: cyrusStore, toolbox: cyrusToolbox, agent: cyrusAgent });
  const shared = createSharedSwarmRuntime({
    configs: loadSharedRoleConfigs(env, primaryConfig),
    model,
    dispatcher,
    WebSocketImpl: class {},
    logger: { info() {}, warn() {}, error() {} },
  });

  const cyrusTask = task(cyrusStore, "cyrus-to-mateo", "Delegate a verified marketing runtime check to Mateo");
  const context = { taskId: cyrusTask.id, requiresEvidence: true };
  const first = await cyrusToolbox.execute("delegate_to_agent", { agent: "mateo", objective: "Verify your runtime health" }, context);
  const callsAfterFirst = model.calls;
  const repeated = await cyrusToolbox.execute("delegate_to_agent", { agent: "mateo", objective: "Verify your runtime health" }, context);
  assert.equal(first.ok, true);
  assert.equal(first.data.status, "completed");
  assert.equal(first.evidence.detail.transport, "local");
  assert.equal(repeated.data.taskId, first.data.taskId);
  assert.equal(model.calls, callsAfterFirst, "idempotent handoff executed the target twice");

  const mateo = shared.roles.find((item) => item.config.role === "mateo");
  assert.equal(mateo.store.getEvidence(first.data.taskId)[0].source, "mateo_runtime");
  assert.equal(mateo.store.db.prepare("SELECT count(*) AS count FROM tasks").get().count, 1);

  const mateoTask = task(mateo.store, "mateo-to-cyrus", "Escalate a company priority conflict to Cyrus");
  const escalation = await mateo.toolbox.execute(
    "delegate_to_agent",
    { agent: "cyrus", objective: "Resolve the company priority conflict" },
    { taskId: mateoTask.id, requiresEvidence: true },
  );
  assert.equal(escalation.ok, true);
  assert.equal(escalation.data.status, "completed");
  assert.equal(escalation.evidence.source, "handoff:cyrus");

  const blocked = await mateo.toolbox.execute(
    "delegate_to_agent",
    { agent: "clara", objective: "Bypass Cyrus and coordinate directly" },
    { taskId: mateoTask.id, requiresEvidence: true },
  );
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /must route through Cyrus/);

  shared.stop();
  cyrusStore.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("all six shared executives independently execute a verified Cyrus assignment", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command88-all-roles-"));
  const env = environment(dir, { SHARED_BOT_ROLES: SHARED_EXECUTIVE_ROLES.join(",") });
  const primaryConfig = loadConfig(env);
  const model = offlineExecutionModel();
  const dispatcher = createLocalAgentDispatcher();
  const cyrusStore = new CyrusStore(primaryConfig.databasePath);
  const cyrusToolbox = createToolbox({
    store: cyrusStore,
    config: primaryConfig,
    slackApi: async () => ({ ok: false, error: "offline" }),
    agentDispatcher: dispatcher,
  });
  const cyrusAgent = new CyrusAgent({ store: cyrusStore, model, toolbox: cyrusToolbox, config: primaryConfig });
  dispatcher.register("cyrus", { config: primaryConfig, store: cyrusStore, toolbox: cyrusToolbox, agent: cyrusAgent });
  const shared = createSharedSwarmRuntime({
    configs: loadSharedRoleConfigs(env, primaryConfig),
    model,
    dispatcher,
    WebSocketImpl: class {},
    logger: { info() {}, warn() {}, error() {} },
  });

  for (const role of SHARED_EXECUTIVE_ROLES) {
    const source = task(cyrusStore, `cyrus-to-${role}`, `Assign ${role} an isolated runtime verification`);
    const result = await cyrusToolbox.execute(
      "delegate_to_agent",
      { agent: role, objective: `Verify the ${role} runtime and return evidence` },
      { taskId: source.id, requiresEvidence: true },
    );
    assert.equal(result.ok, true, `${role} handoff failed: ${result.error || "unknown"}`);
    assert.equal(result.data.status, "completed");
    assert.equal(result.evidence.source, `handoff:${role}`);
    const runtime = shared.roles.find((item) => item.config.role === role);
    assert.equal(runtime.store.getEvidence(result.data.taskId)[0].source, `${role}_runtime`);
  }

  assert.deepEqual(dispatcher.roles().sort(), ["cyrus", ...SHARED_EXECUTIVE_ROLES].sort());
  shared.stop();
  cyrusStore.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("shared role memory remains separate and survives a restart", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command88-shared-memory-"));
  const env = environment(dir, { SHARED_BOT_ROLES: "clara,mateo" });
  const primary = loadConfig(env);
  const configs = loadSharedRoleConfigs(env, primary);
  const claraPath = configs.find((item) => item.role === "clara").databasePath;
  const mateoPath = configs.find((item) => item.role === "mateo").databasePath;
  const clara = new CyrusStore(claraPath);
  const mateo = new CyrusStore(mateoPath);
  const source = task(clara, "clara-memory", "Remember the approved executive briefing format");
  clara.rememberDecision({
    topic: "executive briefing format",
    decision: "Use one-page exception briefings",
    rationale: "Blair approved concise escalation",
    sourceTaskId: source.id,
  });
  clara.close();
  mateo.close();

  const restartedClara = new CyrusStore(claraPath);
  const restartedMateo = new CyrusStore(mateoPath);
  assert.equal(restartedClara.recallDecisions("briefing").length, 1);
  assert.equal(restartedMateo.recallDecisions("briefing").length, 0);
  restartedClara.close();
  restartedMateo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("internal-only shared executives start without network calls or Slack apps", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command88-shared-start-"));
  const env = environment(dir, { SHARED_BOT_ROLES: SHARED_EXECUTIVE_ROLES.join(",") });
  const primary = loadConfig(env);
  const dispatcher = createLocalAgentDispatcher();
  const primaryStore = new CyrusStore(primary.databasePath);
  dispatcher.register("cyrus", { config: primary, store: primaryStore, agent: { handleTask: async () => "unused" } });
  let networkCalls = 0;
  const shared = createSharedSwarmRuntime({
    configs: loadSharedRoleConfigs(env, primary),
    model: offlineExecutionModel(),
    dispatcher,
    fetchImpl: async () => { networkCalls += 1; throw new Error("network not allowed in offline test"); },
    WebSocketImpl: class {},
    logger: { info() {}, warn() {}, error() {} },
  });
  await shared.start();
  const health = shared.health();
  assert.equal(networkCalls, 0);
  assert.equal(Object.keys(health).length, 6);
  assert.ok(Object.values(health).every((item) => item.mode === "cyrus-mediated"));
  assert.ok(Object.values(health).every((item) => item.schemaVersion === 3));
  shared.stop();
  primaryStore.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a wrong shared Slack identity is isolated without disabling the executive", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command88-shared-identity-"));
  const env = environment(dir, {
    SHARED_BOT_ROLES: "clara",
    CLARA_SLACK_APP_TOKEN: "xapp-clara-test",
    CLARA_SLACK_BOT_TOKEN: "xoxb-clara-test",
    CLARA_EXPECTED_SLACK_BOT_USER_ID: "U_CLARA_EXPECTED",
  });
  const primary = loadConfig(env);
  const dispatcher = createLocalAgentDispatcher();
  const primaryStore = new CyrusStore(primary.databasePath);
  dispatcher.register("cyrus", { config: primary, store: primaryStore, agent: { handleTask: async () => "unused" } });
  const shared = createSharedSwarmRuntime({
    configs: loadSharedRoleConfigs(env, primary),
    model: offlineExecutionModel(),
    dispatcher,
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, user_id: "U_WRONG_BOT" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    WebSocketImpl: class {},
    logger: { info() {}, warn() {}, error() {} },
  });
  await shared.start();
  const clara = shared.health().clara;
  assert.equal(clara.slackAuthenticated, false);
  assert.match(clara.slackError, /identity mismatch/i);
  assert.equal(dispatcher.has("clara"), true, "Clara should remain available through Cyrus");
  shared.stop();
  primaryStore.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
