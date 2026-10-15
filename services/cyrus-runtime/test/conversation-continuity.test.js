import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CyrusStore } from '../src/store.js';
import { CyrusAgent } from '../src/agent.js';
import { isConversationOnly, isHandoffFollowup } from '../src/conversation.js';

test('DM history persists, is bounded, and excludes other channels and requesters',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'continuity-'));
  const file=path.join(dir,'test.sqlite');
  let store=new CyrusStore(file);let n=0;
  const add=(text,channelId='D_BLAIR',requesterId='BLAIR')=>store.createTask({sourceEventId:String(++n),channelId,requesterId,requestText:text}).task;
  try {
    const first=add('Ask Cyrus');
    store.queueReply(first.id,'D_BLAIR','What should I ask Cyrus?');
    store.markReplySent(store.pendingReplies()[0].id,'1.1');
    add('PRIVATE OTHER DM','D_OTHER');add('PRIVATE OTHER PERSON','D_BLAIR','OTHER');add('PRIVATE INTERNAL','internal:cyrus:one');
    const current=add('About the work I assigned him');
    store.close();store=new CyrusStore(file);
    assert.deepEqual(store.recentConversation(current.id),[{role:'user',content:'Ask Cyrus'},{role:'assistant',content:'What should I ask Cyrus?'}]);
    assert.deepEqual(store.recentConversation(add('test','internal:cyrus:two').id),[]);
    for(let i=0;i<12;i++)add('x'.repeat(2000));
    const bounded=store.recentConversation(add('latest').id);
    assert.equal(bounded.length,8);assert.ok(bounded.every(x=>x.content.length<=1200));
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('executive handoff clarification is actionable without promoting ordinary discussion',()=>{
  const history=[{role:'user',content:'Ask Cyrus'},{role:'assistant',content:'What should I ask Cyrus?'},{role:'user',content:'About the work I assigned him'},{role:'assistant',content:'Which person, Cyrus or Malik?'}];
  assert.equal(isConversationOnly('Ask Cyrus'),false);
  assert.equal(isHandoffFollowup('Cyrus',history),true);
  assert.equal(isHandoffFollowup('About the work I assigned him',history.slice(0,2)),true);
  assert.equal(isHandoffFollowup('Just talk. No tools.',history),false);
  assert.equal(isHandoffFollowup('Cyrus',[{role:'user',content:'I like Cyrus'},{role:'assistant',content:'Why?'}]),false);
  assert.equal(isConversationOnly('Just talk. No tools.'),true);
});

test('agent receives recent turns for action and chat while explicit conversation stays tool-free',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'continuity-agent-'));
  const store=new CyrusStore(path.join(dir,'test.sqlite'));
  const add=(id,text)=>store.createTask({sourceEventId:id,requesterId:'BLAIR',channelId:'D_BLAIR',requestText:text}).task;
  const requests=[];
  const agent=new CyrusAgent({store,config:{role:'clara',name:'Clara',autonomyEnabled:true},model:{respond:async request=>{requests.push(request);return{output_text:'Understood.'};}},toolbox:{definitions:[{type:'function',name:'delegate_to_agent'}],execute:async()=>{throw Error('unexpected');}},maxTurns:1});
  try {
    const first=add('one','Ask Cyrus');store.queueReply(first.id,'D_BLAIR','What should I ask Cyrus?');store.markReplySent(store.pendingReplies()[0].id,'1.1');
    await agent.handleTask(add('two','About the work I assigned him'));
    assert.ok(requests[0].input.some(x=>x.role==='user'&&x.content==='Ask Cyrus'));
    assert.ok(requests[0].input.some(x=>x.role==='assistant'&&x.content==='What should I ask Cyrus?'));
    assert.equal(requests[0].tools.length,1);
    await agent.handleTask(add('three','Just talk. No tools.'));
    assert.deepEqual(requests[1].tools,[]);assert.match(requests[1].instructions,/Background automation configured: true/);
    assert.equal(requests[1].input.at(-1).content,'Just talk. No tools.');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
