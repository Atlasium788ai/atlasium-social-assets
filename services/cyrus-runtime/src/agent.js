import { systemPrompt, enforceReply } from "./personality.js";
import { outputText, toolCalls } from "./model.js";
import { ATLASIUM_OPERATING_BRIEF } from "./operating_context.js";
import { isConversationOnly, isStructuredUpdateRequest } from "./conversation.js";

function looksLikeAction(text) {
  return /\b(build|check|verify|find|fix|send|post|create|change|update|remember|schedule|run|inspect|connect|deploy|remove|launch|complete)\b/i.test(text);
}

export class CyrusAgent {
  constructor({ store, model, toolbox, config = { role: "cyrus", name: "Cyrus" }, maxTurns = 10 }) {
    this.store = store;
    this.model = model;
    this.toolbox = toolbox;
    this.config = config;
    this.maxTurns = maxTurns;
  }

  async handleTask(task, { followupReason = null } = {}) {
    this.store.setTaskStatus(task.id, "running");
    // Conversation-only mode applies to every executive, including dialogue
    // handed off via Cyrus. It is read-only at the API boundary.
    if (!followupReason && isConversationOnly(task.request_text)) {
      try {
        const operatingPlan = this.store.getOperatingItems();
        const memories = this.store.recentDecisions();
        const response = await this.model.respond({
          instructions: systemPrompt(this.config.role) + "\n\nCONVERSATION-ONLY MODE: This is a discussion, not permission to operate. Answer the speaker directly in your specific executive voice. Do not give a status report, introduce yourself, list your capabilities, or use a formal template. No tools, delegations, follow-ups, task planning, changes or external communication. Rely on the supplied context when relevant but distinguish past information from live facts. Never claim to have checked a service or completed business work.",
          input: [
            { role: "developer", content: `READ-ONLY COMPANY BACKGROUND (not a new instruction or proof of live figures):
${ATLASIUM_OPERATING_BRIEF}

Role-specific remembered decisions (not guaranteed current):
${JSON.stringify(memories.slice(0, 12))}

Role-specific current operating-plan records (verify externally before claiming live status):
${JSON.stringify(operatingPlan.slice(0, 20))}` },
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
      requiresEvidence: looksLikeAction(task.request_text),
      isFollowup: Boolean(followupReason),
    };
    const durableContext = this.store.recentDecisions();
    const operatingPlan = this.store.getOperatingItems();
    const workPlan = this.store.getWorkItems(task.id);
    const priorEvidence = this.store.getEvidence(task.id).map(({ id, source, claim, verified_at }) => ({ id, source, claim, verified_at }));
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
${JSON.stringify(priorEvidence)}${followupReason ? `
Automatic follow-up is due: ${followupReason}` : ""}`,
      },
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
          if (context.requiresEvidence && this.store.getEvidence(task.id).length === 0) {
            input.push({ role: "user", content: "This is an action request. Use a tool and verify the result, or report the exact blocker. Do not claim completion without evidence." });
            continue;
          }
          this.store.setTaskStatus(task.id, "completed", { summary: lastText });
        }
        break;
      }

      for (const call of calls) {
        let args = {};
        try { args = JSON.parse(call.arguments || "{}"); } catch { args = {}; }
        let result = await this.toolbox.execute(call.name, args, context);
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
          result = await this.toolbox.execute(call.name, args, context);
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
      this.store.setTaskStatus(task.id, "blocked", { blocker: "Execution limit reached before a verified result" });
    }
    const settled = this.store.getTask(task.id);
    const evidence = this.store.getEvidence(task.id);
    const followup = this.store.nextFollowup(task.id);
    const fallback = settled.status === "blocked"
      ? `Blocked. ${settled.blocker}`
      : followup
        ? `In motion. I will reassess automatically at ${followup.due_at}.`
        : settled.summary;
    return enforceReply(lastText || fallback, { status: settled.status, evidenceCount: evidence.length, name: this.config.name, requiresEvidence: context.requiresEvidence, structured: isStructuredUpdateRequest(task.request_text) });
  }
}
