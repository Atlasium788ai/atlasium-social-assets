import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCT_READ_ORIGINS, readPublicPage } from '../src/public-read.js';
import { loadConfig, loadSharedRoleConfigs } from '../src/config.js';

test('primary and shared executives can inspect the existing company product origins',()=>{
  const env={SLACK_APP_TOKEN:'test-app',SLACK_BOT_TOKEN:'test-bot',BLAIR_SLACK_USER_ID:'test-owner',OPENAI_API_KEY:'test-key',SHARED_BOT_ROLES:'clara,mateo,kenji,amara,nadia,sloane'};
  const primary=loadConfig(env);
  const shared=loadSharedRoleConfigs(env,primary);
  for(const config of [primary,...shared]){
    for(const origin of PRODUCT_READ_ORIGINS) assert.equal(config.httpReadAllowlist.has(origin),true);
    assert.equal(config.httpReadAllowlist.has('http://localhost'),false);
  }
  assert.equal(shared.length,6);
});

test('public checks follow an allowed relative redirect and retain their verification limits', async () => {
  const calls=[];
  const result=await readPublicPage('https://linklatch.atlasium788.ca/start',new Set(PRODUCT_READ_ORIGINS),async(url,options)=>{
    calls.push(String(url)); assert.equal(options.method,'GET'); assert.equal(options.redirect,'manual');
    return calls.length===1?new Response(null,{status:302,headers:{location:'/cody/1-on-1-revenue-assessment'}}):new Response('Public booking shell');
  });
  assert.equal(calls.length,2); assert.equal(result.status,200);
  assert.match(result.url,/cody\/1-on-1-revenue-assessment$/);
  assert.match(result.verificationScope,/does not render JavaScript/);
});

test('redirects cannot reach private, unlisted, non-HTTPS or credential-bearing destinations', async () => {
  for(const target of ['https://127.0.0.1/private','https://unlisted.example/','http://atlasium788.ca/','https://user:secret@atlasium788.ca/']){
    let calls=0;
    await assert.rejects(readPublicPage('https://atlasium788.ca/',new Set(PRODUCT_READ_ORIGINS),async()=>{calls++;return new Response(null,{status:302,headers:{location:target}});}),/not allowlisted/);
    assert.equal(calls,1);
  }
});

test('redirect loops are bounded and response reads stop at the size limit', async () => {
  let calls=0;
  await assert.rejects(readPublicPage('https://atlasium788.ca/',new Set(PRODUCT_READ_ORIGINS),async()=>{calls++;return new Response(null,{status:302,headers:{location:'/'}});}),/redirect limit/);
  assert.equal(calls,4);
  let cancelled=false;
  const body=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(40_000).fill(65));},cancel(){cancelled=true;}});
  const result=await readPublicPage('https://atlasium788.ca/',new Set(PRODUCT_READ_ORIGINS),async()=>new Response(body));
  assert.equal(result.body.length,32_768);assert.equal(result.truncated,true);assert.equal(cancelled,true);
});

test('unlisted origins are rejected before any fetch and status failures remain visible', async()=>{
  await assert.rejects(readPublicPage('https://unlisted.example/',new Set(PRODUCT_READ_ORIGINS),async()=>{throw Error('must not fetch');}),/not allowlisted/);
  const result=await readPublicPage('https://atlasium788.ca/',new Set(PRODUCT_READ_ORIGINS),async()=>new Response('Unavailable',{status:503}));
  assert.equal(result.status,503);
});
