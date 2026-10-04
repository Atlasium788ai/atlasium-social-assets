import http from "node:http";
import { loadConfig } from "./config.js";
import { CyrusStore } from "./store.js";
import { createSlackApi, SlackSocketRuntime } from "./slack.js";
import { createOpenAiModel } from "./model.js";
import { createToolbox } from "./tools.js";
import { CyrusAgent } from "./agent.js";
import { createInternalServer } from "./internal.js";

const config = loadConfig();
const store = new CyrusStore(config.databasePath);
const recovered = store.recoverInterruptedTasks();
const slackApi = createSlackApi(config.slackBotToken);
const slackAuth = await slackApi("auth.test");
if (!slackAuth.ok) throw new Error(`Cyrus Slack authentication failed: ${slackAuth.error || "unknown error"}`);
const model = createOpenAiModel({ apiKey: config.openAiApiKey, model: config.openAiModel, baseUrl: config.openAiBaseUrl });
const toolbox = createToolbox({ store, config, slackApi });
const agent = new CyrusAgent({ store, model, toolbox, config });
const socket = new SlackSocketRuntime({ config, store, agent, slackApi: async (method, payload) => {
  const token = method === "apps.connections.open" ? config.slackAppToken : config.slackBotToken;
  return createSlackApi(token)(method, payload);
} });

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    const slackConnected = config.slackSocketEnabled ? socket.connected : false;
    const healthy = Boolean(slackAuth.ok);
    response.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify({
      ok: healthy,
      service: config.serviceName,
      role: config.role,
      recovered,
      slackAuthenticated: Boolean(slackAuth.ok),
      slackSocketEnabled: config.slackSocketEnabled,
      slackConnected,
      slackDmLastPollAt: socket.lastPollAt,
      slackDmLastPollError: socket.lastPollError,
      ...store.health(),
    }));
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: false, error: "not_found" }));
});

const internalServer = createInternalServer({ config, store, agent });
server.listen(config.port, "0.0.0.0", () => console.info(`${config.name} health server listening on ${config.port}`));
internalServer.listen(config.internalPort, "0.0.0.0", () => console.info(`${config.name} internal handoff server listening on ${config.internalPort}`));
await socket.recover().catch((error) => console.error("Cyrus recovery deferred", { message: error.message }));
const outboxTimer = setInterval(() => {
  socket.flushOutbox().catch((error) => console.error(`${config.name} reply retry failed`, { message: error.message }));
}, 15_000);
outboxTimer.unref();
const followupTimer = setInterval(() => {
  socket.processDueFollowups().catch((error) => console.error(`${config.name} automatic follow-up failed`, { message: error.message }));
}, config.followupPollMs);
followupTimer.unref();
const slackDmPollTimer = setInterval(() => {
  socket.pollDirectMessages().catch((error) => console.error(`${config.name} Slack DM recovery failed`, { message: error.message }));
}, config.slackDmPollMs);
slackDmPollTimer.unref();
socket.pollDirectMessages().catch((error) => console.error(`${config.name} initial Slack DM recovery failed`, { message: error.message }));

const autonomyIntervalMs = Math.max(60_000, Number(process.env.CYRUS_AUTONOMY_INTERVAL_MS || 300_000));
let autonomyBusy = false;
async function runAutonomyTick() {
  if (config.role !== "cyrus" || autonomyBusy) return;
  const health = store.health();
  if (health.openTasks > 0) {
    console.info(JSON.stringify({ event: "autonomy_tick_skipped", reason: "open_tasks", openTasks: health.openTasks }));
    return;
  }
  autonomyBusy = true;
  const bucket = Math.floor(Date.now() / autonomyIntervalMs);
  const sourceEventId = `autonomy:${bucket}`;
  try {
    const existing = store.getTaskBySourceEvent(sourceEventId);
    if (existing) return;
    const { task } = store.createTask({
      sourceEventId,
      requesterId: "system:command88",
      channelId: "internal:autonomy",
      requestText: "Advance Atlasium revenue now. Choose the highest-value safe next action that can be verified with current tools. For revenue work, delegate a concrete objective to Malik and require evidence. Do not contact prospects, customers, or staff, launch campaigns, spend money, change pricing, sign contracts, delete data, or deploy production. If outbound is not explicitly safe and verified, work through the last safe pre-send step and record the exact blocker. Finish with evidence or a precise blocker, then identify the next action.",
    });
    console.info(JSON.stringify({ event: "autonomy_tick_start", taskId: task.id, intervalMs: autonomyIntervalMs }));
    const reply = await agent.handleTask(task);
    const settled = store.getTask(task.id);
    const evidenceCount = store.getEvidence(task.id).length;
    console.info(JSON.stringify({ event: "autonomy_tick_result", taskId: task.id, status: settled.status, evidenceCount, reply: String(reply || "").slice(0, 500) }));
  } catch (error) {
    console.error("Cyrus autonomy tick failed", { message: error.message });
  } finally {
    autonomyBusy = false;
  }
}
const autonomyTimer = setInterval(() => void runAutonomyTick(), autonomyIntervalMs);
autonomyTimer.unref();
setTimeout(() => void runAutonomyTick(), 20_000).unref();

