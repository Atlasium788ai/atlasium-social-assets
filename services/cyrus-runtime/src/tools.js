function ok(data, evidence) {
  return { ok: true, data, evidence };
}

function fail(error, retryable = false) {
  return { ok: false, error, retryable };
}

export function createToolbox({ store, config, slackApi, fetchImpl = fetch }) {
  const definitions = [
    {
      type: "function",
      name: "recall_memory",
      description: "Recall active decisions and durable context from previous tasks and restarts.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
    },
    {
      type: "function",
      name: "remember_decision",
      description: "Persist a decision Blair made, including why it was made.",
      parameters: {
        type: "object",
        properties: { topic: { type: "string" }, decision: { type: "string" }, rationale: { type: "string" } },
        required: ["topic", "decision", "rationale"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "system_health",
      description: "Check Cyrus's durable store and runtime health.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: "http_read",
      description: "Read an allowlisted HTTPS page or API without changing it.",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
    },
    {
      type: "function",
      name: "slack_channel_history",
      description: "Read recent evidence from an explicitly allowlisted non-DM Slack channel.",
      parameters: {
        type: "object",
        properties: { channel_id: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 30 } },
        required: ["channel_id"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "complete_task",
      description: "Mark an action complete. Action requests require evidence from another tool first.",
      parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false },
    },
    {
      type: "function",
      name: "report_blocker",
      description: "Stop only when a precise missing authority, access, credential, or decision prevents progress.",
      parameters: { type: "object", properties: { blocker: { type: "string" } }, required: ["blocker"], additionalProperties: false },
    },
  ];

  async function execute(name, args, context) {
    if (name === "recall_memory") return ok(store.recallDecisions(args.query));
    if (name === "remember_decision") {
      const row = store.rememberDecision({ ...args, sourceTaskId: context.taskId });
      return ok(row, { source: "cyrus_memory", claim: `Decision remembered: ${args.topic}`, detail: row });
    }
    if (name === "system_health") {
      const health = store.health();
      return ok(health, { source: "cyrus_runtime", claim: "Durable store health check passed", detail: health });
    }
    if (name === "http_read") {
      let url;
      try { url = new URL(args.url); } catch { return fail("Invalid URL"); }
      if (url.protocol !== "https:" || !config.httpReadAllowlist.has(url.origin)) return fail(`URL origin is not allowlisted: ${url.origin}`);
      try {
        const response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(12_000) });
        const body = (await response.text()).slice(0, 12_000);
        if (!response.ok) return fail(`GET ${url} returned ${response.status}`, response.status >= 500);
        return ok({ status: response.status, body }, { source: String(url), claim: `Read returned HTTP ${response.status}`, detail: { status: response.status, bodySample: body.slice(0, 500) } });
      } catch (error) {
        return fail(`GET failed: ${error.message}`, true);
      }
    }
    if (name === "slack_channel_history") {
      const id = args.channel_id;
      if (!config.slackAllowedChannelIds.has(id) || /^[DG]/.test(id)) return fail("That Slack channel is not approved for Cyrus evidence reads");
      const result = await slackApi("conversations.history", { channel: id, limit: Math.min(args.limit || 20, 30) });
      if (!result.ok) return fail(result.error || "Slack history read failed", result.error === "ratelimited");
      const messages = (result.messages || []).map(({ ts, user, text }) => ({ ts, user, text }));
      return ok(messages, { source: `slack:${id}`, claim: `Read ${messages.length} channel messages`, detail: { latestTs: messages[0]?.ts || null } });
    }
    if (name === "complete_task") {
      const evidenceCount = store.getEvidence(context.taskId).length;
      if (context.requiresEvidence && evidenceCount === 0) return fail("Completion rejected: this action has no verification evidence");
      store.setTaskStatus(context.taskId, "completed", { summary: args.summary });
      return ok({ status: "completed", summary: args.summary });
    }
    if (name === "report_blocker") {
      store.setTaskStatus(context.taskId, "blocked", { blocker: args.blocker });
      return ok({ status: "blocked", blocker: args.blocker });
    }
    return fail(`Unknown tool: ${name}`);
  }

  return { definitions, execute };
}
