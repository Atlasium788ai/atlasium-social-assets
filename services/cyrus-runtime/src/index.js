import http from "node:http";
import { loadConfig } from "./config.js";
import { CyrusStore } from "./store.js";
import { createSlackApi, SlackSocketRuntime, assertSlackBotIdentity } from "./slack.js";
import { createOpenAiModel } from "./model.js";
import { createToolbox } from "./tools.js";
import { CyrusAgent } from "./agent.js";
import { createInternalServer } from "./internal.js";

const config = loadConfig();
const store = new CyrusStore(config.databasePath);
const recovered = store.recoverInterruptedTasks();
const slackApi = createSlackApi(config.slackBotToken);
const slackAuth = await slackApi("auth.test");
if (!slackAuth.ok) throw new Error(`${config.name} Slack authentication failed: ${slackAuth.error || "unknown error"}`);
assertSlackBotIdentity(slackAuth, config);
const model = createOpenAiModel({ apiKey: config.openAiApiKey, model: config.openAiModel, baseUrl: config.openAiBaseUrl });
const toolbox = createToolbox({ store, config, slackApi });
const agent = new CyrusAgent({ store, model, toolbox, config, maxTurns: config.role === "malik" ? 16 : 10 });

if (config.role === "malik" && process.env.COMMAND88_PREPARE_PILOT_ON_START === "true") {
  try {
    const result = await toolbox.execute("instantly_create_fresh_pilot", {}, { taskId: "system:pilot-bootstrap" });
    console.info(JSON.stringify({
      event: "command88_pilot_bootstrap",
      ok: Boolean(result.ok),
      campaignId: result.data?.id || null,
      campaignName: result.data?.name || null,
      status: result.data?.status ?? null,
      reused: result.data?.reused ?? null,
      evidenceClaim: result.evidence?.claim || null,
      error: result.ok ? null : result.error || null,
    }));
  } catch (error) {
    console.error(JSON.stringify({ event: "command88_pilot_bootstrap", ok: false, error: error.message }));
  }
}

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
      title: config.title,
      department: config.department,
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
const slackDmPollTimer = config.slackSocketEnabled ? setInterval(() => {
  socket.pollDirectMessages().catch((error) => console.error(`${config.name} Slack DM recovery failed`, { message: error.message }));
}, config.slackDmPollMs) : null;
slackDmPollTimer?.unref();
if (config.slackSocketEnabled) {
  socket.pollDirectMessages().catch((error) => console.error(`${config.name} initial Slack DM recovery failed`, { message: error.message }));
}

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
      requestText: "Advance Atlasium revenue now. The priority is verified conversations, meetings booked, proposals advanced, and collected revenue. Delegate concrete revenue execution to Malik and require evidence. Routine Q4 prospecting, follow-up, meeting booking, and standard outbound inside approved offers/economics are authorized after technical/contactability/opt-out preflight. Do not create new paid spend, change pricing below approved floors, sign contracts, delete data, or deploy production. If one route is blocked, research or use another authorized route rather than returning routine problems to Blair. Finish with evidence of movement or the precise blocker and next recovery action.",
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
        "North star: BOOK MEETINGS and PUT COLLECTED REVENUE IN THE BANK.",
        "Do not wait for Blair on routine Q4 execution. Delegate live revenue execution to Malik and require evidence.",
        "Priority order: live reply/buyer -> meeting -> proposal/deal -> payment -> verified outbound -> pipeline building.",
        "First inspect live Instantly campaign state and received replies plus live ReeVIQ inventory. If a real reply exists, work that conversion path before adding more cold prospects.",
        "Routine Q4 prospecting, follow-up, meeting booking, and standard outbound are authorized once contactability, suppression/opt-out, campaign copy, sender health, and campaign-state checks pass.",
        "If the configured Command88 campaign is at or above the 5-lead pilot cap, call instantly_create_fresh_pilot. It must return a genuinely distinct inactive pilot below cap; use the returned campaign ID for all subsequent preflight, inventory, staging, and activation calls.",
        "Run instantly_preflight on the exact target campaign ID. Do not proceed if stale Cody routing, retired branding, missing sequence, missing sender, risky-contact settings, or another preflight issue is present.",
        "Build a small pilot deliberately. If target inventory is below 5, take a short set of NEW ReeVIQ decision-makers with emailVerified=true and run instantly_workspace_presence first. Choose a genuinely fresh email that is absent from the Instantly workspace, re-read that ReeVIQ record by ID plus expected email, then stage exactly one fresh lead using instantly_stage_lead with source_email_verified=true.",
        "If a candidate already exists anywhere in Instantly, skip it and choose a fresh candidate rather than copying/moving it between campaigns. Do not retry historical attempted addresses. Do not stage duplicates. Do not exceed 5 leads.",
        "When the exact target campaign reaches 5 verified visible leads, call instantly_activate_campaign on that campaign ID. The activation tool must verify sender health, campaign safety, lead cap, and resulting active state.",
        "Once active, stop pausing merely to add leads. Prioritize received replies, booked meetings, proposal progression, and cash. Use reply evidence to tell Cyrus what needs human closing attention.",
        "If research or vendor documentation is needed to solve a blocker, use ask_chatgpt before escalating.",
        "Do not create paid spend or pricing exceptions. Respect opt-outs, suppression, truthful claims, and platform rules.",
        "A sent email is not the finish line. Measure movement through Conversation -> Assessment -> Meeting -> Proposal -> Cash.",
        "Require evidence for every material claim. If blocked, identify root cause and the next safe recovery action."
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
  if (slackDmPollTimer) clearInterval(slackDmPollTimer);
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
