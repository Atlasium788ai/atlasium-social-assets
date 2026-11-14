import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const BTO = "brand_52eae935-c32d-4f35-8cb4-4774f4a74deb";
const ATLASIUM = "brand_atlasium_788_ai";
const SOURCE = "https://www.canada.ca/en/services/business.html";
const CTX = { waitUntil() {}, passThroughOnException() {} };
const ENDPOINT = "https://example.invalid/api/echo/content/import-editorial";

async function loadWorker() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("bto-import-test", Date.now() + "-" + Math.random());
  return (await import(url.href)).default;
}

async function fakeDB() {
  const db = new DatabaseSync(":memory:");
  const files = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, new URL("../drizzle/", import.meta.url)), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean))
      db.exec(statement);
  }
  class Prepared {
    constructor(sql, args=[]) { this.sql=sql; this.args=args; }
    bind(...args) { return new Prepared(this.sql,args); }
    async first() { return db.prepare(this.sql).get(...this.args) || null; }
    async all() { return { success:true, results:db.prepare(this.sql).all(...this.args) }; }
    async run() {
      const value=db.prepare(this.sql).run(...this.args);
      return {success:true,meta:{changes:Number(value.changes)}};
    }
  }
  return { database:db, prepare(sql) {return new Prepared(sql);},
    async batch(stmts) {return Promise.all(stmts.map((s) => s.run()));} };
}

