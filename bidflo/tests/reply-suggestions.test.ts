import assert from "node:assert/strict";
import test from "node:test";
import { REPLY_TONES, safeSuggestedReply, starterReply } from "../lib/reply-suggestions";

test("three distinct Upwork-only starter tones encourage a meeting", () => {
  const texts = REPLY_TONES.map((tone) => starterReply("CRM Automation", "Could you tell me more?", tone, 0));
  assert.equal(new Set(texts).size, 3);
  for (const value of texts) {
    assert.match(value, /Upwork Messages/);
    assert.match(value, /meeting/);
    assert.equal(safeSuggestedReply(value), true);
    assert.doesNotMatch(value, /calendly|zoom|https?:|@/i);
  }
});

test("regenerate rotates drafts and can return to the previous version", () => {
  const first = starterReply("CRM Automation", "I have a question", "direct", 0);
  const second = starterReply("CRM Automation", "I have a question", "direct", 1);
  assert.notEqual(first, second);
  assert.equal(first, starterReply("CRM Automation", "I have a question", "direct", 0));
});

test("when a client already requests a call, acknowledge rather than asking again", () => {
  const text = starterReply("System Integration", "Can we schedule a meeting?", "friendly", 0);
  assert.match(text, /send a meeting invitation/);
  assert.doesNotMatch(text, /Would you be open/);
});

test("reject off-platform booking and missing meeting CTA", () => {
  assert.equal(safeSuggestedReply("Message me at info@example.com and we can talk on Zoom tomorrow. Open Upwork Messages."), false);
  assert.equal(safeSuggestedReply("Thanks, here is my Calendly: https://calendly.com/team. Let's meet in Upwork."), false);
  assert.equal(safeSuggestedReply("Thanks for the message, we will discuss the proposal internally then reply next week without a call."), false);
});
