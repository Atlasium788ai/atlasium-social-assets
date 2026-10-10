import test from "node:test";
import assert from "node:assert/strict";
import { DOCTRINE_VERSION, EXECUTIVE_DOCTRINE } from "../src/operating_doctrine.js";
import { systemPrompt } from "../src/personality.js";
import { ATLASIUM_OPERATING_BRIEF } from "../src/operating_context.js";

const roles = ["cyrus", "malik", "clara", "mateo", "kenji", "amara", "nadia", "sloane"];

test("the same versioned doctrine is present in every executive system prompt", () => {
  assert.match(DOCTRINE_VERSION, /^20\d\d-\d\d-\d\d-v\d+$/);
  for (const role of roles) {
    const instructions = systemPrompt(role);
    assert.ok(instructions.includes(EXECUTIVE_DOCTRINE), role + " missing common operating doctrine");
    assert.match(instructions, /Operate as one coordinated, fast, commercially relentless organization/);
    assert.match(instructions, /Detect new evidence from authorized systems/);
    assert.match(instructions, /Prioritize the shortest safe path/);
    assert.match(instructions, /record meaningful lessons and decisions in durable memory/);
    assert.match(instructions, /Follow up on unfinished authorized work/);
    assert.match(instructions, /Never fabricate visitors, followers, leads, meetings, revenue/);
    assert.match(instructions, /Improve performance continuously without weakening controls/);
    assert.match(instructions, /Obtain required approval before new spending/);
    assert.match(instructions, /speed depends on tool latency, permissions and cost/i);
    assert.match(instructions, /COMMUNICATION ACROSS COMMAND88/);
  }
});

test("roles retain different personalities, responsibilities and limits", () => {
  const prompts = roles.map(systemPrompt);
  assert.equal(new Set(prompts).size, 8);
  for (const role of roles) {
    assert.match(systemPrompt(role), new RegExp(role === "cyrus" ? "Chief of Staff" : role === "malik" ? "Head of Revenue" : role === "clara" ? "Executive Assistant" : role === "mateo" ? "Head of Marketing" : role === "kenji" ? "Head of Product" : role === "amara" ? "Head of Client Success" : role === "nadia" ? "Head of Finance" : "Head of Legal", "i"));
  }
});

test("doctrine builds on existing company goals, not synthetic traction", () => {
  assert.match(ATLASIUM_OPERATING_BRIEF, /collected revenue|COLLECTED REVENUE/i);
  assert.match(EXECUTIVE_DOCTRINE, /real marketing demand/);
  assert.match(EXECUTIVE_DOCTRINE, /Obey consent, opt-outs, privacy/);
});
