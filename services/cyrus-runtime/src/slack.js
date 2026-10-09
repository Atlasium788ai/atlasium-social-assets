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

export function slackMessageSourceId(event) {
  if (!event?.channel || !event?.ts) return null;
  return `slack-message:${event.channel}:${event.ts}`;
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
    this.pollPromise = null;
    this.connected = false;
    this.lastPollAt = null;
    this.lastPollError = null;
    this.dmChannelId = null;
    this.reactionPermission = "unknown";
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
      if (!task.channel_id.startsWith("internal:")) this.store.queueReply(task.id, task.channel_id, reply);
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
        if (String(reply.channel_id || "").startsWith("internal:")) {
          this.store.markReplySent(reply.id, "internal-suppressed");
          continue;
        }
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

  async setMessageReaction(event, name, add) {
    if (!event?.channel || !event?.ts) return false;
    if (this.reactionPermission === "missing_scope") return false;
    const method = add ? "reactions.add" : "reactions.remove";
    try {
      const result = await this.slackApi(method, { channel: event.channel, timestamp: event.ts, name });
      if (!result.ok && result.error === "missing_scope") {
        this.reactionPermission = "missing_scope";
        this.logger.warn("Slack reactions disabled: existing app authorization is missing reactions:write", {
          method,
          name,
          error: result.error,
          requiredScope: result.needed || "reactions:write",
          providedScopes: result.provided || null,
          authorizationRequired: "Add reactions:write to the existing Slack app Bot Token Scopes, then reinstall or re-authorize that app in the workspace.",
        });
        return false;
      }
      if (!result.ok && !(add && result.error === "already_reacted") && !(!add && result.error === "no_reaction")) {
        this.logger.warn("Slack reaction update failed", { method, name, error: result.error || "unknown_error" });
        return false;
      }
      this.reactionPermission = "available";
      return true;
    } catch (error) {
      this.logger.warn("Slack reaction update failed", { method, name, error: error.message });
      return false;
    }
  }

  async processSlackMessage(event, fallbackSourceId = null) {
    if (!shouldHandleMessage(event, this.config)) return false;
    const sourceEventId = slackMessageSourceId(event) || fallbackSourceId;
    if (!sourceEventId) return false;
    const { task, created } = this.store.createTask({
      sourceEventId,
      requesterId: event.user,
      channelId: event.channel,
      requestText: event.text.trim(),
    });
    if (!created) return false;
    // Show a compact status lifecycle without posting robotic placeholder text.
    // Missing reactions:write permission is non-fatal; the actual answer still sends.
    await this.setMessageReaction(event, "eyes", true);
    await this.setMessageReaction(event, "hourglass_flowing_sand", true);
    await this.setMessageReaction(event, "eyes", false);
    let completed = false;
    try {
      const reply = await this.agent.handleTask(task);
      this.store.queueReply(task.id, event.channel, reply);
      await this.flushOutbox();
      completed = true;
      return true;
    } finally {
      await this.setMessageReaction(event, "hourglass_flowing_sand", false);
      await this.setMessageReaction(event, completed ? "white_check_mark" : "warning", true);
    }
  }

  async pollDirectMessages() {
    if (this.pollPromise) return this.pollPromise;
    this.pollPromise = (async () => {
      try {
        if (!this.dmChannelId) {
          const opened = await this.slackApi("conversations.open", { users: this.config.blairSlackUserId });
          if (!opened.ok || !opened.channel?.id) throw new Error(opened.error || "Slack did not return the Blair DM channel");
          this.dmChannelId = opened.channel.id;
        }
        const history = await this.slackApi("conversations.history", { channel: this.dmChannelId, limit: 50 });
        if (!history.ok || !Array.isArray(history.messages)) throw new Error(history.error || "Slack did not return DM history");
        const newestFirst = history.messages;
        const latestBotReply = newestFirst.find((message) => message.bot_id || message.subtype === "bot_message");
        const latestBotReplyTs = Number(latestBotReply?.ts || 0);
        const unanswered = newestFirst
          .filter((message) => Number(message.ts || 0) > latestBotReplyTs)
          .filter((message) => shouldHandleMessage({ ...message, type: "message", channel: this.dmChannelId, channel_type: "im" }, this.config))
          .sort((left, right) => Number(left.ts) - Number(right.ts));
        let processed = 0;
        for (const message of unanswered) {
          const accepted = await this.processSlackMessage({ ...message, type: "message", channel: this.dmChannelId, channel_type: "im" });
          if (accepted) processed += 1;
        }
        this.lastPollAt = new Date().toISOString();
        this.lastPollError = null;
        this.logger.info(JSON.stringify({ event: "slack_dm_poll", channel: this.dmChannelId, unanswered: unanswered.length, processed }));
        return processed;
      } catch (error) {
        this.lastPollAt = new Date().toISOString();
        this.lastPollError = error.message;
        throw error;
      }
    })();
    try {
      return await this.pollPromise;
    } finally {
      this.pollPromise = null;
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
    const accepted = shouldHandleMessage(event, this.config);
    this.logger.info(JSON.stringify({
      event: "slack_event_received",
      eventId,
      type: event?.type || null,
      subtype: event?.subtype || null,
      user: event?.user || null,
      channel: event?.channel || null,
      channelType: event?.channel_type || null,
      botId: event?.bot_id || null,
      appId: event?.app_id || null,
      textLength: typeof event?.text === "string" ? event.text.length : 0,
      accepted,
    }));
    if (!accepted) return;
    await this.processSlackMessage(event, eventId);
  }
}
