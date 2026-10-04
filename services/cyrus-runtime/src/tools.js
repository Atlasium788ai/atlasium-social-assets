import { createHash } from "node:crypto";

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
      description: `Check ${config.name}'s durable store and runtime health.`,
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: "create_work_plan",
      description: "Break the current objective into ordered work items with explicit owners and dependencies.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                owner: { type: "string" },
                depends_on: { type: "string" },
                next_action_at: { type: "string" },
              },
              required: ["id", "title", "owner"],
              additionalProperties: false,
            },
          },
        },
        required: ["items"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "list_work_plan",
      description: "Read the current objective's durable work items and status.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: "update_work_item",
      description: "Update a work item. Completed items require an evidence_id returned by a verified tool.",
      parameters: {
        type: "object",
        properties: {
          item_id: { type: "string" },
          status: { type: "string", enum: ["planned", "running", "blocked", "completed"] },
          evidence_id: { type: "string" },
          next_action_at: { type: "string" },
        },
        required: ["item_id", "status"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "delegate_to_agent",
      description: "Deliver work to a connected Atlasium agent and wait for its verified response. Never use this for an unconnected role.",
      parameters: {
        type: "object",
        properties: { agent: { type: "string" }, objective: { type: "string" }, work_item_id: { type: "string" } },
        required: ["agent", "objective"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "schedule_followup",
      description: "Schedule an automatic reassessment when work is genuinely waiting. Minimum 15 seconds.",
      parameters: {
        type: "object",
        properties: { seconds: { type: "integer", minimum: 15, maximum: 86400 }, reason: { type: "string" } },
        required: ["seconds", "reason"],
        additionalProperties: false,
      },
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
      return ok(row, { source: `${config.role}_memory`, claim: `Decision remembered: ${args.topic}`, detail: row });
    }
    if (name === "system_health") {
      const health = store.health();
      return ok(health, { source: `${config.role}_runtime`, claim: "Durable store health check passed", detail: health });
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
      if (!config.slackAllowedChannelIds.has(id) || /^[DG]/.test(id)) return fail(`That Slack channel is not approved for ${config.name} evidence reads`);
      const result = await slackApi("conversations.history", { channel: id, limit: Math.min(args.limit || 20, 30) });
      if (!result.ok) return fail(result.error || "Slack history read failed", result.error === "ratelimited");
      const messages = (result.messages || []).map(({ ts, user, text }) => ({ ts, user, text }));
      return ok(messages, { source: `slack:${id}`, claim: `Read ${messages.length} channel messages`, detail: { latestTs: messages[0]?.ts || null } });
    }
    if (name === "create_work_plan") {
      if (!Array.isArray(args.items) || args.items.some((item) => !item?.id?.trim() || !item?.title?.trim() || !item?.owner?.trim())) {
        return fail("Every work item needs an id, title, and owner");
      }
      try { return ok(store.createWorkPlan(context.taskId, args.items)); }
      catch (error) { return fail(`Work plan rejected: ${error.message}`); }
    }
    if (name === "list_work_plan") return ok(store.getWorkItems(context.taskId));
    if (name === "update_work_item") {
      try {
        const row = store.updateWorkItem(context.taskId, args.item_id, {
          status: args.status,
          evidenceId: args.evidence_id || null,
          nextActionAt: args.next_action_at || null,
        });
        return ok(row);
      } catch (error) { return fail(`Work item update rejected: ${error.message}`); }
    }
    if (name === "delegate_to_agent") {
      const target = String(args.agent || "").toLowerCase();
      const baseUrl = config.agentPeers[target];
      if (!baseUrl) return fail(`Agent ${target || "unknown"} is not connected for verified handoff`);
      const handoffId = createHash("sha256").update(JSON.stringify([context.taskId, target, args.objective, args.work_item_id || ""])).digest("hex");
      try {
        const response = await fetchImpl(`${baseUrl}/handoff`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-atlasium-source": config.role },
          body: JSON.stringify({ id: handoffId, from: config.role, to: target, message: args.objective }),
          signal: AbortSignal.timeout(75_000),
        });
        let body;
        try { body = await response.json(); } catch { return fail(`Agent ${target} returned invalid JSON`, response.status >= 500); }
        if (!response.ok || !body.ok) return fail(body.error || `Agent ${target} returned ${response.status}`, response.status >= 500);
        const claim = `Verified handoff to ${target}: ${body.status}`;
        return ok(body, { source: `handoff:${target}`, claim, detail: { handoffId, status: body.status, evidenceCount: body.evidenceCount || 0 } });
      } catch (error) {
        return fail(`Handoff to ${target} failed: ${error.message}`, true);
      }
    }
    if (name === "schedule_followup") {
      if (context.isFollowup) {
        return fail("This is the scheduled follow-up. Reassess now, then complete with evidence or report the exact blocker; do not schedule the same follow-up again.");
      }
      const seconds = Math.max(15, Math.min(86400, Number(args.seconds || 0)));
      const dueAt = new Date(Date.now() + seconds * 1000).toISOString();
      const row = store.scheduleFollowup(context.taskId, { dueAt, reason: String(args.reason || "Reassess objective") });
      return ok(row);
    }
    if (name === "complete_task") {
      const evidenceCount = store.getEvidence(context.taskId).length;
      if (context.requiresEvidence && evidenceCount === 0) return fail("Completion rejected: this action has no verification evidence");
      if (store.hasPendingFollowup(context.taskId)) return fail("Completion rejected: an automatic follow-up is still pending");
      const openItems = store.openWorkItems(context.taskId);
      if (openItems.length) return fail(`Completion rejected: ${openItems.length} planned work item(s) are still open`);
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
