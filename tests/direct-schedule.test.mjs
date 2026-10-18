import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

async function schedulerModule() {
  const moduleText = await readFile(new URL("../worker/direct-social.ts", import.meta.url), "utf8");
  const social = ts.transpileModule(moduleText, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const url = `data:text/javascript;base64,${Buffer.from(social).toString("base64")}`;
  const source = (await readFile(new URL("../worker/direct-schedule.ts", import.meta.url), "utf8"))
    .replace('from "./direct-social"', `from "${url}"`);
  const script = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(script).toString("base64")}#${Date.now()}`);
}

async function testEnv() {
  const db = new DatabaseSync(":memory:");
  const migration = await readFile(new URL("../drizzle/0003_direct_social_schedule.sql", import.meta.url), "utf8");
  for (const stmt of migration.split("--> statement-breakpoint").map(x=>x.trim()).filter(Boolean)) db.exec(stmt);
  db.exec(`CREATE TABLE publish_jobs (
    id text PRIMARY KEY, workspace_id text, brand_id text, provider text,
    status text, provider_post_id text, error text, updated_at text
  )`);
  const DB = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async run() { const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
      };
    },
  };
  const connections = [{
    id: "page-a", brandId: "brand-a", service: "facebook", displayName: "Brand A",
    accountId: "123456", accessToken: "secret-platform-token",
  }];
  const env = { DB, DIRECT_SOCIAL_SCHEDULER_ENABLED: "true", DIRECT_SOCIAL_CONNECTIONS: JSON.stringify(connections) };
  const dueAt = "2026-11-20T15:00:00.000Z";
  const input = {
    id: "post-a:page-a:feed", brandId: "brand-a", campaignId: "campaign-a", postId: "post-a",
    channelId: "page-a", service: "facebook", caption: "Our latest product update.",
    imageUrl: "https://media.example.org/picture.jpg", dueAt,
  };
  return { db, env, input };
}

const NOW = new Date("2026-11-20T14:00:00.000Z");
const DUE = new Date("2026-11-20T15:00:01.000Z");

test("scheduling is gated until configured and rejects wrong brands or unsafe times", async () => {
  const scheduler = await schedulerModule();
  const { env, input } = await testEnv();
  assert.equal(scheduler.scheduleIsEnabled({ ...env, DIRECT_SOCIAL_SCHEDULER_ENABLED: "false" }), false);
  await assert.rejects(scheduler.enqueueDirectPost({ ...env, DIRECT_SOCIAL_SCHEDULER_ENABLED: "false" }, input, NOW), /not enabled/);
  await assert.rejects(scheduler.enqueueDirectPost(env, { ...input, brandId: "brand-b" }, NOW), /does not belong/);
  await assert.rejects(scheduler.enqueueDirectPost(env, { ...input, dueAt: "2026-11-20T14:01:00Z" }, NOW), /two minutes/);
  await assert.rejects(scheduler.enqueueDirectPost(env, { ...input, imageUrl: "http://bad.example/img.jpg" }, NOW), /HTTPS/);
});

test("a queued post is stored once, isolated by brand, cancelled only while pending", async () => {
  const scheduler = await schedulerModule();
  const { env, input } = await testEnv();
  assert.equal((await scheduler.enqueueDirectPost(env, input, NOW)).queued, true);
  assert.equal((await scheduler.enqueueDirectPost(env, input, NOW)).queued, false);
  assert.equal((await scheduler.listScheduledDirectPosts(env, "brand-a")).length, 1);
  assert.equal((await scheduler.listScheduledDirectPosts(env, "brand-b")).length, 0);
  assert.equal((await scheduler.cancelScheduledDirectPost(env, "brand-b", input.id)).cancelled, false);
  assert.equal((await scheduler.cancelScheduledDirectPost(env, "brand-a", input.id)).cancelled, true);
  assert.equal((await scheduler.cancelScheduledDirectPost(env, "brand-a", input.id)).cancelled, false);
  const previous = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Cancelled post must never be sent"); };
  try { assert.deepEqual(await scheduler.dispatchDueDirectPosts(env, DUE), { checked: 0, sent: 0, review: 0, disabled: false }); }
  finally { globalThis.fetch = previous; }
});

test("cron sends directly once using a claimed queue item, without leaking platform tokens", async () => {
  const scheduler = await schedulerModule();
  const { env, input } = await testEnv();
  await scheduler.enqueueDirectPost(env, input, NOW);
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), auth: init.headers.Authorization });
    return Response.json({ id: "photo-1", post_id: "123456_99" });
  };
  try {
    assert.deepEqual(await scheduler.dispatchDueDirectPosts(env, DUE), { checked: 1, sent: 1, review: 0, disabled: false });
    assert.deepEqual(await scheduler.dispatchDueDirectPosts(env, DUE), { checked: 0, sent: 0, review: 0, disabled: false });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/graph\.facebook\.com\//);
    const records = await scheduler.listScheduledDirectPosts(env, "brand-a");
    assert.equal(records[0].state, "sent");
    assert.equal(records[0].providerPostId, "123456_99");
    assert.doesNotMatch(JSON.stringify(records), /secret-platform-token/);
  } finally { globalThis.fetch = original; }
});

test("unknown publishing outcome is marked for manual review and never automatically retried", async () => {
  const scheduler = await schedulerModule();
  const { env, input } = await testEnv();
  await scheduler.enqueueDirectPost(env, input, NOW);
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: { code: 190 } }, { status: 401 }); };
  try {
    assert.deepEqual(await scheduler.dispatchDueDirectPosts(env, DUE), { checked: 1, sent: 0, review: 1, disabled: false });
    assert.deepEqual(await scheduler.dispatchDueDirectPosts(env, DUE), { checked: 0, sent: 0, review: 0, disabled: false });
    assert.equal(calls, 1);
    const records = await scheduler.listScheduledDirectPosts(env, "brand-a");
    assert.equal(records[0].state, "needs_review");
    assert.match(records[0].error, /Verify|Check|may have succeeded/);
  } finally { globalThis.fetch = original; }
});

test("disabled cron cannot send already stored jobs", async () => {
  const scheduler = await schedulerModule();
  const { env, input } = await testEnv();
  await scheduler.enqueueDirectPost(env, input, NOW);
  assert.deepEqual(await scheduler.dispatchDueDirectPosts({ ...env, DIRECT_SOCIAL_SCHEDULER_ENABLED: "false" }, DUE), { checked: 0, sent: 0, review: 0, disabled: true });
});
