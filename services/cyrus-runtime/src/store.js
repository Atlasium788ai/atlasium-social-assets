import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const SCHEMA_VERSION = 1;

export class CyrusStore {
  constructor(databasePath) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS slack_events (
        event_id TEXT PRIMARY KEY,
        received_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        source_event_id TEXT NOT NULL UNIQUE,
        requester_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        request_text TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('received','running','blocked','completed','failed')),
        summary TEXT,
        blocker TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        attempt INTEGER NOT NULL,
        tool_name TEXT,
        status TEXT NOT NULL,
        detail_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        claim TEXT NOT NULL,
        detail_json TEXT NOT NULL,
        verified_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        decision TEXT NOT NULL,
        rationale TEXT NOT NULL,
        source_task_id TEXT REFERENCES tasks(id),
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reply_outbox (
        task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','sent')) DEFAULT 'pending',
        slack_ts TEXT,
        created_at TEXT NOT NULL,
        sent_at TEXT
      );
      CREATE INDEX IF NOT EXISTS decisions_topic_idx ON decisions(topic, active, created_at);
      INSERT INTO schema_meta(key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')
      ON CONFLICT(key) DO UPDATE SET value=excluded.value;
    `);
  }

  close() {
    this.db.close();
  }

  health() {
    const row = this.db.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get();
    const openTasks = this.db.prepare("SELECT count(*) AS count FROM tasks WHERE status IN ('received','running')").get();
    return { schemaVersion: Number(row.value), openTasks: Number(openTasks.count) };
  }

  acceptSlackEvent(eventId, payload) {
    const result = this.db.prepare(
      "INSERT OR IGNORE INTO slack_events(event_id, received_at, payload_json) VALUES (?, ?, ?)"
    ).run(eventId, new Date().toISOString(), JSON.stringify(payload));
    return result.changes === 1;
  }

  createTask({ sourceEventId, requesterId, channelId, requestText }) {
    const existing = this.db.prepare("SELECT * FROM tasks WHERE source_event_id = ?").get(sourceEventId);
    if (existing) return { task: existing, created: false };
    const now = new Date().toISOString();
    const task = {
      id: randomUUID(),
      source_event_id: sourceEventId,
      requester_id: requesterId,
      channel_id: channelId,
      request_text: requestText,
      status: "received",
      summary: null,
      blocker: null,
      created_at: now,
      updated_at: now,
    };
    this.db.prepare(`
      INSERT INTO tasks(id, source_event_id, requester_id, channel_id, request_text, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(task.id, sourceEventId, requesterId, channelId, requestText, task.status, now, now);
    return { task, created: true };
  }

  getTask(taskId) {
    return this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  }

  pendingTasks() {
    return this.db.prepare("SELECT * FROM tasks WHERE status = 'received' ORDER BY created_at").all();
  }

  setTaskStatus(taskId, status, { summary = null, blocker = null } = {}) {
    this.db.prepare(`
      UPDATE tasks SET status = ?, summary = COALESCE(?, summary), blocker = ?, updated_at = ? WHERE id = ?
    `).run(status, summary, blocker, new Date().toISOString(), taskId);
  }

  addStep(taskId, { attempt, toolName = null, status, detail }) {
    this.db.prepare(`
      INSERT INTO task_steps(task_id, attempt, tool_name, status, detail_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(taskId, attempt, toolName, status, JSON.stringify(detail), new Date().toISOString());
  }

  addEvidence(taskId, { source, claim, detail }) {
    const evidence = { id: randomUUID(), source, claim, detail, verifiedAt: new Date().toISOString() };
    this.db.prepare(`
      INSERT INTO evidence(id, task_id, source, claim, detail_json, verified_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(evidence.id, taskId, source, claim, JSON.stringify(detail), evidence.verifiedAt);
    return evidence;
  }

  getEvidence(taskId) {
    return this.db.prepare("SELECT * FROM evidence WHERE task_id = ? ORDER BY verified_at").all(taskId);
  }

  rememberDecision({ topic, decision, rationale, sourceTaskId }) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE decisions SET active = 0 WHERE topic = ? AND active = 1").run(topic);
      const row = { id: randomUUID(), topic, decision, rationale, sourceTaskId, createdAt: new Date().toISOString() };
      this.db.prepare(`
        INSERT INTO decisions(id, topic, decision, rationale, source_task_id, active, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `).run(row.id, topic, decision, rationale, sourceTaskId, row.createdAt);
      this.db.exec("COMMIT");
      return row;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  recallDecisions(query, limit = 8) {
    return this.db.prepare(`
      SELECT id, topic, decision, rationale, source_task_id, created_at
      FROM decisions
      WHERE active = 1 AND (topic LIKE ? OR decision LIKE ? OR rationale LIKE ?)
      ORDER BY created_at DESC LIMIT ?
    `).all(`%${query}%`, `%${query}%`, `%${query}%`, Math.min(limit, 20));
  }

  recentDecisions(limit = 12) {
    return this.db.prepare(`
      SELECT topic, decision, rationale, created_at
      FROM decisions WHERE active = 1
      ORDER BY created_at DESC LIMIT ?
    `).all(Math.min(limit, 20));
  }

  recoverInterruptedTasks() {
    const rows = this.db.prepare("SELECT id FROM tasks WHERE status = 'running'").all();
    const update = this.db.prepare("UPDATE tasks SET status='received', updated_at=? WHERE id=?");
    const now = new Date().toISOString();
    for (const row of rows) update.run(now, row.id);
    return rows.length;
  }

  queueReply(taskId, channelId, body) {
    this.db.prepare(`
      INSERT INTO reply_outbox(task_id, channel_id, body, status, created_at)
      VALUES (?, ?, ?, 'pending', ?)
      ON CONFLICT(task_id) DO UPDATE SET
        channel_id=excluded.channel_id,
        body=excluded.body,
        status=CASE WHEN reply_outbox.status='sent' THEN 'sent' ELSE 'pending' END
    `).run(taskId, channelId, body, new Date().toISOString());
  }

  pendingReplies() {
    return this.db.prepare("SELECT * FROM reply_outbox WHERE status='pending' ORDER BY created_at").all();
  }

  markReplySent(taskId, slackTs) {
    this.db.prepare("UPDATE reply_outbox SET status='sent', slack_ts=?, sent_at=? WHERE task_id=?")
      .run(slackTs || null, new Date().toISOString(), taskId);
  }
}
