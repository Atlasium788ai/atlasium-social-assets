import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const APP_SECRET = "meta-app-secret-should-be-long-in-tests";
const BRIDGE_SECRET = "internal-bridge-signing-secret-longer-than-32";
const ID_SECRET = "internal-identity-signing-secret-longer-32";
const ctx = { waitUntil() {}, passThroughOnException() {} };

async function workerRef() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("meta-engagement-test", Date.now() + "-" + Math.random());
  return (await import(url.href)).default;
}

async function mockDb() {
  const db = new DatabaseSync(":memory:");
  const files=(await readdir(new URL("../drizzle/", import.meta.url))).filter(n=>/^\d+_.+\.sql$/.test(n)).sort();
  for(const path of files){
    const sql=await readFile(new URL(path,new URL("../drizzle/",import.meta.url)),"utf8");
    for(const statement of sql.split("--> statement-breakpoint").map(s=>s.trim()).filter(Boolean))db.exec(statement);
  }
  class Statement{
    constructor(query,vals=[]){this.query=query;this.vals=vals;}
    bind(...vals){return new Statement(this.query,vals);}
    async first(){return db.prepare(this.query).get(...this.vals)||null;}
    async all(){return{results:db.prepare(this.query).all(...this.vals)};}
    async run(){const x=db.prepare(this.query).run(...this.vals);return{meta:{changes:Number(x.changes)}};}
  }
  return{database:db,prepare(query){return new Statement(query)},async batch(xs){return Promise.all(xs.map(x=>x.run()))}};
}

async function fixture(){
  return{
    DB:await mockDb(),
    UPLOADS:{async list(){return{objects:[],truncated:false}},async get(){return null}},
    ASSETS:{async fetch(){return new Response("none",{status:404})}},
    UPLOAD_KEY:"test-workspace-key",
    ECHOFLOW_META_WEBHOOK_ENABLED:"true",
    ENGAGEMENT_INBOX_ENABLED:"true",
    ENGAGEMENT_INGEST_SECRET:BRIDGE_SECRET,
    ENGAGEMENT_ID_SECRET:ID_SECRET,
    META_VERIFY_TOKEN:"test-verification-token",
    META_APP_SECRET:APP_SECRET,
  };
}

function postPayload(overrides={}){
  return{object:"page",entry:[{
    id:"page-123",
    time:Math.floor(Date.now()/1000),
    changes:[{field:"feed",value:{
      item:"comment",verb:"add",comment_id:"comment-99",from:{id:"visitor-456"},
      message:"What do you recommend for better customer follow-up?"
    }}],
    ...overrides,
  }]};
}

async function signedPost(payload,signatureSecret=APP_SECRET){
  const raw=JSON.stringify(payload);
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(signatureSecret),{
    name:"HMAC",hash:"SHA-256"
  },false,["sign"]);
  const signature=Array.from(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(raw))),
    x=>x.toString(16).padStart(2,"0")).join("");
  return new Request("https://example.invalid/api/flow/engagement/meta-webhook",{
    method:"POST",headers:{"Content-Type":"application/json","X-Hub-Signature-256":"sha256="+signature},
    body:raw,
  });
}

async function initialize(worker,env){
  const init=await worker.fetch(new Request("https://example.invalid/api/flow/engagement",{
    headers:{"X-Upload-Key":"test-workspace-key","X-Brand-ID":"brand_atlasium_788_ai"},
  }),env,ctx);
  assert.equal(init.status,200);
  const now=new Date().toISOString();
  env.DB.database.prepare(`INSERT INTO engagement_inbox_accounts
    (id,workspace_id,brand_id,platform,provider_account_id,status,created_at,updated_at)
    VALUES ('account-page-123','workspace_atlasium','brand_atlasium_788_ai','facebook','page-123','read_enabled',?,?)`)
    .run(now,now);
}

