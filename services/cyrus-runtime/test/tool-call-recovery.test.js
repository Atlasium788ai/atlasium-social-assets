import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CyrusStore } from '../src/store.js';
import { CyrusAgent } from '../src/agent.js';
import { createToolbox } from '../src/tools.js';

async function run(responses){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tool-recovery-'));
  const store=new CyrusStore(path.join(dir,'test.sqlite'));const requests=[];const executed=[];
  const task=store.createTask({sourceEventId:'one',requesterId:'BLAIR',channelId:'D_BLAIR',requestText:'Check the next assigned action'}).task;
  let n=0;
  const agent=new CyrusAgent({store,config:{role:'cyrus',name:'Cyrus'},maxTurns:responses.length,
    model:{respond:async req=>{requests.push(structuredClone(req));return responses[n++];}},
    toolbox:{definitions:[],execute:async(name,args)=>{executed.push({name,args});store.setTaskStatus(task.id,'blocked',{blocker:'Controlled diagnostic complete'});return{ok:true};}}});
  try{await agent.handleTask(task);return{requests,executed,steps:store.db.prepare('SELECT status FROM task_steps WHERE task_id=?').all(task.id)};}
  finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
}

test('incomplete model function output is discarded and recovered without executing partial work',async()=>{
  const r=await run([
    {status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[{type:'function_call',name:'mutating_tool',arguments:'{"id":"unfinished',call_id:'partial'}]},
    {output:[{type:'function_call',name:'report_blocker',arguments:'{"reason":"done"}',call_id:'valid'}]},
  ]);
  assert.deepEqual(r.executed,[{name:'report_blocker',args:{reason:'done'}}]);
  assert.ok(r.steps.some(x=>x.status==='incomplete_response'));
  assert.ok(!JSON.stringify(r.requests[1].input).includes('mutating_tool'));
  assert.match(r.requests[1].input.at(-1).content,/No tool.*executed/);
});

test('malformed JSON and non-object tool arguments never execute and receive actionable errors',async()=>{
  for(const args of ['{"missing":','null','[]']){
    const r=await run([
      {output:[{type:'function_call',name:'mutating_tool',arguments:args,call_id:'invalid'}]},
      {output:[{type:'function_call',name:'report_blocker',arguments:'{}',call_id:'valid'}]},
    ]);
    assert.equal(r.executed.length,1);assert.equal(r.executed[0].name,'report_blocker');
    const feedback=r.requests[1].input.find(x=>x.type==='function_call_output'&&x.call_id==='invalid');
    assert.match(JSON.parse(feedback.output).error,/not executed/);
  }
});

test('saved-work tool uses strict complete required arguments for every executive',()=>{
  for(const role of ['cyrus','malik','clara','mateo','kenji','amara','nadia','sloane']){
    const toolbox=createToolbox({store:{},config:{role,name:role,httpReadAllowlist:new Set()},slackApi:async()=>({ok:true})});
    const definition=toolbox.definitions.find(x=>x.name==='save_work_product');
    assert.equal(definition.strict,true);assert.equal(definition.parameters.additionalProperties,false);
    assert.deepEqual(definition.parameters.required,['id','title','content']);
  }
});
