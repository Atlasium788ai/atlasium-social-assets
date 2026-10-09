import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CyrusStore } from "../src/store.js";
import { CyrusAgent } from "../src/agent.js";
import { createToolbox } from "../src/tools.js";
import { createLocalAgentDispatcher } from "../src/shared.js";
import { isConversationOnly } from "../src/conversation.js";

test("marked internal conversation remains read-only even when quoting operational words", () => {
  const text = "Internal handoff from cyrus: CONVERSATION-ONLY: Nadia, Kenji says 'launch, check, send and report'. What's your financial take as a colleague?";
  assert.equal(isConversationOnly(text), true);
  assert.equal(isConversationOnly("Internal handoff from cyrus: Launch the approved email campaign"), false);
});

test("Cyrus hands opinion requests to Nadia without exposing business tools", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command88-dialogue-handoff-"));
  const cyrusStore = new CyrusStore(path.join(dir, "cyrus.sqlite"));
  const nadiaStore = new CyrusStore(path.join(dir, "nadia.sqlite"));
  try {
    const dispatcher = createLocalAgentDispatcher();
    const sourceConfig = { role: "cyrus", name: "Cyrus", agentPeers: {}, blairSlackUserId: "U_BLAIR", slackAllowedChannelIds:new Set(), httpReadAllowlist:new Set(), reeviqApiKeys:[] };
    const targetConfig = { ...sourceConfig, role:"nadia", name:"Nadia" };
    let modelRequests = 0;
    let businessToolCalls = 0;
    const nadiaAgent = new CyrusAgent({
      store:nadiaStore, config:targetConfig,
      model:{ respond: async (request)=> {
        modelRequests++;
        assert.deepEqual(request.tools,[]);
        return {output_text:"I agree we should prove buyer demand before another full week of engineering. Cash timing matters.",output:[]};
      }},
      toolbox:{definitions:[{type:"function",name:"delegate_to_agent"}],execute:async()=>{businessToolCalls++;throw new Error("should never execute");}},
    });
    dispatcher.register("cyrus", {config:sourceConfig,store:cyrusStore,agent:{},toolbox:{}});
    dispatcher.register("nadia", {config:targetConfig,store:nadiaStore,agent:nadiaAgent,toolbox:{}});
    const toolbox = createToolbox({store:cyrusStore,config:sourceConfig,slackApi:async()=>({ok:false,error:"offline"}),agentDispatcher:dispatcher});
    const source=cyrusStore.createTask({sourceEventId:"dialogue",requesterId:"U_BLAIR",channelId:"D_BLAIR",requestText:"Ask Nadia for her financial take"}).task;
    const objective="Nadia, Kenji says 'launch, send, check and report'. What's your financial take on a week of extra development?";
    const first=await toolbox.execute("delegate_to_agent",{agent:"nadia",mode:"conversation",objective},{taskId:source.id,requiresEvidence:true});
    assert.equal(first.ok,true);
    assert.equal(first.data.status,"completed");
    assert.match(first.data.reply,/buyer demand/);
    assert.equal(modelRequests,1);
    assert.equal(businessToolCalls,0);
    const stored=nadiaStore.getTask(first.data.taskId);
    assert.match(stored.request_text,/CONVERSATION-ONLY:/);
    const repeat=await toolbox.execute("delegate_to_agent",{agent:"nadia",mode:"conversation",objective},{taskId:source.id,requiresEvidence:true});
    assert.equal(repeat.data.taskId,first.data.taskId);
    assert.equal(modelRequests,1);
  } finally { cyrusStore.close();nadiaStore.close();fs.rmSync(dir,{recursive:true,force:true}); }
});

test("opinion intent infers safe dialogue but task mode preserves execution", async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"command88-dialogue-infer-"));
  const cyrusStore=new CyrusStore(path.join(dir,"cyrus.sqlite"));
  const mateoStore=new CyrusStore(path.join(dir,"mateo.sqlite"));
  try {
    const dispatcher=createLocalAgentDispatcher();
    dispatcher.register("cyrus",{store:cyrusStore,agent:{}});
    const seen=[];
    dispatcher.register("mateo",{store:mateoStore,agent:{handleTask:async t=>{seen.push(t.request_text);mateoStore.setTaskStatus(t.id,"completed",{summary:"Handled"});return "Handled";}}});
    const cfg={role:"cyrus",name:"Cyrus",agentPeers:{}};
    const tb=createToolbox({store:cyrusStore,config:cfg,slackApi:async()=>({ok:false}),agentDispatcher:dispatcher});
    const source=cyrusStore.createTask({sourceEventId:"source",requesterId:"U_BLAIR",channelId:"D_BLAIR",requestText:"Discuss and verify the difference"}).task;
    const opinion=await tb.execute("delegate_to_agent",{agent:"mateo",objective:"What's your creative opinion of this headline?"},{taskId:source.id,requiresEvidence:true});
    const work=await tb.execute("delegate_to_agent",{agent:"mateo",mode:"task",objective:"Verify your runtime health and report evidence"},{taskId:source.id,requiresEvidence:true});
    assert.equal(opinion.ok,true);
    assert.equal(work.ok,true);
    assert.match(seen[0],/CONVERSATION-ONLY:/);
    assert.doesNotMatch(seen[1],/CONVERSATION-ONLY:/);
  } finally {cyrusStore.close();mateoStore.close();fs.rmSync(dir,{recursive:true,force:true});}
});
