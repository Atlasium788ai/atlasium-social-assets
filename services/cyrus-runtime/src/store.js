import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const SCHEMA_VERSION = 5;

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
      CREATE TABLE IF NOT EXISTS reply_outbox_messages (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','sent')) DEFAULT 'pending',
        slack_ts TEXT,
        created_at TEXT NOT NULL,
        sent_at TEXT
      );
      CREATE TABLE IF NOT EXISTS work_items (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        owner TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('planned','running','blocked','completed')),
        depends_on TEXT,
        evidence_id TEXT REFERENCES evidence(id),
        next_action_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS followups (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        due_at TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','claimed','completed')) DEFAULT 'pending',
        created_at TEXT NOT NULL,
        claimed_at TEXT,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS operating_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        owner TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('planned','running','blocked','completed')),
        priority INTEGER NOT NULL DEFAULT 3,
        next_action TEXT,
        next_action_at TEXT,
        evidence_summary TEXT,
        source_task_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS work_products (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status='draft'),
        revision INTEGER NOT NULL DEFAULT 1,
        source_task_id TEXT NOT NULL REFERENCES tasks(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS email_suppressions (
        email_hash TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        evidence_reference TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outbound_email_attempts (
        idempotency_key TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        recipient_hash TEXT NOT NULL,
        source_lead_id TEXT NOT NULL,
        subject_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('reserved','sending','accepted','blocked','failed','unknown')),
        consent_basis TEXT NOT NULL,
        consent_evidence TEXT NOT NULL,
        approval_reference TEXT NOT NULL,
        provider_request_id TEXT,
        detail_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        accepted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS decisions_topic_idx ON decisions(topic, active, created_at);
      CREATE INDEX IF NOT EXISTS work_items_task_idx ON work_items(task_id, status, created_at);
      CREATE INDEX IF NOT EXISTS followups_due_idx ON followups(status, due_at);
      CREATE INDEX IF NOT EXISTS reply_outbox_messages_status_idx ON reply_outbox_messages(status, created_at);
      CREATE INDEX IF NOT EXISTS operating_items_status_priority_idx ON operating_items(status, priority, updated_at);
      CREATE INDEX IF NOT EXISTS outbound_email_status_created_idx ON outbound_email_attempts(status, created_at);
      CREATE INDEX IF NOT EXISTS outbound_email_recipient_idx ON outbound_email_attempts(recipient_hash, created_at);
      INSERT INTO schema_meta(key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')
      ON CONFLICT(key) DO UPDATE SET value=excluded.value;
    `);
    const now = new Date().toISOString();
    const seedOperatingItem = this.db.prepare(`
      INSERT OR IGNORE INTO operating_items(id, title, owner, status, priority, next_action, created_at, updated_at)
      VALUES (?, ?, ?, 'running', ?, ?, ?, ?)
    `);
    seedOperatingItem.run(
      "q4-revenue-2026",
      "Reach 25 paying customers by January 2, 2027",
      "Cyrus + Malik",
      1,
      "Move Outreach -> Conversations -> Assessments -> Meetings -> Proposals -> Cash using live evidence.",
      now,
      now
    );
    seedOperatingItem.run(
      "meetings-and-cash-engine",
      "Book meetings and put collected revenue in the bank",
      "Cyrus + Malik + revenue team",
      1,
      "Prioritize live replies, meetings, proposals and payment. Use approved Q4 outbound and follow-up without waiting for Blair on routine execution; require evidence of movement.",
      now,
      now
    );
    seedOperatingItem.run(
      "command88-safe-outbound",
      "Prove and operate the current Command88 revenue loop end-to-end",
      "Malik",
      1,
      "Maintain a clean verified pilot, confirm send readiness, then advance only within approved outbound controls.",
      now,
      now
    );
    seedOperatingItem.run(
      "company-continuity",
      "Maintain Atlasium company context, priorities, owners, metrics, and open loops",
      "Cyrus",
      1,
      "Keep the operating brief, durable decisions, and operating plan current before asking Blair for recoverable information.",
      now,
      now
    );
    seedOperatingItem.run(
      "instantly-import-reconciliation",
      "Resolve Command88 Instantly accepted-but-not-visible lead imports",
      "Malik",
      1,
      "Reconcile the draft pilot inventory before further staging. Do not retry accepted-but-not-visible emails or infer capacity from the visible count alone.",
      now,
      now
    );
    seedOperatingItem.run(
      "q4-revenue-leadership",
      "Operate Q4 revenue without routine dependence on Blair",
      "Tayo + Cody + Cyrus",
      1,
      "Tayo drives Q4 revenue execution inside approved economics; Cody owns live sales conversion; Cyrus keeps the operating system moving and escalates only true executive exceptions.",
      now,
      now
    );
    seedOperatingItem.run(
      "q4-team-enablement",
      "Complete sales and product training needed for aggressive Q4 execution",
      "Cyrus + Clara + department owners",
      3,
      "Ensure the team understands the Revenue Leak Assessment, sales process, tools, offer-selection logic, and current Q4 campaign periods.",
      now,
      now
    );

    const legacy = this.db.prepare("SELECT * FROM reply_outbox WHERE status='pending'").all();
    const migrateReply = this.db.prepare(`
      INSERT OR IGNORE INTO reply_outbox_messages(id, task_id, channel_id, body, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `);
    for (const reply of legacy) migrateReply.run(`legacy:${reply.task_id}`, reply.task_id, reply.channel_id, reply.body, reply.created_at);
  }

  close() {
    this.db.close();
  }

  health() {
    const row = this.db.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get();
    const openTasks = this.db.prepare("SELECT count(*) AS count FROM tasks WHERE status IN ('received','running')").get();
    const openWorkItems = this.db.prepare(`
      SELECT count(*) AS count
      FROM work_items w
      JOIN tasks t ON t.id=w.task_id
      WHERE w.status!='completed' AND t.status IN ('received','running')
    `).get();
    const pendingFollowups = this.db.prepare("SELECT count(*) AS count FROM followups WHERE status = 'pending'").get();
    const outboundUnknown = this.db.prepare("SELECT count(*) AS count FROM outbound_email_attempts WHERE status = 'unknown'").get();
    return {
      schemaVersion: Number(row.value),
      openTasks: Number(openTasks.count),
      openWorkItems: Number(openWorkItems.count),
      pendingFollowups: Number(pendingFollowups.count),
      outboundUnknown: Number(outboundUnknown.count),
      savedDrafts: Number(this.db.prepare("SELECT count(*) AS count FROM work_products").get().count),
    };
  }

  saveWorkProduct({ id, title, content, sourceTaskId }) {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO work_products(id, title, content, source_task_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        revision=work_products.revision + CASE WHEN work_products.content!=excluded.content OR work_products.title!=excluded.title THEN 1 ELSE 0 END,
        title=excluded.title, content=excluded.content, source_task_id=excluded.source_task_id, updated_at=excluded.updated_at
    `).run(id, title, content, sourceTaskId, now, now);
    return this.db.prepare("SELECT * FROM work_products WHERE id=?").get(id);
  }

  listWorkProducts(limit = 5) {
    return this.db.prepare("SELECT * FROM work_products ORDER BY updated_at DESC, id LIMIT ?").all(Math.max(1, Math.min(10, Number(limit) || 5)));
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

    // Only recurring pulses replace their own obsolete pulse, never DMs or handoffs.
    if (requesterId === "system:relentless" && String(channelId || "").startsWith("internal:relentless:")) {
      const superseded = this.db.prepare(`
        SELECT id FROM tasks
        WHERE channel_id=? AND status IN ('received','running')
      `).all(channelId);
      const closeTask = this.db.prepare("UPDATE tasks SET status='failed', blocker='Superseded by newer internal objective', updated_at=? WHERE id=?");
      const closeItems = this.db.prepare("UPDATE work_items SET status='completed', updated_at=? WHERE task_id=? AND status!='completed'");
      const closeFollowups = this.db.prepare("UPDATE followups SET status='completed', completed_at=? WHERE task_id=? AND status!='completed'");
      for (const row of superseded) {
        closeTask.run(now, row.id);
        closeItems.run(now, row.id);
        closeFollowups.run(now, row.id);
      }
    }
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

  recentConversation(taskId) {
    const task = this.getTask(taskId);
    // Only the current requester's own DM, never another role/channel or an
    // internal handoff. rowid gives stable ordering even for equal timestamps.
    if (!task?.channel_id?.startsWith("D")) return [];
    const rows = this.db.prepare(`
      SELECT t.request_text, (
        SELECT r.body FROM reply_outbox_messages r
        WHERE r.task_id=t.id AND r.channel_id=t.channel_id AND r.status='sent'
        ORDER BY r.rowid DESC LIMIT 1
      ) AS reply
      FROM tasks t
      WHERE t.channel_id=? AND t.requester_id=?
        AND t.rowid < (SELECT rowid FROM tasks WHERE id=?)
        AND julianday(t.created_at) >= julianday('now', '-1 day')
      ORDER BY t.rowid DESC LIMIT 8
    `).all(task.channel_id, task.requester_id, taskId).reverse();
    return rows.flatMap(row => [
      { role: "user", content: row.request_text.slice(0, 1200) },
      ...(row.reply ? [{ role: "assistant", content: row.reply.slice(0, 1200) }] : []),
    ]);
  }

  recentWorkStatus(excludeTaskId) {
    return this.db.prepare(`
      SELECT request_text, status, summary, blocker, updated_at FROM tasks
      WHERE id!=? AND (channel_id LIKE 'internal:%' OR channel_id=(SELECT channel_id FROM tasks WHERE id=?))
      ORDER BY CASE WHEN status IN ('received','running') THEN 0 ELSE 1 END, rowid DESC LIMIT 5
    `).all(excludeTaskId, excludeTaskId).map(row => ({ ...row,
      request_text: row.request_text.slice(0, 500),
      summary: row.summary?.slice(0, 500), blocker: row.blocker?.slice(0, 300),
    }));
  }

  getTaskBySourceEvent(sourceEventId) {
    return this.db.prepare("SELECT * FROM tasks WHERE source_event_id = ?").get(sourceEventId);
  }

  pendingTasks() {
    return this.db.prepare(`
      SELECT t.* FROM tasks t
      WHERE t.status = 'received'
        AND NOT EXISTS (SELECT 1 FROM followups f WHERE f.task_id=t.id AND f.status='pending')
      ORDER BY t.created_at
    `).all();
  }

  setTaskStatus(taskId, status, { summary = null, blocker = null } = {}) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE tasks SET status = ?, summary = COALESCE(?, summary), blocker = ?, updated_at = ? WHERE id = ?
    `).run(status, summary, blocker, now, taskId);
    if (["completed", "blocked", "failed"].includes(status)) {
      this.db.prepare("UPDATE work_items SET status='completed', updated_at=? WHERE task_id=? AND status!='completed'").run(now, taskId);
      this.db.prepare("UPDATE followups SET status='completed', completed_at=? WHERE task_id=? AND status!='completed'").run(now, taskId);
    }
  }

  latestTaskBySourcePrefix(prefix) {
    return this.db.prepare(`
      SELECT * FROM tasks
      WHERE source_event_id LIKE ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(`${String(prefix || "")}%`);
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

  getEvidenceById(taskId, evidenceId) {
    return this.db.prepare("SELECT * FROM evidence WHERE task_id = ? AND id = ?").get(taskId, evidenceId);
  }

  createWorkPlan(taskId, items) {
    const insert = this.db.prepare(`
      INSERT INTO work_items(id, task_id, title, owner, status, depends_on, next_action_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'planned', ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    const created = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const item of items.slice(0, 20)) {
        const requestedId = item.id?.trim() || randomUUID();
        const requestedDependency = item.depends_on?.trim() || null;
        const sameTask = this.db.prepare("SELECT * FROM work_items WHERE task_id=? AND id=? LIMIT 1").get(taskId, requestedId);
        if (sameTask) {
          this.db.prepare("UPDATE work_items SET title=?, owner=?, depends_on=?, next_action_at=?, updated_at=? WHERE task_id=? AND id=?")
            .run(item.title.trim(), item.owner.trim(), requestedDependency, item.next_action_at?.trim() || sameTask.next_action_at || null, now, taskId, requestedId);
          created.push({ id: requestedId, title: item.title.trim(), owner: item.owner.trim(), dependsOn: requestedDependency, nextActionAt: item.next_action_at?.trim() || sameTask.next_action_at || null, reused: true });
          continue;
        }
        const collision = this.db.prepare("SELECT 1 FROM work_items WHERE id=? LIMIT 1").get(requestedId);
        const actualId = collision ? `${requestedId}:${randomUUID()}` : requestedId;
        const row = {
          id: actualId,
          title: item.title.trim(),
          owner: item.owner.trim(),
          dependsOn: requestedDependency,
          nextActionAt: item.next_action_at?.trim() || null,
        };
        insert.run(row.id, taskId, row.title, row.owner, row.dependsOn, row.nextActionAt, now, now);
        created.push(row);
      }
      this.db.exec("COMMIT");
      return created;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getWorkItems(taskId) {
    return this.db.prepare("SELECT * FROM work_items WHERE task_id=? ORDER BY created_at, id").all(taskId);
  }

  openWorkItems(taskId) {
    return this.db.prepare("SELECT * FROM work_items WHERE task_id=? AND status!='completed' ORDER BY created_at, id").all(taskId);
  }

  updateWorkItem(taskId, itemId, { status, evidenceId = null, nextActionAt = null }) {
    if (status === "completed" && !evidenceId) throw new Error("Completed work requires evidence_id");
    if (evidenceId && !this.getEvidenceById(taskId, evidenceId)) throw new Error("Evidence does not belong to this task");
    const result = this.db.prepare(`
      UPDATE work_items SET status=?, evidence_id=?, next_action_at=?, updated_at=?
      WHERE task_id=? AND id=?
    `).run(status, evidenceId, nextActionAt, new Date().toISOString(), taskId, itemId);
    if (result.changes !== 1) throw new Error("Unknown work item");
    return this.db.prepare("SELECT * FROM work_items WHERE task_id=? AND id=?").get(taskId, itemId);
  }

  scheduleFollowup(taskId, { dueAt, reason }) {
    const row = { id: randomUUID(), dueAt, reason, createdAt: new Date().toISOString() };
    this.db.prepare(`
      INSERT INTO followups(id, task_id, due_at, reason, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(row.id, taskId, dueAt, reason, row.createdAt);
    return row;
  }

  hasPendingFollowup(taskId) {
    return Boolean(this.db.prepare("SELECT 1 FROM followups WHERE task_id=? AND status='pending' LIMIT 1").get(taskId));
  }

  nextFollowup(taskId) {
    return this.db.prepare("SELECT * FROM followups WHERE task_id=? AND status='pending' ORDER BY due_at LIMIT 1").get(taskId);
  }

  continuationCount(taskId) {
    return Number(this.db.prepare("SELECT count(*) AS n FROM task_steps WHERE task_id=? AND status='continuation_scheduled'").get(taskId).n);
  }

  recentToolReceipts(taskId) {
    return this.db.prepare("SELECT tool_name, status, detail_json FROM task_steps WHERE task_id=? AND tool_name IS NOT NULL ORDER BY id DESC LIMIT 8")
      .all(taskId).reverse().map(row => ({ tool: row.tool_name, status: row.status, detail: row.detail_json.slice(0, 1600) }));
  }

  claimDueFollowups(now = new Date().toISOString(), limit = 5) {
    const rows = this.db.prepare("SELECT * FROM followups WHERE status='pending' AND due_at<=? ORDER BY due_at LIMIT ?").all(now, limit);
    const claim = this.db.prepare("UPDATE followups SET status='claimed', claimed_at=? WHERE id=? AND status='pending'");
    return rows.filter((row) => claim.run(new Date().toISOString(), row.id).changes === 1);
  }

  completeFollowup(id) {
    this.db.prepare("UPDATE followups SET status='completed', completed_at=? WHERE id=?").run(new Date().toISOString(), id);
  }

  releaseFollowup(id, delayMs = 30_000) {
    this.db.prepare("UPDATE followups SET status='pending', due_at=?, claimed_at=NULL WHERE id=?")
      .run(new Date(Date.now() + delayMs).toISOString(), id);
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

  suppressEmail({ emailHash, reason, evidenceReference }) {
    if (!emailHash || !reason || !evidenceReference) throw new Error("Suppression requires email hash, reason, and evidence reference");
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO email_suppressions(email_hash, reason, evidence_reference, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(email_hash) DO UPDATE SET
        reason=excluded.reason,
        evidence_reference=excluded.evidence_reference,
        created_at=excluded.created_at
    `).run(emailHash, reason, evidenceReference, now);
    return this.db.prepare("SELECT * FROM email_suppressions WHERE email_hash=?").get(emailHash);
  }

  getEmailSuppression(emailHash) {
    return this.db.prepare("SELECT * FROM email_suppressions WHERE email_hash=?").get(emailHash);
  }

  reserveOutboundEmail({ idempotencyKey, taskId, provider, recipientHash, sourceLeadId, subjectHash, consentBasis, consentEvidence, approvalReference }) {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO outbound_email_attempts(
        idempotency_key, task_id, provider, recipient_hash, source_lead_id, subject_hash,
        status, consent_basis, consent_evidence, approval_reference, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?)
    `).run(idempotencyKey, taskId, provider, recipientHash, sourceLeadId, subjectHash, consentBasis, consentEvidence, approvalReference, now, now);
    return {
      created: result.changes === 1,
      row: this.db.prepare("SELECT * FROM outbound_email_attempts WHERE idempotency_key=?").get(idempotencyKey),
    };
  }

  updateOutboundEmail(idempotencyKey, { status, providerRequestId = null, detail = {} }) {
    const now = new Date().toISOString();
    const acceptedAt = status === "accepted" ? now : null;
    const result = this.db.prepare(`
      UPDATE outbound_email_attempts
      SET status=?, provider_request_id=COALESCE(?, provider_request_id), detail_json=?, updated_at=?,
          accepted_at=COALESCE(?, accepted_at)
      WHERE idempotency_key=?
    `).run(status, providerRequestId, JSON.stringify(detail), now, acceptedAt, idempotencyKey);
    if (result.changes !== 1) throw new Error("Unknown outbound email attempt");
    return this.db.prepare("SELECT * FROM outbound_email_attempts WHERE idempotency_key=?").get(idempotencyKey);
  }

  getOutboundEmail(idempotencyKey) {
    return this.db.prepare("SELECT * FROM outbound_email_attempts WHERE idempotency_key=?").get(idempotencyKey);
  }

  outboundAcceptedCount(sinceIso) {
    const row = this.db.prepare("SELECT count(*) AS count FROM outbound_email_attempts WHERE status='accepted' AND accepted_at>=?").get(sinceIso);
    return Number(row.count);
  }

  getOperatingItems({ includeCompleted = false, limit = 50 } = {}) {
    const sql = includeCompleted
      ? "SELECT * FROM operating_items ORDER BY priority ASC, updated_at DESC LIMIT ?"
      : "SELECT * FROM operating_items WHERE status != 'completed' ORDER BY priority ASC, updated_at DESC LIMIT ?";
    return this.db.prepare(sql).all(Math.min(Math.max(Number(limit) || 50, 1), 100));
  }

  upsertOperatingItem({ id, title, owner, status = "running", priority = 3, nextAction = null, nextActionAt = null, evidenceSummary = null, sourceTaskId = null }) {
    const now = new Date().toISOString();
    const existing = this.db.prepare("SELECT * FROM operating_items WHERE id = ?").get(id);
    if (!existing) {
      this.db.prepare(`
        INSERT INTO operating_items(id, title, owner, status, priority, next_action, next_action_at, evidence_summary, source_task_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, title, owner, status, priority, nextAction, nextActionAt, evidenceSummary, sourceTaskId, now, now);
    } else {
      this.db.prepare(`
        UPDATE operating_items
        SET title=?, owner=?, status=?, priority=?, next_action=?, next_action_at=?, evidence_summary=?, source_task_id=?, updated_at=?
        WHERE id=?
      `).run(title, owner, status, priority, nextAction, nextActionAt, evidenceSummary, sourceTaskId, now, id);
    }
    return this.db.prepare("SELECT * FROM operating_items WHERE id = ?").get(id);
  }

  recoverInterruptedTasks() {
    this.db.prepare("UPDATE outbound_email_attempts SET status='unknown', updated_at=? WHERE status IN ('reserved','sending')")
      .run(new Date().toISOString());
    this.db.prepare("UPDATE followups SET status='pending', claimed_at=NULL WHERE status='claimed'").run();
    const nowMs = Date.now();
    const cleanupAt = new Date(nowMs).toISOString();

    // Preserve historical work-plan rows, but do not leave them actionable
    // after their parent task has reached a terminal state.
    this.db.prepare(`
      UPDATE work_items SET status='completed', updated_at=?
      WHERE status!='completed'
        AND task_id IN (SELECT id FROM tasks WHERE status IN ('blocked','completed','failed'))
    `).run(cleanupAt);
    this.db.prepare(`
      UPDATE followups SET status='completed', completed_at=?
      WHERE status!='completed'
        AND (
          task_id IN (SELECT id FROM tasks WHERE status IN ('blocked','completed','failed'))
          OR task_id NOT IN (SELECT id FROM tasks)
        )
    `).run(cleanupAt);

    const internalOpen = this.db.prepare(`
      SELECT id, channel_id, requester_id, created_at
      FROM tasks
      WHERE status IN ('received','running')
      ORDER BY channel_id, created_at DESC
    `).all();
    const seenInternal = new Set();
    const closeTaskNow = this.db.prepare("UPDATE tasks SET status='failed', blocker='Superseded by newer internal objective', updated_at=? WHERE id=?");
    const closeItemsNow = this.db.prepare("UPDATE work_items SET status='completed', updated_at=? WHERE task_id=? AND status!='completed'");
    const closeFollowupsNow = this.db.prepare("UPDATE followups SET status='completed', completed_at=? WHERE task_id=? AND status!='completed'");
    for (const row of internalOpen) {
      const key = String(row.channel_id || "");
      if (row.requester_id !== "system:relentless" || !key.startsWith("internal:relentless:")) continue;
      if (!seenInternal.has(key)) {
        seenInternal.add(key);
        continue;
      }
      closeTaskNow.run(cleanupAt, row.id);
      closeItemsNow.run(cleanupAt, row.id);
      closeFollowupsNow.run(cleanupAt, row.id);
    }

    const cutoff = new Date(nowMs - 30 * 60 * 1000).toISOString();

    const stale = this.db.prepare(`
      SELECT id FROM tasks
      WHERE status IN ('received','running')
        AND created_at < ?
        AND requester_id='system:relentless' AND channel_id LIKE 'internal:relentless:%'
        AND NOT EXISTS (SELECT 1 FROM followups f WHERE f.task_id=tasks.id AND f.status='pending')
    `).all(cutoff);
    const staleTask = this.db.prepare("UPDATE tasks SET status='failed', blocker='Superseded by a newer machine-generated execution cycle', updated_at=? WHERE id=?");
    const staleItems = this.db.prepare("UPDATE work_items SET status='completed', updated_at=? WHERE task_id=? AND status!='completed'");
    const staleFollowups = this.db.prepare("UPDATE followups SET status='completed', completed_at=? WHERE task_id=? AND status!='completed'");
    for (const row of stale) {
      staleTask.run(cleanupAt, row.id);
      staleItems.run(cleanupAt, row.id);
      staleFollowups.run(cleanupAt, row.id);
    }

    const rows = this.db.prepare(`
      SELECT t.id FROM tasks t WHERE t.status='running'
      AND NOT EXISTS (SELECT 1 FROM followups f WHERE f.task_id=t.id AND f.status='pending')
    `).all();
    const update = this.db.prepare("UPDATE tasks SET status='received', updated_at=? WHERE id=?");
    for (const row of rows) update.run(cleanupAt, row.id);
    return rows.length + stale.length;
  }

  queueReply(taskId, channelId, body) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO reply_outbox_messages(id, task_id, channel_id, body, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(id, taskId, channelId, body, new Date().toISOString());
    return id;
  }

  pendingReplies() {
    return this.db.prepare("SELECT * FROM reply_outbox_messages WHERE status='pending' ORDER BY created_at").all();
  }

  queueProgressReply(taskId, channelId) {
    const body = "I have your request. It is still in progress; I'll reply here with the result.";
    const existing = this.db.prepare("SELECT id FROM reply_outbox_messages WHERE task_id=? AND channel_id=? AND body=? LIMIT 1").get(taskId, channelId, body);
    if (existing) return existing.id;
    const id = randomUUID();
    this.db.prepare(`INSERT OR IGNORE INTO reply_outbox_messages(id, task_id, channel_id, body, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)`)
      .run(id, taskId, channelId, body, new Date().toISOString());
    return id;
  }

  markReplySent(replyId, slackTs) {
    this.db.prepare("UPDATE reply_outbox_messages SET status='sent', slack_ts=?, sent_at=? WHERE id=?")
      .run(slackTs || null, new Date().toISOString(), replyId);
  }
}

