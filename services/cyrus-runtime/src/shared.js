import { randomUUID } from "node:crypto";
import { CyrusAgent } from "./agent.js";
import { createSlackApi, SlackSocketRuntime } from "./slack.js";
import { CyrusStore } from "./store.js";
import { createToolbox } from "./tools.js";

function snapshot(store, task) {
  return {
    ok: true,
    taskId: task.id,
    status: task.status,
    summary: task.summary || null,
    blocker: task.blocker || null,
    evidenceCount: store.getEvidence(task.id).length,
  };
}

export function createLocalAgentDispatcher() {
  const agents = new Map();
  return {
    has(role) {
      return agents.has(String(role || "").toLowerCase());
    },
    roles() {
      return [...agents.keys()];
    },
    register(role, runtime) {
      const normalized = String(role || "").toLowerCase();
      if (!normalized || agents.has(normalized)) throw new Error(`Local agent already registered: ${normalized || "unknown"}`);
      agents.set(normalized, runtime);
    },
    async dispatch({ id, from, to, message, mode = "task" }) {
      const source = String(from || "").toLowerCase();
      const target = String(to || "").toLowerCase();
      const handoffId = String(id || randomUUID()).trim();
      const objective = String(message || "").trim();
      if (!agents.has(source)) throw new Error(`Local handoff source is not registered: ${source || "unknown"}`);
      if (!agents.has(target)) throw new Error(`Local handoff target is not registered: ${target || "unknown"}`);
      if (source !== "cyrus" && target !== "cyrus") throw new Error("Department-to-department handoffs must route through Cyrus");
      if (!handoffId || handoffId.length > 128 || !objective || objective.length > 12_000) throw new Error("Invalid local handoff");

      const runtime = agents.get(target);
      const sourceEventId = `handoff:${source}:${handoffId}`;
      const existing = runtime.store.getTaskBySourceEvent(sourceEventId);
      if (existing) return snapshot(runtime.store, existing);
      const { task } = runtime.store.createTask({
        sourceEventId,
        requesterId: `agent:${source}`,
        channelId: `internal:${source}`,
        requestText: `Internal handoff from ${source}: ${mode === "conversation" ? "CONVERSATION-ONLY: " : ""}${objective}`,
      });
      const reply = await runtime.agent.handleTask(task);
      const settled = runtime.store.getTask(task.id);
      return { ...snapshot(runtime.store, settled), reply };
    },
  };
}

function routedSlackApi(config, fetchImpl) {
  const appApi = config.slackAppToken ? createSlackApi(config.slackAppToken, fetchImpl) : null;
  const botApi = config.slackBotToken ? createSlackApi(config.slackBotToken, fetchImpl) : null;
  return async (method, payload) => {
    const api = method === "apps.connections.open" ? appApi : botApi;
    if (!api) return { ok: false, error: "direct_slack_not_configured" };
    return api(method, payload);
  };
}

export function createSharedSwarmRuntime({
  configs,
  model,
  dispatcher,
  fetchImpl = fetch,
  WebSocketImpl = WebSocket,
  logger = console,
}) {
  const roles = [];
  for (const config of configs) {
    const store = new CyrusStore(config.databasePath);
    const recovered = store.recoverInterruptedTasks();
    const slackApi = routedSlackApi(config, fetchImpl);
    const toolbox = createToolbox({ store, config, slackApi, fetchImpl, agentDispatcher: dispatcher });
    const agent = new CyrusAgent({ store, model, toolbox, config, maxTurns: 10 });
    const socket = new SlackSocketRuntime({ config, store, agent, slackApi, WebSocketImpl, logger });
    const runtime = {
      config,
      store,
      toolbox,
      agent,
      socket,
      recovered,
      slackAuthenticated: false,
      slackError: null,
    };
    roles.push(runtime);
    dispatcher.register(config.role, runtime);
  }

  let maintenanceTimer = null;
  let stopped = false;

  async function maintain(runtime) {
    let stage = "flush_outbox";
    try {
      await runtime.socket.flushOutbox();
      stage = "due_followups";
      await runtime.socket.processDueFollowups();
      stage = "dm_poll";
      if (runtime.slackAuthenticated && runtime.config.slackSocketEnabled) await runtime.socket.pollDirectMessages();
      runtime.slackError = null;
    } catch (error) {
      runtime.slackError = error.message;
      // Log the failed stage and source line, never message bodies or credentials.
      logger.error(`${runtime.config.name} shared maintenance failed`, {
        stage,
        message: error.message,
        stack: String(error.stack || "").slice(0, 1400),
      });
    }
  }

  return {
    roles,
    async start() {
      for (const runtime of roles) {
        const { config } = runtime;
        if (config.slackSocketEnabled) {
          try {
            const auth = await createSlackApi(config.slackBotToken, fetchImpl)("auth.test");
            if (!auth.ok) throw new Error(auth.error || "Slack authentication failed");
            if (config.slackExpectedBotUserId && auth.user_id !== config.slackExpectedBotUserId) {
              throw new Error(`Slack identity mismatch: expected ${config.slackExpectedBotUserId}, received ${auth.user_id || "unknown"}`);
            }
            runtime.slackAuthenticated = true;
            runtime.slackError = null;
          } catch (error) {
            runtime.slackError = error.message;
            logger.error(`${config.name} shared Slack disabled`, { message: error.message });
          }
        }
        await runtime.socket.recover().catch((error) => {
          runtime.slackError = error.message;
          logger.error(`${config.name} shared recovery deferred`, { message: error.message });
        });
        if (runtime.slackAuthenticated && config.slackSocketEnabled && !stopped) runtime.socket.start();
      }
      maintenanceTimer = setInterval(() => {
        for (const runtime of roles) void maintain(runtime);
      }, 15_000);
      maintenanceTimer.unref();
    },
    health() {
      return Object.fromEntries(roles.map((runtime) => [runtime.config.role, {
        name: runtime.config.name,
        title: runtime.config.title,
        department: runtime.config.department,
        mode: runtime.config.slackSocketEnabled ? "direct-slack" : "cyrus-mediated",
        slackAuthenticated: runtime.slackAuthenticated,
        slackConnected: runtime.socket.connected,
        slackError: runtime.slackError,
        recovered: runtime.recovered,
        ...runtime.store.health(),
      }]));
    },
    stop() {
      stopped = true;
      if (maintenanceTimer) clearInterval(maintenanceTimer);
      for (const runtime of roles) {
        runtime.socket.stop();
        runtime.store.close();
      }
    },
  };
}
