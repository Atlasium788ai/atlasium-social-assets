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
    [/\b(?:follow[\s-]?up|reminder|confirmation email|nurtur(?:e|ing))\b/i, "Automated follow-ups and reminders"],
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
