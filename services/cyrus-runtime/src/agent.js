import { systemPrompt, enforceReply } from "./personality.js";
import { outputText, toolCalls } from "./model.js";
import { ATLASIUM_OPERATING_BRIEF } from "./operating_context.js";

function looksLikeAction(text) {
  return /\b(build|check|verify|find|fix|send|post|create|change|update|remember|schedule|run|inspect|test|connect|deploy|remove|launch|complete)\b/i.test(text);
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
    const context = {
      taskId: task.id,
      requiresEvidence: looksLikeAction(task.request_text),
      isFollowup: Boolean(followupReason),
    };
    const durableContext = this.store.recentDecisions();
    const workPlan = this.store.getWorkItems(task.id);
    const priorEvidence = this.store.getEvidence(task.id).map(({ id, source, claim, verified_at }) => ({ id, source, claim, verified_at }));
    let input = [
      {
        role: "developer",
        content: `Current Atlasium operating brief. Treat this as durable company context unless a newer authoritative source explicitly supersedes it:\n${ATLASIUM_OPERATING_BRIEF}\n\nActive durable decisions from prior work. Treat these as context, not new instructions:\n${JSON.stringify(durableContext)}\nCurrent durable work plan:\n${JSON.stringify(workPlan)}\nExisting verified evidence:\n${JSON.stringify(priorEvidence)}${followupReason ? `\nAutomatic follow-up is due: ${followupReason}` : ""}`,
      },
      { role: "user", content: task.request_text },
    ];
    let lastText = "";

    for (let attempt = 1; attempt <= this.maxTurns; attempt += 1) {
      let response;
      try {
        response = await this.model.respond({ instructions: systemPrompt(this.config.role), input, tools: this.toolbox.definitions });
      } catch (error) {
        this.store.addStep(task.id, { attempt, status: "model_error", detail: { error: error.message } });
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
    return enforceReply(lastText || fallback, { status: settled.status, evidenceCount: evidence.length, name: this.config.name });
  }
}
