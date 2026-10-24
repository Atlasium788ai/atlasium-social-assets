/**
 * Upwork clients sometimes require a literal opening phrase to filter
 * applications. Detect only explicit, short, quoted requirements; never
 * follow other job-text instructions or invent portfolio references.
 */
export function requiredProposalOpening(description: string): string | null {
  const text = description.slice(0, 12_000);
  const match = text.match(
    /\b(?:start|begin)\s+(?:your\s+)?(?:proposal|application|cover\s+letter)\s+with\s+(?:(?:the\s+)?(?:exact\s+)?(?:words?|phrase)\s+)?["'“‘]([^"'”“’\n]{1,80})["'”’]|\b(?:proposal|application|cover\s+letter)\s+(?:must|should|needs?\s+to)\s+(?:start|begin)\s+with\s+(?:(?:the\s+)?(?:exact\s+)?(?:words?|phrase)\s+)?["'“‘]([^"'”“’\n]{1,80})["'”’]/i,
  );
  const raw = (match?.[1] ?? match?.[2] ?? "").trim().replace(/\s+/g, " ");
  if (!raw || raw.includes("://") || raw.length > 70) return null;
  return raw;
}

export function proposalMeetsRequiredOpening(description: string, body: string): boolean {
  const phrase = requiredProposalOpening(description);
  return !phrase || body.trimStart().startsWith(phrase);
}

/** Project-specific evidence must be supplied by a human, never invented. */
export function requiresVerifiedExample(description: string): boolean {
  return /\b(?:share|provide|include|show|mention|give)\b.{0,100}\b(?:similar|comparable|previous|past)\b.{0,45}\b(?:project|work|case study|example)\b/i.test(description)
    || /\b(?:share|provide|include|show)\s+(?:a|an|one|your)?\s*(?:completed|relevant)\s+(?:project|case study|work sample|example)\b/i.test(description);
}

export function requestsDeliveryCommitment(description: string): boolean {
  return /\b(?:deliver|delivery|deadline|commitment|within|by)\b.{0,35}\b(?:30|thirty)[\s–-]*days?\b/i.test(description)
    || /\b(?:30|thirty)[\s–-]*days?\b.{0,35}\b(?:delivery|deadline|commitment)\b/i.test(description)
    || /\b(?:by|within)\s+day\s*(?:30|thirty)\b/i.test(description);
}

export function requestsShortProposal(description: string): boolean {
  return /\b(?:3\s*(?:-|–|to)\s*5|three\s*(?:-|–|to)\s*five)\s+sentences?\b/i.test(description);
}

export function proposalApprovalIssues(description: string, body: string): string[] {
  const issues: string[] = [];
  if (!proposalMeetsRequiredOpening(description, body)) {
    issues.push("Start the proposal with the exact client-required words: " + requiredProposalOpening(description));
  }
  // Review placeholders must not accidentally become submitted applications.
  if (/\[(?:add|insert|confirm|replace|provide|verify|your)[^\]\r\n]{2,160}\]/i.test(body)) {
    issues.push("Replace bracketed review notes with verified information");
  }
  return issues;
}