async function testEnv(worker) {
  const DB=await fakeDB();
  const env={
    DB, UPLOAD_KEY:"test-secret",
    UPLOADS:{async list(){return {objects:[],truncated:false};}, async get(){return null;}},
    ASSETS:{async fetch(){return new Response("not found",{status:404});}},
  };
  const boot=await worker.fetch(new Request("https://example.invalid/api/echo/content/workspace",{
    headers:{"X-Upload-Key":"test-secret","X-Brand-ID":ATLASIUM}
  }),env,CTX);
  assert.equal(boot.status,200);
  const now=new Date().toISOString();
  DB.database.prepare(`INSERT INTO brands
    (id,workspace_id,slug,name,logo_url,website,industry,location,timezone,status,created_at,updated_at)
    VALUES (?,?, 'built-to-own-a74deb', 'BUILT TO OWN', NULL,'','','','America/Toronto','active',?,?)`)
    .run(BTO,"workspace_atlasium",now,now);
  DB.database.prepare(`INSERT INTO brand_profiles
    (brand_id,what_it_does,target_audience,main_offers,primary_cta,tone,words_use,words_avoid,visual_style,instructions,routing_rules,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(BTO,"Independent business media","Modern entrepreneurs","","","Editorial","","","","","{}",now);
  return env;
}

async function handoff(captions=["Read the original source before changing a business plan. " + SOURCE]) {
  const story="test-bto-001";
  const platforms=["linkedin","facebook","instagram","threads","x"];
  const drafts=[];
  for(let i=0;i<captions.length;i++){
    const platform=platforms[i];
    const caption=captions[i];
    const phrase="BUILT TO OWN\n"+story+"\n"+platform+"\n"+caption;
    const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(phrase)));
    const fingerprint=[...digest].map(b=>b.toString(16).padStart(2,"0")).join("").slice(0,32);
    drafts.push({
      sourceKey:"bto_"+fingerprint,platform,
      request:{contentType:"social",mode:"manual",prompt:"",
        payload:{title:"A business news brief | "+platform,caption,imageConcept:"",platforms:[platform]}}
    });
  }
  return {
    schema:"built-to-own.echoflow-drafts.v1",brand:"BUILT TO OWN",
    sourceStoryId:story,reviewOnly:true,publishEnabled:false,approvedForDistribution:false,
    socialDestinations:[],sources:[SOURCE],drafts
  };
}

function request(payload,brandId=BTO,authenticate=true,method="POST") {
  const headers={"Content-Type":"application/json"};
  if(authenticate)headers["X-Upload-Key"]="test-secret";
  if(brandId)headers["X-Brand-ID"]=brandId;
  return new Request(ENDPOINT,{method,headers,...(method==="POST" ? {body:JSON.stringify(payload)}:{})});
}

test("only an authorized Built to Own brand may import newsroom review drafts",async()=>{
  const worker=await loadWorker();const env=await testEnv(worker);const data=await handoff();
  assert.equal((await worker.fetch(request(data,BTO,false),env,CTX)).status,401);
  assert.equal((await worker.fetch(request(data,ATLASIUM),env,CTX)).status,403);
  assert.equal((await worker.fetch(request(data,null),env,CTX)).status,400);
  assert.equal((await worker.fetch(request(data,BTO,true,"GET"),env,CTX)).status,405);
  const response=await worker.fetch(request(data),env,CTX);
  const result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  assert.equal(result.imported,1);
  assert.equal(result.alreadyPresent,0);
  assert.equal(result.createdStatus,"draft");
  assert.equal(result.publishEnabled,false);
  assert.equal(result.outboundMessagesSent,0);
  const saved=env.DB.database.prepare("SELECT * FROM echo_content_drafts").all();
  assert.equal(saved.length,1);
  assert.equal(saved[0].brand_id,BTO);
  assert.equal(saved[0].status,"draft");
  assert.equal(saved[0].content_type,"social");
  assert.equal(JSON.parse(saved[0].payload).platforms[0],"linkedin");
  assert.equal(JSON.parse(saved[0].settings).publicationApproved,false);
  assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS n FROM publish_jobs").get().n,0);
});

test("replaying the identical handoff is idempotent and never contacts providers",async()=>{
  const worker=await loadWorker();const env=await testEnv(worker);const data=await handoff([
    "Consider a source's claims before accepting its conclusion. "+SOURCE,
    "Which operating decision would the original announcement change? "+SOURCE,
  ]);
  const original=globalThis.fetch;
  globalThis.fetch=()=>{throw new Error("No provider, AI, Buffer or marketing call is permitted");};
  try{
    const first=await worker.fetch(request(data),env,CTX);
    assert.equal(first.status,200,await first.text().catch(()=>"<body read>"));
    const again=await worker.fetch(request(data),env,CTX);
    const repeated=await again.json();
    assert.equal(repeated.imported,0);
    assert.equal(repeated.alreadyPresent,2);
    assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS n FROM echo_content_drafts").get().n,2);
    assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='built_to_own_social_drafts_imported'").get().n,1);
  }finally{globalThis.fetch=original;}
});

test("all invalid handoffs fail before the first draft is written",async()=>{
  const worker=await loadWorker();const env=await testEnv(worker);
  const base=await handoff(["Learn from the public source. "+SOURCE,
    "Relevant questions begin with sources. "+SOURCE]);
  const hostile=[
    {...base,publishEnabled:true},
    {...base,approvedForDistribution:true},
    {...base,socialDestinations:["facebook"]},
    {...base,brand:"Atlasium 7/88 AI"},
    {...base,drafts:[base.drafts[0],{...base.drafts[1],sourceKey:"bto_"+"0".repeat(32)}]},
    {...base,drafts:[base.drafts[0],{...base.drafts[0]}]},
    {...base,drafts:[{...base.drafts[0],request:{...base.drafts[0].request,
      payload:{...base.drafts[0].request.payload,platforms:["facebook"]}}}]},
    {...base,sources:["https://admin.internal/secret"]},
  ];
  for(const payload of hostile){
    const result=await worker.fetch(request(payload),env,CTX);
    assert.equal(result.status,400,JSON.stringify(payload).slice(0,180));
    assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS n FROM echo_content_drafts").get().n,0);
  }
});

test("brand names cannot be spoofed by changing the POST body",async()=>{
  const worker=await loadWorker();const env=await testEnv(worker);
  const otherId="brand_other";
  const now=new Date().toISOString();
  env.DB.database.prepare(`INSERT INTO brands
    (id,workspace_id,slug,name,logo_url,website,industry,location,timezone,status,created_at,updated_at)
    VALUES (?,?,'other','Other Brand',NULL,'','','','America/Toronto','active',?,?)`)
    .run(otherId,"workspace_atlasium",now,now);
  env.DB.database.prepare(`INSERT INTO brand_profiles
    (brand_id,what_it_does,target_audience,main_offers,primary_cta,tone,words_use,words_avoid,visual_style,instructions,routing_rules,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(otherId,"","","","","","","","","","{}",now);
  const data=await handoff();
  data.brandId=BTO;
  const response=await worker.fetch(request(data,otherId),env,CTX);
  assert.equal(response.status,403);
  assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS n FROM echo_content_drafts").get().n,0);
});

test("BTO import uses stable identity rather than editable display metadata", async () => {
  const worker=await loadWorker();const env=await testEnv(worker);const data=await handoff();
  env.DB.database.prepare("UPDATE brands SET slug='renamed-editorial',name='Editorial label changed' WHERE id=?").run(BTO);
  const response=await worker.fetch(request(data),env,CTX);
  assert.equal(response.status,200);
  assert.equal(env.DB.database.prepare("SELECT brand_id FROM echo_content_drafts").get().brand_id,BTO);
});

test("a different brand cannot impersonate BTO by copying its original display name and slug",async()=>{
  const worker=await loadWorker();const env=await testEnv(worker);
  env.DB.database.prepare("UPDATE brands SET slug='built-to-own',name='BUILT TO OWN' WHERE id=?").run(ATLASIUM);
  const response=await worker.fetch(request(await handoff(),ATLASIUM),env,CTX);
  assert.equal(response.status,403);
  assert.equal(env.DB.database.prepare("SELECT COUNT(*) AS n FROM echo_content_drafts").get().n,0);
});
