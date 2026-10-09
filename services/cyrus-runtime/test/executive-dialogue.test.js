import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CyrusStore } from "../src/store.js";
import { CyrusAgent } from "../src/agent.js";
import { systemPrompt, enforceReply } from "../src/personality.js";
import { isConversationOnly, isStructuredUpdateRequest } from "../src/conversation.js";

const roles = ["cyrus", "malik", "clara", "mateo", "kenji", "amara", "nadia", "sloane"];

test("all eight executives retain distinct voices and a natural business dialogue contract", () => {
  for (const role of roles) {
    const prompt = systemPrompt(role);
    assert.match(prompt, /COMMUNICATION ACROSS COMMAND88/);
    assert.match(prompt, /talk as a real colleague would/i);
    assert.match(prompt, /structured update/i);
    assert.match(prompt, /Solve cross-department problems inside Command88 before involving Blair/i);
    assert.match(prompt, /Be relentless with real-world friction/i);
    assert.match(prompt, /Do not update Blair on routine attempts/i);
    assert.match(prompt, /Keep Slack compact/i);
    assert.match(prompt, /Cyrus owns consolidated company-level reporting/i);
    assert.match(prompt, new RegExp(role === "cyrus" ? "Cyrus" : role === "malik" ? "Malik" : role[0].toUpperCase() + role.slice(1), "i"));
  }
  assert.notEqual(systemPrompt("cyrus"), systemPrompt("malik"));
  assert.notEqual(systemPrompt("clara"), systemPrompt("sloane"));
});

test("normal business discussion is distinct from taking action or requesting a formal report", () => {
  const conversational = [
    "Cyrus, what do you think about our approach to revenue?",
    "Malik, I'm worried we're pushing too hard on cold outbound.",
    "Clara, can we talk about my priorities?",
    "Mateo, this branding doesn't feel right. What would you say?",
    "Kenji, talk me through the architecture tradeoff.",
    "Amara, what should we do when a customer is unhappy?",
    "Nadia, do you think we're spending too much?",
    "Sloane, what are your thoughts on that contract clause?",
    "Internal handoff from cyrus: Mateo, what do you think of this positioning?",
    "Internal handoff from malik: Cyrus, I think our prospecting is too broad.",
    "That feels wrong. We need more punch in the positioning.",
    "I disagree with the direction we have taken.",
    "Why the hell does every bot sound the same?",
    "Cyrus: this is a conversational personality test only. Respond in your own voice. Do not use tools."
  ];
  for (const message of conversational) {
    assert.equal(isConversationOnly(message), true, "Expected conversation: " + message);
  }
  const operational = [
    "Cyrus, please check live revenue metrics for today.",
    "Malik, send the pilot outreach to the approved list.",
    "Clara, schedule my meeting with the team.",
    "Mateo, give me a structured report on campaign results.",
    "Kenji, inspect the live deployment and confirm health.",
    "Amara, create an onboarding task.",
    "Nadia, show me the exact current cash balance.",
    "Sloane, pull the signed contract and check its terms.",
    "Internal handoff from cyrus: Delegate to Clara, use system_health and report evidence.",
    "Cyrus, what do you think? Then send the emails.",
    "Please provide a scorecard with citations",
    "Stop the campaign immediately.",
    "We need to launch the pilot now.",
    "What is the status of our current outreach?",
  ];
  for (const message of operational) {
    assert.equal(isConversationOnly(message), false, "Expected operational: " + message);
  }
  assert.equal(isStructuredUpdateRequest("Give me a structured update with the numbers"), true);
  assert.equal(isStructuredUpdateRequest("What do you think about our numbers?"), false);
});

test("each role handles ordinary or internal executive dialogue with company context and zero tool calls", async () => {
  for (const role of roles) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a788-dialogue-" + role + "-"));
    const store = new CyrusStore(path.join(dir, role + ".sqlite"));
    try {
      const text = role === "mateo"
        ? "Internal handoff from cyrus: Mateo, what do you think about our market positioning?"
        : role === "malik"
          ? "Malik, I'm worried this revenue plan is too broad."
          : role === "cyrus"
            ? "Cyrus, what do you think of all our executives?"
            : role[0].toUpperCase() + role.slice(1) + ", what do you think about the team's priorities?";
      const task = store.createTask({ sourceEventId:"chat-" + role, requesterId:"U_BLAIR", channelId: role === "mateo" ? "internal:cyrus" : "D_BLAIR", requestText:text }).task;
      const inputs = [];
      let executed = 0;
      const agent = new CyrusAgent({
        store,
        config: {role, name:role},
        model: {respond: async (args)=> { inputs.push(args); return {output_text:"We should focus on the strongest real buyer signal, not another activity report.", output:[]}; }},
        toolbox: {definitions:[{type:"function",name:"delegate_to_agent"}], execute: async()=>{executed++;return {ok:true};}},
      });
      const result = await agent.handleTask(task);
      assert.match(result,/strongest real buyer signal/);
      assert.equal(inputs.length,1);
      assert.deepEqual(inputs[0].tools,[]);
      assert.match(inputs[0].instructions,/COMMUNICATION ACROSS COMMAND88/);
      assert.match(inputs[0].input[0].content,/ATLASIUM 7\/88 OPERATING BRIEF/);
      assert.match(inputs[0].input[0].content,/Role-specific remembered decisions/);
      assert.equal(executed,0);
      assert.equal(store.getTask(task.id).status,"completed");
    } finally {store.close();fs.rmSync(dir,{recursive:true,force:true});}
  }
});

test("structured reports preserve newlines and detailed output while ordinary responses stay concise", () => {
  const report = "Revenue status:\n\n- Verified meeting: 1\n- Verified payment: 0\n\n" + "A".repeat(1350);
  const detailed = enforceReply(report,{status:"completed",evidenceCount:1,structured:true});
  assert.match(detailed,/Revenue status:\n\n- Verified meeting/);
  assert.ok(detailed.length>1200);
  const short = enforceReply(report,{status:"completed",evidenceCount:1});
  assert.ok(short.length<=800);
});
