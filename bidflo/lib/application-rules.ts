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
