// Persist incoming work before returning to a busy caller. The existing durable
// follow-up worker executes it when the executive is free, including after restart.
export async function receiveHandoff({ config, store, agent, from, id, message, mode = "task", defer = false }) {
  const snapshot = (task) => ({
    ok: true,
    taskId: task.id,
    status: task.status,
    summary: task.summary || null,
    blocker: task.blocker || null,
    evidenceCount: store.getEvidence(task.id).length,
    queued: task.status === "received",
  });
  const sourceEventId = `handoff:${from}:${id}`;
  const existing = store.getTaskBySourceEvent(sourceEventId);
  if (existing) return snapshot(existing);
  const busy = Boolean(agent.isBusy?.());
  if (busy && mode === "conversation") {
    return { ok: false, status: "busy", retryable: true, error: `${config.name} is executing another objective; retry the conversation later` };
  }
  if ((busy || defer) && store.health().openTasks >= 50) {
    return { ok: false, status: "busy", retryable: true, error: `${config.name}'s incoming work queue is full; retry later` };
  }
  const { task } = store.createTask({
    sourceEventId,
    requesterId: `agent:${from}`,
    // Independent incoming assignments must not supersede each other.
    channelId: `internal:${from}:${id}`,
    requestText: `Internal handoff from ${from}: ${mode === "conversation" ? "CONVERSATION-ONLY: " : ""}${message}`,
  });
  if (busy || (defer && mode === "task")) {
    store.scheduleFollowup(task.id, {
      dueAt: new Date(Date.now() + 15_000).toISOString(),
      reason: "Incoming handoff was durably queued for deferred execution. Execute the original assignment now; queue acceptance was not completion evidence.",
    });
    return { ...snapshot(task), retryAfterSeconds: 15 };
  }
  const reply = await agent.handleTask(task);
  return { ...snapshot(store.getTask(task.id)), reply };
}
