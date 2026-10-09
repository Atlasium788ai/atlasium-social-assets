// A direct request to discuss, reflect, or roleplay is not authority to execute.
// Prefer explicit intent signals; operational commands retain the tool-enabled path.
export function isConversationOnly(text) {
  const input = String(text || "").trim();
  if (!input) return false;
  const explicit = /\b(?:conversational|personality|dialogue|roleplay|hypothetical|thought experiment)\s+(?:test|exercise|situation|scenario|only)\b|\b(?:this is|it's|it is)\s+(?:a\s+)?(?:conversation|hypothetical|roleplay|personality test)\b|\b(?:just|only)\s+(?:talk|chat|discuss|answer)\b|\b(?:what would you say|how would you respond|speak to me|talk to me like|respond in your own voice)\b/i.test(input);
  const forbid = /\b(?:do not|don't|without|no)\s+(?:use\s+)?(?:tools?|delegate|contact|send|spend|change|modify|execute|perform|take action|business systems|outreach)\b/i.test(input);
  if (explicit && forbid) return true;
  if (explicit && /\b(?:hypothetical|roleplay|thought experiment|personality test|conversational test)\b/i.test(input)) return true;
  // Ordinary informal questions, not embedded operational directives.
  if (/^(?:hey[,.! ]*|hi[,.! ]*|hello[,.! ]*|cyrus[,: ]+)?(?:how are you|how's it going|what's your take|what do you think|how do you feel|tell me what you think|are you serious|why do you sound like a robot)\b/i.test(input) && !/\b(?:send|post|deploy|run|launch|book|schedule|contact|create|update|fix|check|verify|delegate|inspect)\b/i.test(input)) return true;
  return false;
}
