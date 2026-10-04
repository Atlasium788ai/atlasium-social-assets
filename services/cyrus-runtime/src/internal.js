import http from "node:http";

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("payload_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

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

export function createInternalServer({ config, store, agent, logger = console }) {
  return http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/handoff") {
      send(response, 404, { ok: false, error: "not_found" });
      return;
    }
    try {
      const body = await readJson(request);
      const from = String(body.from || "").toLowerCase();
      const to = String(body.to || "").toLowerCase();
      const id = String(body.id || "").trim();
      const message = String(body.message || "").trim();
      if (request.headers["x-atlasium-source"] !== from) throw new Error("source_header_mismatch");
      if (!Object.hasOwn(config.agentPeers, from)) throw new Error("source_not_connected");
      if (to !== config.role) throw new Error("wrong_target");
      if (!id || id.length > 128 || !message || message.length > 12_000) throw new Error("invalid_handoff");

      const sourceEventId = `handoff:${from}:${id}`;
      const existing = store.getTaskBySourceEvent(sourceEventId);
      if (existing) {
        send(response, 200, snapshot(store, existing));
        return;
      }
      const { task } = store.createTask({
        sourceEventId,
        requesterId: `agent:${from}`,
        channelId: `internal:${from}`,
        requestText: `Internal handoff from ${from}: ${message}`,
      });
      const reply = await agent.handleTask(task);
      const settled = store.getTask(task.id);
      send(response, 200, { ...snapshot(store, settled), reply });
    } catch (error) {
      logger.error(`${config.name} internal handoff failed`, { message: error.message });
      const clientError = /^(payload_too_large|source_header_mismatch|source_not_connected|wrong_target|invalid_handoff)$/.test(error.message);
      send(response, clientError ? 400 : 500, { ok: false, error: error.message });
    }
  });
}
