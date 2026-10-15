import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CyrusStore } from "../src/store.js";
import { createToolbox } from "../src/tools.js";

test("usable drafts survive restart without replacing memory or granting external execution", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command88-drafts-"));
  const db = path.join(dir, "mateo.sqlite");
  let store = new CyrusStore(db);
  let externalCalls = 0;
  const tools = () => createToolbox({ store, config: { role: "mateo", name: "Mateo", agentPeers: {} }, slackApi: async () => { externalCalls++; throw Error("No external messaging"); }, fetchImpl: async () => { externalCalls++; throw Error("No external request"); } });
  try {
    const task = store.createTask({ sourceEventId: "draft-test", requesterId: "U_BLAIR", channelId: "D_BLAIR", requestText: "Prepare internal draft" }).task;
    store.rememberDecision({ topic: "Brand", decision: "Atlasium 7/88", rationale: "Existing company name", sourceTaskId: task.id });
    // Simulate the deployed v4 store before writing the first draft.
    store.db.exec("DROP TABLE work_products; UPDATE schema_meta SET value='4' WHERE key='schema_version'");
    store.close();
    store = new CyrusStore(db);
    assert.equal(store.health().schemaVersion, 5);
    assert.equal(store.getTask(task.id).request_text, "Prepare internal draft");
    const args = { id: "roofing-intro", title: "Roofing introduction", content: "Internal draft: ask where quote follow-up stalls. Validate the booking link before release." };
    const receipt = await tools().execute("save_work_product", args, { taskId: task.id });
    assert.equal(receipt.ok, true);
    assert.equal(receipt.data.published, false);
    assert.match(receipt.evidence.claim, /Not published or delivered/);
    assert.equal((await tools().execute("save_work_product", args, { taskId: task.id })).data.revision, 1);
    assert.equal((await tools().execute("save_work_product", { ...args, content: args.content + " Include one relevant question." }, { taskId: task.id })).data.revision, 2);
    store.close();
    store = new CyrusStore(db);
    const listed = await tools().execute("list_work_products", {}, { taskId: task.id });
    assert.equal(listed.data.length, 1);
    assert.equal(listed.data[0].revision, 2);
    assert.match(listed.data[0].content, /relevant question/);
    assert.equal(store.recallDecisions("Brand").length, 1);
    assert.equal(store.health().savedDrafts, 1);
    const other = new CyrusStore(path.join(dir, "amara.sqlite"));
    assert.deepEqual(other.listWorkProducts(), []);
    other.close();
    assert.equal(externalCalls, 0);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("empty work is rejected instead of manufacturing draft completion evidence", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command88-empty-draft-"));
  const store = new CyrusStore(path.join(dir, "nadia.sqlite"));
  try {
    const toolbox = createToolbox({ store, config: { role: "nadia" }, slackApi: async () => ({ ok: true }) });
    const result = await toolbox.execute("save_work_product", { id: "cash-map", title: "Cash map", content: " " }, { taskId: "none" });
    assert.equal(result.ok, false);
    assert.equal(result.evidence, undefined);
    assert.deepEqual(store.listWorkProducts(), []);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