test("Meta verification handshake requires enabled provider and correct token",async()=>{
  const worker=await workerRef();const env=await fixture();
  const target="https://example.invalid/api/flow/engagement/meta-webhook";
  const pass=await worker.fetch(new Request(target+"?hub.mode=subscribe&hub.verify_token=test-verification-token&hub.challenge=123456"),env,ctx);
  assert.equal(pass.status,200);
  assert.equal(await pass.text(),"123456");
  const fail=await worker.fetch(new Request(target+"?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123456"),env,ctx);
  assert.equal(fail.status,403);
  env.ECHOFLOW_META_WEBHOOK_ENABLED="false";
  assert.equal((await worker.fetch(new Request(target+"?hub.mode=subscribe&hub.verify_token=test-verification-token&hub.challenge=123456"),env,ctx)).status,503);
});

test("signed Meta Page comments enter the correct brand's inbox only once",async()=>{
  const worker=await workerRef();const env=await fixture();await initialize(worker,env);
  const response=await worker.fetch(await signedPost(postPayload()),env,ctx);
  const first=await response.json();
  assert.equal(response.status,200,JSON.stringify(first));
  assert.equal(first.verified,true);
  assert.equal(first.accepted,1);
  assert.equal(first.externalMessagesSent,0);
  assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS count FROM engagement_inbox_events").get().count,1);
  const duplicate=await (await worker.fetch(await signedPost(postPayload()),env,ctx)).json();
  assert.equal(duplicate.accepted,1);
  assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS count FROM engagement_inbox_events").get().count,1);
  const row=env.DB.database.prepare("SELECT brand_id,platform,kind,actor_key,reply_text FROM engagement_inbox_events").get();
  assert.equal(row.brand_id,"brand_atlasium_788_ai");
  assert.equal(row.kind,"comment");
  assert.equal(row.platform,"facebook");
  assert.ok(!JSON.stringify(row).includes("visitor-456"));
});

test("invalid Meta signatures are rejected even when body identifies a known account",async()=>{
  const worker=await workerRef();const env=await fixture();await initialize(worker,env);
  const forged=await worker.fetch(await signedPost(postPayload(),"different-key-much-longer-than-24"),env,ctx);
  assert.equal(forged.status,401);
  assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS count FROM engagement_inbox_events").get().count,0);
});

test("Meta account ownership is checked; unsupported and outbound echo events are ignored",async()=>{
  const worker=await workerRef();const env=await fixture();await initialize(worker,env);
  const unknown=postPayload({id:"another-page"});
  const unknownRes=await (await worker.fetch(await signedPost(unknown),env,ctx)).json();
  assert.equal(unknownRes.accepted,0);
  assert.equal(unknownRes.ignored,1);
  const echo=postPayload({changes:[],messaging:[{
    sender:{id:"visitor-456"},recipient:{id:"page-123"},timestamp:Date.now(),
    message:{mid:"m-333",text:"Echo",is_echo:true},
  }]});
  const echoResponse=await (await worker.fetch(await signedPost(echo),env,ctx)).json();
  assert.equal(echoResponse.accepted,0);
  assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS count FROM engagement_inbox_events").get().count,0);
});

test("signed inbound Page messages can be reviewed but cannot transmit a reply",async()=>{
  const worker=await workerRef();const env=await fixture();await initialize(worker,env);
  const payload=postPayload({
    changes:[],
    messaging:[{sender:{id:"visitor-789"},recipient:{id:"page-123"},timestamp:Date.now(),
      message:{mid:"mid.001",text:"Can I learn more about automation?"}}],
  });
  const response=await worker.fetch(await signedPost(payload),env,ctx);
  const result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  assert.equal(result.accepted,1);
  const row=env.DB.database.prepare("SELECT platform,kind,category,status FROM engagement_inbox_events").get();
  assert.equal(row.platform,"facebook");
  assert.equal(row.kind,"dm");
  assert.equal(row.category,"technology");
  assert.equal(row.status,"pending_review");
  const noSend=await worker.fetch(new Request("https://example.invalid/api/flow/engagement/meta-webhook",{method:"PUT"}),env,ctx);
  assert.equal(noSend.status,405);
});
