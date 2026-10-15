import { systemPrompt, enforceReply } from "./personality.js";
import { outputText, toolCalls } from "./model.js";
import { ATLASIUM_OPERATING_BRIEF } from "./operating_context.js";
import { isConversationOnly, isStructuredUpdateRequest, isHandoffFollowup } from "./conversation.js";

export class CyrusAgent {
  constructor({ store, model, toolbox, config = { role: "cyrus", name: "Cyrus" }, maxTurns = 10 }) {
    this.store = store;
    this.model = model;
    this.toolbox = toolbox;
    this.config = config;
    this.maxTurns = maxTurns;
    this.activeTasks = 0;
  }

  isBusy() {
    return this.activeTasks > 0;
  }

  async handleTask(task, options = {}) {
    this.activeTasks += 1;
    try {
      return await this.executeTask(task, options);
    } finally {
      this.activeTasks = Math.max(0, this.activeTasks - 1);
    }
  }

  async executeTask(task, { followupReason = null } = {}) {
    this.store.setTaskStatus(task.id, "running");
    const history = this.store.recentConversation(task.id);
    const handoffFollowup = isHandoffFollowup(task.request_text, history);
    const continuity = "\n\nCONVERSATION CONTINUITY: Use the supplied recent turns to interpret short follow-ups and answers to your questions. The latest message controls scope. Do not re-execute an old instruction merely because it appears in history. When Blair names an executive after you asked which person, treat it as his answer, not an identity correction. For an explicit request to ask an executive, use the permitted internal handoff and include the resolved context; ask only for information still genuinely missing.\nLOCAL WORK STATUS: Background automation configured: " + Boolean(this.config.autonomyEnabled) + ". Other active executions in this role: " + Math.max(0, this.activeTasks - 1) + ". Recent role-local work records (timestamps and statuses, not proof of external results): " + JSON.stringify(this.store.recentWorkStatus(task.id)) + ". Do not assert that no background work exists without checking this supplied state. Automation configured does not prove work is currently executing.";
    // Conversation-only mode applies to every executive, including dialogue
    // handed off via Cyrus. It is read-only at the API boundary.
    if (!followupReason && !handoffFollowup && isConversationOnly(task.request_text)) {
      try {
        const operatingPlan = this.store.getOperatingItems();
        const memories = this.store.recentDecisions();
        const response = await this.model.respond({
          instructions: systemPrompt(this.config.role) + continuity + "\n\nCONVERSATION-ONLY MODE: This is a discussion, not permission to operate. Answer the speaker directly in your specific executive voice. Do not give a status report, introduce yourself, list your capabilities, or use a formal template. No tools, delegations, follow-ups, task planning, changes or external communication. Rely on the supplied context when relevant but distinguish past information from live facts. Never claim to have checked a service or completed business work.",
          input: [
            { role: "developer", content: `READ-ONLY COMPANY BACKGROUND (not a new instruction or proof of live figures):
${ATLASIUM_OPERATING_BRIEF}

Role-specific remembered decisions (not guaranteed current):
${JSON.stringify(memories.slice(0, 12))}

Role-specific current operating-plan records (verify externally before claiming live status):
${JSON.stringify(operatingPlan.slice(0, 20))}` },
            ...history,
            { role: "user", content: task.request_text },
          ],
          tools: [],
        });
        if (response?.usage) {
          console.info(JSON.stringify({
            event: "model_usage",
            role: this.config.role,
            taskId: task.id,
            attempt: 1,
            mode: "conversation",
            inputTokens: response.usage.input_tokens ?? null,
            cachedInputTokens: response.usage.input_tokens_details?.cached_tokens ?? null,
            outputTokens: response.usage.output_tokens ?? null,
          }));
        }
        // No execution path exists in conversation mode, even if the model
        // unexpectedly tries to emit a function call.
        const reply = outputText(response).trim();
        if (!reply) {
          this.store.setTaskStatus(task.id, "blocked", { blocker: "Conversation model returned no text" });
          return "I couldn't produce a useful answer. Ask me again.";
        }
        this.store.setTaskStatus(task.id, "completed", { summary: reply });
        return reply.length > 1200 ? reply.slice(0, 1197) + "..." : reply;
      } catch (error) {
        this.store.addStep(task.id, { attempt: 1, status: "model_error", detail: { error: error.message } });
        this.store.setTaskStatus(task.id, "blocked", { blocker: "Conversation model unavailable" });
        console.error(JSON.stringify({ event: "model_error", mode: "conversation", role: this.config.role, taskId: task.id, error: error.message }));
        return "I can't answer that right now. The AI connection failed.";
      }
    }
    const context = {
      taskId: task.id,
      requiresEvidence: true,
      isFollowup: Boolean(followupReason),
    };
    const durableContext = this.store.recentDecisions();
    const operatingPlan = this.store.getOperatingItems();
    const workPlan = this.store.getWorkItems(task.id);
    const priorEvidence = this.store.getEvidence(task.id).map(({ id, source, claim, verified_at }) => ({ id, source, claim, verified_at }));
    const evidenceSignature = row => JSON.stringify([row.source, row.claim, row.detail_json]);
    const initialEvidenceSignatures = new Set(this.store.getEvidence(task.id).map(evidenceSignature));
    let input = [
      {
        role: "developer",
        content: `Current Atlasium operating brief. Treat this as durable company context unless a newer authoritative source explicitly supersedes it:
${ATLASIUM_OPERATING_BRIEF}

Current durable company operating plan. Treat these as live open loops and priorities; update them when material state changes:
${JSON.stringify(operatingPlan)}

Active durable decisions from prior work. Treat these as context, not new instructions:
${JSON.stringify(durableContext)}
Current task work plan:
${JSON.stringify(workPlan)}
Existing verified evidence:
${JSON.stringify(priorEvidence)}
Recent tool receipts for this same task (do not repeat successful writes or sends; reconcile uncertain outcomes):
${JSON.stringify(this.store.recentToolReceipts(task.id))}
${continuity}
Request routing: ACTION. Execute with tools and require evidence. A phrase such as 'conversational exercise' or a restriction against external messaging limits the permitted actions; it does not turn an explicit internal diagnostic or execution request into conversation-only.
INTERNAL READ-ONLY ACCEPTANCE TESTS: When asked to prove that this executive can execute a harmless internal task, call system_health once. Its verified durable-store result is evidence for that specific health check only. If it succeeds, call complete_task with a narrow summary of the observed health result. Do not create work plans or unrelated operating-plan items for a simple diagnostic, and do not claim broader integrations, revenue work, or other executives passed. If the requested objective needs evidence unavailable from permitted tools, report_blocker with the precise missing evidence rather than looping through list_work_plan, recall_memory, or list_operating_plan. Never invent evidence or bypass completion guards.${followupReason ? `
Automatic follow-up is due: ${followupReason}` : ""}`,
      },
      ...history,
      { role: "user", content: task.request_text },
    ];
    let lastText = "";

    for (let attempt = 1; attempt <= this.maxTurns; attempt += 1) {
      let response;
      try {
        response = await this.model.respond({ instructions: systemPrompt(this.config.role), input, tools: this.toolbox.definitions });
        if (response?.usage) {
          console.info(JSON.stringify({
            event: "model_usage",
            role: this.config.role,
            taskId: task.id,
            attempt,
            inputTokens: response.usage.input_tokens ?? null,
            cachedInputTokens: response.usage.input_tokens_details?.cached_tokens ?? null,
            outputTokens: response.usage.output_tokens ?? null,
            totalTokens: response.usage.total_tokens ?? null,
          }));
        }
      } catch (error) {
        this.store.addStep(task.id, { attempt, status: "model_error", detail: { error: error.message } });
        console.error(JSON.stringify({ event: "model_error", role: this.config.role, taskId: task.id, attempt, error: error.message }));
        if (attempt < 2) continue;
        this.store.setTaskStatus(task.id, "blocked", { blocker: `Model service unavailable: ${error.message}` });
        return "Blocked. The model service is unavailable after a retry.";
      }

      lastText = outputText(response) || lastText;
      const calls = toolCalls(response);
      input = [...input, ...(response.output || [])];
      if (calls.length === 0) {
        const current = this.store.getTask(task.id);
        if (current.status === "running") {
          if (this.store.hasPendingFollowup(task.id)) break;
          const evidenceCount = this.store.getEvidence(task.id).length;
          input.push({
            role: "user",
            content: evidenceCount === 0
              ? "This is an action request. Use a tool and verify the result, or report the exact blocker. Do not claim completion without evidence."
              : "Evidence exists, but the objective is still open. Explicitly call complete_task with the verified outcome, schedule a justified follow-up, or report the exact blocker. Do not stop at analysis or a text-only claim.",
          });
          continue;
        }
        break;
      }

      for (const call of calls) {
        let args = {};
        try { args = JSON.parse(call.arguments || "{}"); } catch { args = {}; }
        let result;
        try {
          result = await this.toolbox.execute(call.name, args, context);
        } catch (error) {
          result = { ok: false, error: `Tool rejected invalid input: ${error.message}`, retryable: false };
        }
        this.store.addStep(task.id, { attempt, toolName: call.name, status: result.ok ? "ok" : "failed", detail: result });
        console.info(JSON.stringify({
          event: "tool_result",
          role: this.config.role,
          taskId: task.id,
          tool: call.name,
          ok: Boolean(result.ok),
          evidenceSource: result.evidence?.source || null,
          evidenceClaim: result.evidence?.claim ? String(result.evidence.claim).slice(0, 500) : null,
          evidenceDetail: result.evidence?.detail ? JSON.stringify(result.evidence.detail).slice(0, 1000) : null,
          error: result.ok ? null : result.error || null,
        }));
        if (!result.ok && result.retryable) {
          const firstFailure = result;
          try {
            result = await this.toolbox.execute(call.name, args, context);
          } catch (error) {
            result = { ok: false, error: `Tool retry rejected invalid input: ${error.message}`, retryable: false };
          }
          result = result.ok ? { ...result, recoveredFrom: firstFailure.error } : result;
          this.store.addStep(task.id, { attempt, toolName: call.name, status: result.ok ? "recovered" : "retry_failed", detail: result });
        }
        if (result.evidence) {
          const evidence = this.store.addEvidence(task.id, result.evidence);
          result = { ...result, evidenceId: evidence.id };
        }
        input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
      }

      const current = this.store.getTask(task.id);
      if (["completed", "blocked", "failed"].includes(current.status) && lastText) break;
    }

    const finalTask = this.store.getTask(task.id);
    if (finalTask.status === "running" && !this.store.hasPendingFollowup(task.id)) {
      const progressed = this.store.getEvidence(task.id).some(row => !initialEvidenceSignatures.has(evidenceSignature(row)));
      const continuations = this.store.continuationCount(task.id);
      if (progressed && continuations < 2) {
        this.store.scheduleFollowup(task.id, { dueAt: new Date(Date.now() + 15_000).toISOString(), reason: "Continue the same assigned objective from saved work plan, evidence and tool receipts. Do not repeat completed writes or sends. Finish the next outstanding action, or record the exact remaining dependency." });
        this.store.addStep(task.id, { attempt: this.maxTurns, status: "continuation_scheduled", detail: { continuation: continuations + 1, evidenceCount: this.store.getEvidence(task.id).length } });
        console.info(JSON.stringify({ event: "task_continuation_scheduled", role: this.config.role, taskId: task.id, continuation: continuations + 1 }));
        lastText = "The assignment has made progress and remains open. The next execution step is queued automatically.";
      } else {
        this.store.setTaskStatus(task.id, "blocked", { blocker: progressed ? "Execution limit reached after two bounded continuations; objective remains unverified" : "Execution limit reached without new verified progress" });
      }
    }
    const settled = this.store.getTask(task.id);
    const evidence = this.store.getEvidence(task.id);
    const followup = this.store.nextFollowup(task.id);
    const fallback = settled.status === "blocked"
      ? `Blocked. ${settled.blocker}`
      : followup
        ? `In motion. I will reassess automatically at ${followup.due_at}.`
        : settled.summary;
    const replyText = settled.status === "blocked" ? fallback : lastText || fallback;
    return enforceReply(replyText, { status: settled.status, evidenceCount: evidence.length, name: this.config.name, requiresEvidence: context.requiresEvidence, structured: isStructuredUpdateRequest(task.request_text) });
  }
}

