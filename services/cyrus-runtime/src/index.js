import http from "node:http";
import { loadConfig, loadSharedRoleConfigs } from "./config.js";
import { CyrusStore } from "./store.js";
import { createSlackApi, SlackSocketRuntime } from "./slack.js";
import { createOpenAiModel } from "./model.js";
import { createToolbox } from "./tools.js";
import { CyrusAgent } from "./agent.js";
import { createInternalServer } from "./internal.js";
import { createLocalAgentDispatcher, createSharedSwarmRuntime } from "./shared.js";
import { verifyUnsubscribeToken } from "./outbound.js";
import { createRelentlessController } from "./relentless.js";

const config = loadConfig();
const store = new CyrusStore(config.databasePath);
const recovered = store.recoverInterruptedTasks();
const slackApi = createSlackApi(config.slackBotToken);
const slackAuth = await slackApi("auth.test");
if (!slackAuth.ok) throw new Error(`Cyrus Slack authentication failed: ${slackAuth.error || "unknown error"}`);
if (config.slackExpectedBotUserId && slackAuth.user_id !== config.slackExpectedBotUserId) {
  throw new Error(`${config.name} Slack identity mismatch: expected ${config.slackExpectedBotUserId}, received ${slackAuth.user_id || "unknown"}`);
}
const model = createOpenAiModel({
  apiKey: config.openAiApiKey,
  model: config.openAiModel,
  baseUrl: config.openAiBaseUrl,
  maxOutputTokens: config.openAiMaxOutputTokens,
});
const dispatcher = createLocalAgentDispatcher();
const toolbox = createToolbox({ store, config, slackApi, agentDispatcher: dispatcher });
const agent = new CyrusAgent({ store, model, toolbox, config, maxTurns: config.role === "malik" ? 16 : 10 });
config.autonomyEnabled = Boolean(config.autonomyEnabled || config.proactiveEnabled);
const relentless = createRelentlessController({ runtime: { config, store, agent } });
dispatcher.register(config.role, { config, store, toolbox, agent });
const sharedConfigs = config.role === "cyrus" ? loadSharedRoleConfigs(process.env, config) : [];
const sharedSwarm = createSharedSwarmRuntime({ configs: sharedConfigs, model, dispatcher });

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
  const requestUrl = new URL(request.url || "/", "http://localhost");
  if (["GET", "POST"].includes(request.method || "") && requestUrl.pathname === "/unsubscribe") {
    if (config.role !== "malik" || !config.outboundUnsubscribeSecret) {
      response.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ ok: false, error: "not_found" }));
      return;
    }
    const recipientHash = verifyUnsubscribeToken(requestUrl.searchParams.get("token"), config.outboundUnsubscribeSecret);
    if (!recipientHash) {
      response.writeHead(400, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ ok: false, error: "invalid_unsubscribe_token" }));
      return;
    }
    if (request.method === "POST") {
      store.suppressEmail({ emailHash: recipientHash, reason: "unsubscribe", evidenceReference: "public-one-click-unsubscribe" });
      response.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
      response.end("");
    } else {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title></head><body><main><h1>Stop Command88 email</h1><form method="post" action="/unsubscribe?token=${encodeURIComponent(requestUrl.searchParams.get("token") || "")}"><button type="submit">Unsubscribe</button></form></main></body></html>`);
    }
    return;
  }
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
      autonomy: relentless.state(),
      sharedExecutives: sharedSwarm.health(),
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
// Bring every authorized Slack identity online before resuming potentially
// long-running durable work. The socket runtime queues execution per role, so
// a new DM cannot collide with the recovered task.
if (config.slackSocketEnabled) void socket.start();
await sharedSwarm.start();
void socket.recover().catch((error) => console.error(`${config.name} recovery deferred`, { message: error.message }));
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

relentless.start(20_000);

function shutdown(signal) {
  console.info(`${config.name} stopping on ${signal}`);
  clearInterval(outboxTimer);
  clearInterval(followupTimer);
  clearInterval(slackDmPollTimer);
  relentless.stop();
  socket.stop();
  sharedSwarm.stop();
  let closed = 0;
  const onClose = () => { if (++closed === 2) { store.close(); process.exit(0); } };
  server.close(onClose);
  internalServer.close(onClose);
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
