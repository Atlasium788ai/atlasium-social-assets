const ROLE_DIRECTIVES = Object.freeze({
  cyrus: "Coordinate the executive team. Find the highest-leverage company bottleneck, route concrete work to the correct executive, consolidate results, and represent Sloane's legal/compliance/people work in Slack.",
  malik: "Move legitimate revenue from opportunity to conversation, meeting, proposal, and cash. Work existing intent and follow-ups first. Instantly is unavailable; never send email until ReeVIQ access and every Microsoft 365 consent, suppression, sender, unsubscribe, tracking, and approval gate pass.",
  clara: "Protect Blair's attention and force operational closure. Reconcile commitments, owners, dates, dependencies, and dropped balls; route department work through Cyrus and keep only decision-grade updates.",
  mateo: "Create measurable demand with truthful positioning and useful content. Identify the next evidence-backed marketing asset or experiment, route required execution through Cyrus, and never publish or contact prospects without an approved tool and authority.",
  kenji: "Remove the most important product or engineering bottleneck. Inspect evidence, define the smallest safe executable change, route cross-functional needs through Cyrus, and do not deploy production without explicit authority.",
  amara: "Protect activation, delivery quality, retention, and expansion. Find the most important onboarding or client-success risk, establish the next owner/action/evidence, and route cross-functional work through Cyrus.",
  nadia: "Protect cash, runway, collections, and financial accuracy. Reconcile claims to source evidence, surface the highest-value financial next action, and never spend, move money, or accept terms without explicit authority.",
  sloane: "Protect legal, compliance, people, and reputation while keeping execution moving. Resolve what can be resolved from evidence; route only genuine decisions or approvals to Cyrus, who represents Sloane in Slack.",
});

export function relentlessPrompt(config) {
  const directive = ROLE_DIRECTIVES[config.role];
  if (!directive) throw new Error(`No relentless directive for ${config.role}`);
  return [
    `RELENTLESS ${String(config.department || config.role).toUpperCase()} EXECUTION TICK.`,
    directive,
    "Inspect durable memory, open operating context, and available connected evidence before deciding.",
    "Take the next safe executable action now. Use a connected tool when it can materially advance or verify the objective.",
    "When another executive owns the next action, hand off through Cyrus with a concrete objective, evidence requirement, and definition of done.",
    "Do not manufacture activity, repeat a known failed call, or send routine status chatter to Blair. Preserve the open loop and schedule a bounded follow-up when work cannot finish in this cycle.",
    "Never bypass consent, suppression, privacy, security, legal, spending, production-deployment, or human-approval gates.",
    "Completion requires evidence. If genuinely blocked, record the exact blocker, recovery already attempted, and the single human action required.",
  ].join(" ");
}

export function createRelentlessController({ runtime, logger = console, now = () => Date.now() }) {
  const { config, store, agent } = runtime;
  let timer = null;
  let initialTimer = null;
  let busy = false;
  let lastStartedAt = null;
  let lastFinishedAt = null;
  let lastStatus = null;
  let lastError = null;

  async function run() {
    if (!config.autonomyEnabled || busy) return { skipped: true, reason: config.autonomyEnabled ? "busy" : "disabled" };
    if (agent.isBusy?.()) return { skipped: true, reason: "agent_busy" };
    const health = store.health();
    if (health.openTasks > 0) return { skipped: true, reason: "open_tasks", openTasks: health.openTasks };
    busy = true;
    const intervalMs = Math.max(15 * 60_000, Number(config.relentlessIntervalMs || 60 * 60_000));
    const bucket = Math.floor(now() / intervalMs);
    const generation = String(config.relentlessGeneration || "v1").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "v1";
    const sourceEventId = `relentless:${config.role}:${generation}:${bucket}`;
    let task = null;
    try {
      const existing = store.getTaskBySourceEvent(sourceEventId);
      if (existing) return { skipped: true, reason: "deduplicated", taskId: existing.id };
      ({ task } = store.createTask({
        sourceEventId,
        requesterId: "system:relentless",
        channelId: `internal:relentless:${config.role}`,
        requestText: relentlessPrompt(config),
      }));
      lastStartedAt = new Date(now()).toISOString();
      logger.info(JSON.stringify({ event: "relentless_tick_start", role: config.role, taskId: task.id, intervalMs }));
      const reply = await agent.handleTask(task);
      const settled = store.getTask(task.id);
      const evidenceCount = store.getEvidence(task.id).length;
      lastFinishedAt = new Date(now()).toISOString();
      lastStatus = settled.status;
      lastError = null;
      logger.info(JSON.stringify({
        event: "relentless_tick_result",
        role: config.role,
        taskId: task.id,
        status: settled.status,
        evidenceCount,
        reply: String(reply || "").slice(0, 300),
      }));
      return { skipped: false, taskId: task.id, status: settled.status, evidenceCount };
    } catch (error) {
      lastFinishedAt = new Date(now()).toISOString();
      lastError = error.message;
      if (task && store.getTask(task.id)?.status === "running") {
        store.setTaskStatus(task.id, "blocked", { blocker: `Execution failed safely: ${error.message}` });
      }
      logger.error(JSON.stringify({ event: "relentless_tick_failed", role: config.role, error: error.message }));
      return { skipped: false, error: error.message };
    } finally {
      busy = false;
    }
  }

  function start(initialDelayMs = 20_000) {
    if (!config.autonomyEnabled || timer) return;
    const intervalMs = Math.max(15 * 60_000, Number(config.relentlessIntervalMs || 60 * 60_000));
    timer = setInterval(() => void run(), intervalMs);
    timer.unref();
    initialTimer = setTimeout(() => void run(), Math.max(0, Number(initialDelayMs) || 0));
    initialTimer.unref();
    logger.info(JSON.stringify({ event: "relentless_controller_started", role: config.role, intervalMs, initialDelayMs }));
  }

  function stop() {
    if (timer) clearInterval(timer);
    if (initialTimer) clearTimeout(initialTimer);
    timer = null;
    initialTimer = null;
  }

  function state() {
    return { enabled: Boolean(config.autonomyEnabled), busy, lastStartedAt, lastFinishedAt, lastStatus, lastError };
  }

  return { run, start, stop, state };
}
