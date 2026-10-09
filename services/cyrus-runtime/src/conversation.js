// Distinguish a request to talk from authorization to operate business systems.
// An internal handoff can be a conversation, but it must be explicit; no unattended
// operational handoff is downgraded into conversational mode.
const namePrefix = /^(?:(?:cyrus|malik|clara|mateo|kenji|amara|nadia|sloane)\s*[:,]\s*)/i;
const internalPrefix = /^Internal handoff from [a-z-]+:\s*/i;

export function isStructuredUpdateRequest(text) {
  const input = String(text || "").replace(internalPrefix, "").replace(namePrefix, "").trim();
  return /\b(?:structured|formal|detailed|written|weekly|monthly|daily)\s+(?:update|report|brief|briefing|summary|dashboard)\b|\b(?:table|spreadsheet|scorecard|kpi|metrics report|breakdown|bullet(?:\s*point)?s?|point\s*form)\b|\b(?:give|show|pull|fetch|provide|prepare|generate|write)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(?:status\s+)?(?:update|report|dashboard|scorecard|metrics|numbers)\b/i.test(input);
}

export function isConversationOnly(text) {
  const input = String(text || "").replace(internalPrefix, "").replace(namePrefix, "").trim();
  if (!input || isStructuredUpdateRequest(input)) return false;

  const explicitConversation = /\b(?:conversational|personality|dialogue|roleplay|hypothetical|thought experiment)\s+(?:test|exercise|situation|scenario|only)\b|\b(?:this is|it's|it is)\s+(?:a\s+)?(?:conversation|hypothetical|roleplay|personality test)\b|\b(?:just|only)\s+(?:talk|chat|discuss|answer)\b|\b(?:what would you say|how would you respond|speak to me|talk to me like|respond in your own voice)\b/i.test(input);
  const forbidsActions = /\b(?:do not|don't|without|no)\s+(?:use\s+)?(?:tools?|delegate|contact|send|spend|change|modify|execute|perform|take action|business systems|outreach)\b/i.test(input);
  // A discussion explicitly fenced off from execution is always read-only.
  if (explicitConversation && forbidsActions) return true;

  const actionVerbs = "(?:check|verify|find|fetch|inspect|send|post|create|schedule|book|delegate|update|change|fix|launch|deploy|activate|run|pull|contact|email|message|call|connect|charge|buy|pay|delete|save|record|remember|assign|build|draft|start|stop|turn|enable|disable|configure|publish|upload|download|remove|archive|invite|approve|reject|refund|hire|fire|research|investigate|audit|analyze|get|execute|handle|prepare)";
  const positiveAction = new RegExp(
    "\\b(?:please|go ahead and|i need you to|we need to|let's|can you|could you|would you|then|also|and then)\\s+(?:(?:actually|now|just|go)\\s+)?"+actionVerbs+"\\b|^"+actionVerbs+"\\b|\\b(?:do it|do this|go get it done|make it happen|take care of it)\\b", "i"
  );
  if (positiveAction.test(input)) return false;

  // A request for current, exact or audited facts warrants tools/evidence.
  const freshMetrics = /\b(?:how many|how much|exact|current|today|live|latest|right now|up.to.date|as of now)\b[\s\S]{0,90}\b(?:numbers|figures|metrics|results|replies|campaigns|sales|revenue|balance|cash|spend|pipeline|meetings|appointments|leads|prospects|invoices|payments)\b|\b(?:numbers|figures|metrics|results|replies|campaigns|sales|revenue|balance|cash|spend|pipeline|meetings|appointments|leads|prospects|invoices|payments)\b[\s\S]{0,60}\b(?:today|right now|latest|current|exact|live)\b/i;
  if (freshMetrics.test(input)) return false;

  if (explicitConversation) return true;
  if (/^(?:hey[,.! ]*|hi[,.! ]*|hello[,.! ]*|so[,.! ]*|okay[,.! ]*|ok[,.! ]*)?(?:how are you|how's it going|what's your take|what do you think|what are your thoughts|how do you feel|tell me what you think|tell me your opinion|are you serious|why do you sound like a robot|what would you do|what should we do|should we|do you agree|can we talk|let's talk|can we discuss|let's discuss|talk me through|help me think through|here's what i'm thinking|i'm worried|i'm concerned|i'm frustrated|i don't like|i'm thinking|i think|i feel|do you think|what if|suppose|imagine|why do you think)\b/i.test(input)) return true;

  // Many natural replies do not begin with a question or a fixed phrase:
  // "That feels wrong", "I disagree", "The positioning is too generic".
  // Prefer discussion over taking unrequested action.
  if (/^(?:what(?:'s| is) (?:the )?(?:status|progress|update)|how far (?:are we|did you|get)|where are we at|any (?:new|latest) (?:replies|meetings|leads|sales|results))\b/i.test(input)) return false;
  return !/^(?:send|schedule|book|launch|start|stop|turn on|turn off|do|go|execute|deploy|check|verify|investigate|research|fix|update|create|make|build|draft|write|prepare|find|get|pull|contact|email|message|call|save|record|approve|reject|refund|hire|fire|remove|delete|archive|invite|run|enable|disable|upload|download|publish|analyze|audit)\b/i.test(input);
}
