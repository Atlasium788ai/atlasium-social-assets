import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CyrusStore } from '../src/store.js';
import { createLocalAgentDispatcher } from '../src/shared.js';
import { createToolbox } from '../src/tools.js';
import { isConversationOnly } from '../src/conversation.js';

test('natural action follow-ups never require another execution session; explicit discussion remains read-only',()=>{
  for(const text of ['So fix it','Okay, fix it','You figure it out','Figure this out','Keep working','Then do it outside of the session']) assert.equal(isConversationOnly(text),false,text);
  for(const text of ['So what do you think?','Okay, just talk. No tools.','Internal handoff from cyrus: CONVERSATION-ONLY: discuss how to fix it'])assert.equal(isConversationOnly(text),true,text);
});

test('blockers persist owned issues and queue deduplicated internal resolution without recursive execution',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blocker-resolution-'));const stores={};const configs={};let executions=0;
  const dispatcher=createLocalAgentDispatcher();
  for(const role of ['cyrus','kenji','clara']){
    stores[role]=new CyrusStore(path.join(dir,role+'.sqlite'));configs[role]={role,name:role,agentPeers:{},httpReadAllowlist:new Set()};
    dispatcher.register(role,{store:stores[role],config:configs[role],agent:{isBusy:()=>false,handleTask:async()=>{executions++;throw Error('must be deferred');}}});
  }
  const make=(role,id,requester='BLAIR')=>stores[role].createTask({sourceEventId:id,channelId:'internal:test:'+id,requesterId:requester,requestText:'Resolve the assigned issue'}).task;
  const report=async(role,task,args)=>createToolbox({store:stores[role],config:configs[role],agentDispatcher:dispatcher,slackApi:async()=>{throw Error('No Slack messages');},fetchImpl:async()=>{throw Error('No external calls');}}).execute('report_blocker',args,{taskId:task.id});
  try{
    const task=make('clara','one','agent:cyrus');
    const falseBlocker=await report('clara',task,{blocker:'No operating tools in this conversation-only session'});
    assert.equal(falseBlocker.ok,false);assert.match(falseBlocker.error,/No session switch/);
    assert.equal(stores.cyrus.health().openTasks,0);
    const args={blocker:'A booking API request fails',category:'software',attempted:'Inspected response',next_action:'Kenji diagnose response handling',alternative:'Prepare the next buyer assessment'};
    const first=await report('clara',task,args);assert.equal(first.data.routing.status,'queued');assert.equal(first.data.owner,'cyrus');assert.equal(first.data.issueResolved,false);assert.equal(executions,0);
    const issue=stores.clara.getOperatingItems().find(x=>x.id===first.data.issueId);assert.equal(issue.status,'blocked');assert.match(issue.evidence_summary,/Prepare the next buyer/);
    const again=await report('clara',make('clara','two'),args);assert.equal(again.data.routing.taskId,first.data.routing.taskId);
    assert.equal(stores.cyrus.db.prepare("SELECT count(*) AS n FROM tasks").get().n,1);
    const cyrusTask=stores.cyrus.getTask(first.data.routing.taskId);assert.equal(stores.cyrus.hasPendingFollowup(cyrusTask.id),true);
    const routed=await report('cyrus',cyrusTask,args);assert.equal(routed.data.owner,'kenji');assert.equal(routed.data.routing.status,'queued');assert.equal(executions,0);
    const returned=make('cyrus','kenji-result','agent:kenji');
    const loop=await report('cyrus',returned,args);assert.equal(loop.data.routing.status,'tracked');assert.equal(loop.data.owner,'cyrus');
    assert.equal(stores.kenji.db.prepare("SELECT count(*) AS n FROM tasks").get().n,1);
  }finally{for(const s of Object.values(stores))s.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('remote resolution uses deferred private handoff; failed delivery stays visibly unresolved',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blocker-private-'));const store=new CyrusStore(path.join(dir,'test.sqlite'));const requests=[];
  try{
    const task=store.createTask({sourceEventId:'one',requesterId:'BLAIR',channelId:'D_BLAIR',requestText:'Resolve the sales dependency'}).task;
    const config={role:'malik',name:'Malik',agentPeers:{cyrus:'http://cyrus.internal:3001'},httpReadAllowlist:new Set()};
    const toolbox=createToolbox({store,config,slackApi:async()=>{throw Error('No Slack');},fetchImpl:async(url,options)=>{requests.push({url,options});return{ok:true,json:async()=>({ok:true,queued:true,status:'received',taskId:'queued-test'})};}});
    const result=await toolbox.execute('report_blocker',{blocker:'Sender authorization missing',category:'access',alternative:'Research another relevant company'},{taskId:task.id});
    assert.equal(result.data.routing.status,'queued');assert.equal(JSON.parse(requests[0].options.body).defer,true);assert.equal(result.data.issueResolved,false);
    config.agentPeers={};
    const failure=await toolbox.execute('report_blocker',{blocker:'Another missing dependency'},{taskId:task.id});
    assert.equal(failure.data.routing.status,'delivery_failed');assert.equal(failure.data.issueResolved,false);
    assert.equal(store.getOperatingItems().find(x=>x.id===failure.data.issueId).status,'blocked');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
