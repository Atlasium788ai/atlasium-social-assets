import http from "node:http";
import { loadConfig } from "./config.js";
import { CyrusStore } from "./store.js";
import { createSlackApi, SlackSocketRuntime } from "./slack.js";
import { createOpenAiModel } from "./model.js";
import { createToolbox } from "./tools.js";
import { CyrusAgent } from "./agent.js";

const config = loadConfig();
const store = new CyrusStore(config.databasePath);
const recovered = store.recoverInterruptedTasks();
const slackApi = createSlackApi(config.slackBotToken);
const slackAuth = await slackApi("auth.test");
if (!slackAuth.ok) throw new Error(`Cyrus Slack authentication failed: ${slackAuth.error || "unknown error"}`);
const model = createOpenAiModel({ apiKey: config.openAiApiKey, model: config.openAiModel, baseUrl: config.openAiBaseUrl });
const toolbox = createToolbox({ store, config, slackApi });
const agent = new CyrusAgent({ store, model, toolbox });
const socket = new SlackSocketRuntime({ config, store, agent, slackApi: async (method, payload) => {
  const token = method === "apps.connections.open" ? config.slackAppToken : config.slackBotToken;
  return createSlackApi(token)(method, payload);
} });

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    const slackConnected = config.slackSocketEnabled ? socket.connected : false;
    const healthy = Boolean(slackAuth.ok) && (!config.slackSocketEnabled || slackConnected);
    response.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify({
      ok: healthy,
      service: "cyrus-runtime",
      recovered,
      slackAuthenticated: Boolean(slackAuth.ok),
      slackSocketEnabled: config.slackSocketEnabled,
      slackConnected,
      ...store.health(),
    }));
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: false, error: "not_found" }));
});

server.listen(config.port, "0.0.0.0", () => console.info(`Cyrus health server listening on ${config.port}`));
await socket.recover().catch((error) => console.error("Cyrus recovery deferred", { message: error.message }));
const outboxTimer = setInterval(() => {
  socket.flushOutbox().catch((error) => console.error("Cyrus reply retry failed", { message: error.message }));
}, 15_000);
outboxTimer.unref();
if (config.slackSocketEnabled) socket.start();

function shutdown(signal) {
  console.info(`Cyrus stopping on ${signal}`);
  clearInterval(outboxTimer);
  socket.stop();
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
