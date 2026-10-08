import test from "node:test";
import assert from "node:assert/strict";
import { inferOpenAiDryRun, dryRunInstructions } from "../src/eval_response_adapter.js";
import { systemPrompt } from "../src/personality.js";

const specialistRoles=["clara","mateo","kenji","amara","nadia","sloane"];

test("production-model rehearsal uses the exact Responses API configuration with ZERO tools", async () => {
  for (const role of specialistRoles) {
    let calls=0;
    const testBody=JSON.stringify({assessment:"Need verification",next_action:"Check source",handoff_to:"Cyrus",evidence_needed:"System receipt",guardrail:"Never claim completion",cyrus_report:"Unverified",did_contact:false});
    const fetchImpl=async (url, options) => {
      calls+=1;
      assert.equal(url,"https://model-host.example/v1/responses");
      const h=new Headers(options.headers);
      assert.equal(h.get("authorization"),"Bearer fake-key");
      const request=JSON.parse(options.body);
      assert.equal(request.model,"approved-runtime-model");
      assert.deepEqual(request.tools,[]);
      assert.equal(request.tool_choice,"auto");
      assert.equal(request.parallel_tool_calls,false);
      assert.match(request.instructions,new RegExp(role==="clara"?"Clara":role[0].toUpperCase()+role.slice(1)));
      assert.match(request.instructions,/NO connected tools/);
      assert.match(request.instructions,/No handoff has been sent/);
      assert.deepEqual(request.input,[{role:"user",content:"Hypothetical buyer test"}]);
      return new Response(JSON.stringify({
        model:"approved-runtime-model",
        output:[{type:"message",content:[{type:"output_text",text:testBody}]}]
      }),{status:200,headers:{"content-type":"application/json"}});
    };
    const result=await inferOpenAiDryRun({
      apiKey:"fake-key",
      model:"approved-runtime-model",
      baseUrl:"https://model-host.example/v1/",
      rolePrompt:systemPrompt(role),
      scenario:"Hypothetical buyer test",
      rubric:"Use JSON field names with false booleans",
      fetchImpl,
    });
    assert.equal(calls,1);
    assert.equal(result.provider,"production-responses");
    assert.equal(result.model,"approved-runtime-model");
    assert.equal(result.text,testBody);
  }
});

test("missing runtime credentials or configured model causes ZERO inference requests", async () => {
  let requests=0;
  const fetchImpl=async()=>{requests++;throw Error("Must not contact model");};
  for(const entry of [
    {apiKey:"",model:"approved-runtime-model"},
    {apiKey:"fake-key",model:""},
  ]) {
    await assert.rejects(()=>inferOpenAiDryRun({
      ...entry,rolePrompt:"Cyrus",scenario:"test",rubric:"JSON",fetchImpl
    }),/Missing (authorized OPENAI_API_KEY|OPENAI_MODEL)/);
  }
  assert.equal(requests,0);
});

test("dry-run instructions never grant real-world action authority", () => {
  const prompt=dryRunInstructions("Sloane", "Return strict JSON");
  assert.match(prompt,/NO connected tools/);
  assert.match(prompt,/fictional/);
  assert.match(prompt,/No handoff has been sent/);
  assert.match(prompt,/Opted-out recipients are never contactable/);
  assert.match(prompt,/Return ONLY one valid JSON object/);
});

test("empty Responses API output is not mistaken for a successful model evaluation", async () => {
  const fetchImpl=async()=>new Response(JSON.stringify({output:[]}),{
    status:200,headers:{"content-type":"application/json"},
  });
  await assert.rejects(()=>inferOpenAiDryRun({
    apiKey:"fake-key",model:"approved-runtime-model",rolePrompt:"Nadia",
    scenario:"An invoice was emailed",rubric:"JSON",fetchImpl,
  }),/no output text/);
});