if (config.slackSocketEnabled) socket.start();

let relentlessRunning = false;
async function relentlessTick() {
  if (config.role !== "cyrus" || !config.proactiveEnabled || relentlessRunning) return;
  relentlessRunning = true;
  const bucket = Math.floor(Date.now() / config.relentlessIntervalMs);
  const sourceEventId = `relentless:${bucket}`;
  try {
    const { task, created } = store.createTask({
      sourceEventId,
      requesterId: "system:relentless",
      channelId: "internal:relentless",
      requestText: [
        "RELENTLESS REVENUE ENGINE TICK.",
        "Money first. Do not wait for Blair.",
        "Delegate the live revenue inspection and next safe executable revenue action to Malik now.",
        "Malik must inspect live ReeVIQ lead inventory and the configured Instantly campaign/reply state before deciding.",
        "Run Instantly preflight. If the configured campaign is active or running subsequences, pause it and verify it is non-sending, then rerun preflight.",
        "If the inactive campaign contains Cody-specific routing, repair and verify that routing first, then rerun preflight.",
        "Read the configured Instantly campaign lead inventory before staging. Never exceed the pilot cap and never stage a duplicate.",
        "If preflight is safe and the pilot cap has room, select one NEW ReeVIQ lead, re-read it with ID plus expected-email or expected-name identity cross-check, and stage that one lead into Instantly with duplicate protection and verification-on-import.",
        "Do not activate, resume, send, or launch outbound email from this tick. Repair plus staging into an inactive campaign are the last safe pre-send steps.",
        "Do not use or recommend a Cody-specific booking route.",
        "Require evidence. If a route is blocked, identify the exact blocker and the next safe action."
      ].join(" "),
    });
    if (!created) return;
    console.info(JSON.stringify({ event: "relentless_engine_tick_start", taskId: task.id, sourceEventId, intervalMs: config.relentlessIntervalMs }));
    const reply = await agent.handleTask(task);
    const settled = store.getTask(task.id);
    const evidenceCount = store.getEvidence(task.id).length;
    console.info(JSON.stringify({ event: "relentless_engine_tick", taskId: task.id, sourceEventId, status: settled.status, evidenceCount, reply: String(reply || "").slice(0, 500) }));
  } catch (error) {
    console.error(JSON.stringify({ event: "relentless_engine_tick_failed", sourceEventId, error: error.message }));
  } finally {
    relentlessRunning = false;
  }
}
const relentlessTimer = config.role === "cyrus" && config.proactiveEnabled
  ? setInterval(() => relentlessTick(), config.relentlessIntervalMs)
  : null;
relentlessTimer?.unref();
if (relentlessTimer) {
  console.info(JSON.stringify({ event: "relentless_engine_started", intervalMs: config.relentlessIntervalMs }));
  relentlessTick();
}

function shutdown(signal) {
  console.info(`${config.name} stopping on ${signal}`);
  clearInterval(outboxTimer);
  clearInterval(followupTimer);
  clearInterval(slackDmPollTimer);
  if (relentlessTimer) clearInterval(relentlessTimer);
  clearInterval(autonomyTimer);
  socket.stop();
  let closed = 0;
  const onClose = () => { if (++closed === 2) { store.close(); process.exit(0); } };
  server.close(onClose);
  internalServer.close(onClose);
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
