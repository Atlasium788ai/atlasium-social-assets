import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CyrusStore } from '../src/store.js';
import { CyrusAgent } from '../src/agent.js';
import { SlackSocketRuntime } from '../src/slack.js';

function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'execution-life-'));
  const file=path.join(dir,'test.sqlite');let store=new CyrusStore(file);let n=0;
  return {get store(){return store;},add(text='Check health',channelId='D_BLAIR',requesterId='BLAIR'){return store.createTask({sourceEventId:String(++n),requesterId,channelId,requestText:text}).task;},restart(){store.close();store=new CyrusStore(file);store.recoverInterruptedTasks();},close(){store.close();fs.rmSync(dir,{recursive:true,force:true});}};
}

test('new DMs and restart preserve unfinished assignments, work items, followups and handoffs',()=>{
  const f=fixture();try{
    const first=f.add('Research the buyer');f.store.setTaskStatus(first.id,'running');
    f.store.scheduleFollowup(first.id,{dueAt:new Date(Date.now()+60000).toISOString(),reason:'next step'});
    f.store.db.prepare("INSERT INTO work_items(id,task_id,title,owner,status,created_at,updated_at) VALUES ('item',?,'Prepare proposal','Cyrus','planned',?,?)").run(first.id,new Date().toISOString(),new Date().toISOString());
    const second=f.add('Are you working?');
    const handoff=f.add('Prepare delivery checklist','internal:cyrus:one','agent:cyrus');
    f.store.setTaskStatus(handoff.id,'running');
    f.store.db.prepare("UPDATE tasks SET created_at='2026-01-01T00:00:00Z' WHERE id=?").run(handoff.id);
    f.restart();
    assert.equal(f.store.getTask(first.id).status,'running');
    assert.equal(f.store.getTask(second.id).status,'received');
    assert.equal(f.store.hasPendingFollowup(first.id),true);
    assert.notEqual(f.store.getWorkItems(first.id)[0].status,'completed');
    assert.equal(f.store.getTask(handoff.id).status,'received');
  }finally{f.close();}
});

test('progress with unfinished work queues durable bounded continuation, then stops without novel evidence',async()=>{
  const f=fixture();let n=0;let phase='progress';const requests=[];
  const agent=new CyrusAgent({store:f.store,config:{role:'cyrus',name:'Cyrus'},maxTurns:1,
    model:{respond:async req=>{requests.push(req);return {output:[{type:'function_call',name:'inspect_next',arguments:'{}',call_id:String(++n)}]};}},
    toolbox:{definitions:[],execute:async()=>({ok:true,evidence:{source:'test',claim:'Checked item',detail:{item:phase==='progress'?n:2}}})}});
  try{
    const task=f.add('Inspect and complete the assigned objective');
    await agent.handleTask(task);assert.equal(f.store.continuationCount(task.id),1);assert.equal(f.store.getTask(task.id).status,'running');
    f.restart();agent.store=f.store;
    assert.equal(f.store.continuationCount(task.id),1);assert.equal(f.store.hasPendingFollowup(task.id),true);
    let followup=f.store.nextFollowup(task.id);f.store.completeFollowup(followup.id);
    await agent.handleTask(task,{followupReason:'Continue work'});assert.equal(f.store.continuationCount(task.id),2);
    assert.match(requests[1].input[0].content,/inspect_next/);
    followup=f.store.nextFollowup(task.id);f.store.completeFollowup(followup.id);
    await agent.handleTask(task,{followupReason:'Continue work'});
    assert.equal(f.store.getTask(task.id).status,'blocked');assert.equal(f.store.hasPendingFollowup(task.id),false);
    assert.match(f.store.getTask(task.id).blocker,/two bounded continuations/);
    const stalled=f.add('Inspect a stalled objective');phase='stalled';
    await agent.handleTask(stalled);followup=f.store.nextFollowup(stalled.id);f.store.completeFollowup(followup.id);
    await agent.handleTask(stalled,{followupReason:'Continue work'});
    assert.equal(f.store.continuationCount(stalled.id),1);assert.match(f.store.getTask(stalled.id).blocker,/without new verified progress/);
  }finally{f.close();}
});

test('slow Slack tasks send one durable acknowledgement followed by final reply without reaction scope',async()=>{
  const f=fixture();const posts=[];let release;const gate=new Promise(resolve=>{release=resolve;});
  const runtime=new SlackSocketRuntime({store:f.store,config:{role:'clara',name:'Clara',blairSlackUserId:'BLAIR',progressAckDelayMs:5},
    agent:{handleTask:async()=>{await gate;return 'Result ready.';}},
    slackApi:async(method,payload)=>{if(method==='chat.postMessage')posts.push(payload);return method.startsWith('reactions.')?{ok:false,error:'missing_scope'}:{ok:true,ts:'10.1'};},
    logger:{info(){},warn(){},error(){}},WebSocketImpl:class{}});
  try{
    const event={type:'message',channel_type:'im',user:'BLAIR',channel:'D_BLAIR',ts:'1.1',text:'Check the assigned work'};
    const running=runtime.processSlackMessage(event);
    await new Promise(resolve=>setTimeout(resolve,35));
    assert.equal(posts.length,1);assert.match(posts[0].text,/still in progress/);
    const task=f.store.getTaskBySourceEvent('slack-message:D_BLAIR:1.1');
    assert.equal(f.store.queueProgressReply(task.id,'D_BLAIR'),posts[0].client_msg_id);
    release();await running;
    assert.equal(posts.length,2);assert.equal(posts[1].text,'Result ready.');
    assert.equal(await runtime.processSlackMessage(event),false);assert.equal(posts.length,2);
  }finally{release();f.close();}
});

test('read-only conversation responds during long work while actions remain serialized',async()=>{
  const f=fixture();let release;const gate=new Promise(resolve=>{release=resolve;});const started=[];
  const runtime=new SlackSocketRuntime({store:f.store,config:{role:'clara'},agent:{handleTask:async task=>{started.push(task.request_text);if(task.request_text==='Research buyer')await gate;return task.request_text;}},slackApi:async()=>({ok:true}),logger:{info(){},warn(){},error(){}},WebSocketImpl:class{}});
  try{
    const action=runtime.runAgentTask(f.add('Research buyer'));
    await Promise.resolve();
    const nextAction=runtime.runAgentTask(f.add('Check campaign'));
    assert.equal(await runtime.runAgentTask(f.add('Are you working?')),'Are you working?');
    assert.deepEqual(started,['Research buyer','Are you working?']);
    release();await action;await nextAction;
    assert.deepEqual(started,['Research buyer','Are you working?','Check campaign']);
  }finally{release();f.close();}
});
