const SLACK_API = "https://slack.com/api";

export function createSlackApi(token, fetchImpl = fetch) {
  return async function slackApi(method, payload = {}) {
    const response = await fetchImpl(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error(`Slack ${method} returned invalid JSON (${response.status})`);
    }
    if (!response.ok) throw new Error(`Slack ${method} returned HTTP ${response.status}`);
    return body;
  };
}

export function shouldHandleMessage(event, config) {
  return Boolean(
    event &&
    event.type === "message" &&
    event.channel_type === "im" &&
    event.user === config.blairSlackUserId &&
    event.text?.trim() &&
    !event.bot_id &&
    !event.subtype
  );
}

export class SlackSocketRuntime {
  constructor({ config, store, agent, slackApi, WebSocketImpl = WebSocket, logger = console }) {
    this.config = config;
    this.store = store;
    this.agent = agent;
    this.slackApi = slackApi;
    this.WebSocketImpl = WebSocketImpl;
    this.logger = logger;
    this.stopped = false;
    this.reconnectMs = 1_000;
    this.flushPromise = null;
    this.connected = false;
  }

  async start() {
    while (!this.stopped) {
      try {
        const opened = await this.slackApi("apps.connections.open");
        if (!opened.ok || !opened.url) throw new Error(opened.error || "Slack did not return a socket URL");
        await this.runSocket(opened.url);
      } catch (error) {
        this.logger.error("Slack socket error", { message: error.message });
      }
      if (!this.stopped) {
        await new Promise((resolve) => setTimeout(resolve, this.reconnectMs));
        this.reconnectMs = Math.min(this.reconnectMs * 2, 30_000);
      }
    }
  }

  async recover() {
    for (const task of this.store.pendingTasks()) {
      if (this.store.hasPendingFollowup(task.id)) continue;
      const reply = await this.agent.handleTask(task);
      this.store.queueReply(task.id, task.channel_id, reply);
    }
    await this.flushOutbox();
  }

  async processDueFollowups() {
    for (const followup of this.store.claimDueFollowups()) {
      const task = this.store.getTask(followup.task_id);
      if (!task || ["completed", "blocked", "failed"].includes(task.status)) {
        this.store.completeFollowup(followup.id);
        continue;
      }
      try {
        const reply = await this.agent.handleTask(task, { followupReason: followup.reason });
        this.store.completeFollowup(followup.id);
        if (!task.channel_id.startsWith("internal:")) this.store.queueReply(task.id, task.channel_id, reply);
      } catch (error) {
        this.store.releaseFollowup(followup.id);
        this.logger.error(`${this.config.name} follow-up failed`, { taskId: task.id, message: error.message });
        throw error;
      }
    }
    await this.flushOutbox();
  }

  async flushOutbox() {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = (async () => {
      for (const reply of this.store.pendingReplies()) {
        const posted = await this.slackApi("chat.postMessage", {
          channel: reply.channel_id,
          text: reply.body,
          client_msg_id: reply.id,
        });
        if (!posted.ok) throw new Error(`Slack reply failed: ${posted.error || "unknown error"}`);
        this.store.markReplySent(reply.id, posted.ts);
      }
    })();
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  stop() {
    this.stopped = true;
    this.connected = false;
    this.socket?.close();
  }

  runSocket(url) {
    return new Promise((resolve, reject) => {
      const socket = new this.WebSocketImpl(url);
      this.socket = socket;
      socket.addEventListener("open", () => {
        this.connected = true;
        this.reconnectMs = 1_000;
        this.logger.info(`${this.config.name} Slack socket connected`);
      });
      socket.addEventListener("message", (message) => this.onEnvelope(socket, message.data).catch((error) => this.logger.error("Envelope failed", { message: error.message })));
      socket.addEventListener("close", () => { this.connected = false; resolve(); });
      socket.addEventListener("error", (error) => { this.connected = false; reject(error); });
    });
  }

  async onEnvelope(socket, raw) {
    const envelope = JSON.parse(String(raw));
    if (envelope.envelope_id) socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
    if (envelope.type !== "events_api") return;
    const eventId = envelope.payload?.event_id;
    const event = envelope.payload?.event;
    if (!eventId || !this.store.acceptSlackEvent(eventId, envelope.payload)) return;
    if (!shouldHandleMessage(event, this.config)) return;

    const { task, created } = this.store.createTask({
      sourceEventId: eventId,
      requesterId: event.user,
      channelId: event.channel,
      requestText: event.text.trim(),
    });
    if (!created) return;
    const reply = await this.agent.handleTask(task);
    this.store.queueReply(task.id, event.channel, reply);
    await this.flushOutbox();
  }
}
