/** Extract only requirements supported by the pasted posting. */
export function extractManualRequirements(description: string): string[] {
  const bulletLines = description.split(/\r?\n/)
    .filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line))
    .map((line) => line.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter((line) => line.length > 6 && line.length <= 300);
  if (bulletLines.length >= 2) return [...new Set(bulletLines)].slice(0, 10);

  // Jobs copied as a single paragraph still need a meaningful scope.
  const signals: Array<[RegExp, string]> = [
    [/\b(?:lead qualification|qualif(?:ied|y|ication)\s+leads?)\b/i, "Lead qualification and routing"],
    [/\b(?:crm|sales pipeline|deal pipeline)\b/i, "CRM setup and sales pipeline tracking"],
    [/\b(?:appointment booking|calendar|book(?:ed|ing)? calls?|scheduling)\b/i, "Calendar booking and appointment scheduling"],
    [/\b(?:follow[\s-]?ups?|reminders?|confirmation emails?|nurtur(?:e|ing))\b/i, "Automated follow-ups and reminders"],
    [/\b(?:linkedin outreach|linkedin leads?)\b/i, "Track LinkedIn outreach leads"],
    [/\b(?:dashboard|reporting|metrics)\b/i, "Reporting and results dashboard"],
    [/\b(?:social traffic|lead funnel|funnel)\b/i, "Lead funnel and conversion flow"],
    [/\b(?:training session|walkthrough|documentation|written handover)\b/i, "Training and documentation"],
    [/\b(?:post.launch support|30.days? support|support through|ongoing support)\b/i, "Post-launch support"],
    [/\b(?:affiliate|sponsorship|partner pipeline)\b/i, "Partner and sponsorship pipeline"],
    [/\b(?:api integration|integrations?|data sources?)\b/i, "Integration with existing systems"],
  ];
  return signals.filter(([regex]) => regex.test(description)).map(([, requirement]) => requirement).slice(0, 9);
}

/**
 * Normalize historical JSON shapes before proposal/qualification code sees them.
 * Early Visez records can contain a JSON string or an object instead of the
 * current string-array representation. Keep recovery conservative: preserve
 * only textual values and never manufacture requirements.
 */
export function normalizeStoredRequirements(value: unknown): string[] {
  const collected: string[] = [];

  function collect(input: unknown, depth = 0) {
    if (depth > 3 || input == null) return;
    if (Array.isArray(input)) {
      for (const item of input) collect(item, depth + 1);
      return;
    }
    if (typeof input === "string") {
      const trimmed = input.trim();
      if (!trimmed) return;
      if ((trimmed.startsWith("[") && trimmed.endsWith("]"))
        || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
        try {
          collect(JSON.parse(trimmed), depth + 1);
          return;
        } catch {
          // Preserve a non-JSON string exactly as stored.
        }
      }
      collected.push(trimmed.replace(/\s+/g, " ").slice(0, 300));
      return;
    }
    if (typeof input === "object") {
      const record = input as Record<string, unknown>;
      if ("requirements" in record) {
        collect(record.requirements, depth + 1);
        return;
      }
      for (const item of Object.values(record)) collect(item, depth + 1);
    }
  }

  collect(value);
  return [...new Set(collected.filter((item) => item.length > 1))].slice(0, 12);
}
