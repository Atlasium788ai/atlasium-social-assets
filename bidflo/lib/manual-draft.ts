import type { OpportunityInput, ProposalDraft } from "./types";

function cleanLine(value: string, maxLength = 220) {
  return value.replace(/[\r\n\t]+/g, " ").replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/** Safe degraded mode, always requiring human review and approval. */
export function prepareManualReviewDraft(opportunity: OpportunityInput, commercials: ProposalDraft): ProposalDraft {
  const title = cleanLine(opportunity.title, 150) || "your project";
  const requirements = opportunity.requirements
    .map((requirement) => cleanLine(requirement))
    .filter(Boolean)
    .slice(0, 5);
  const scope = requirements.length
    ? requirements.map((requirement) => `- ${requirement}`).join("\n")
    : "- Confirm the core requirements and first-release acceptance criteria";
  const body = [
    `Your ${title} brief is in the area of systems integration, web applications, and automation that Atlasium works on.`,
    "",
    "For an initial release, I would confirm scope and dependencies first, then deliver a focused implementation against agreed acceptance criteria.",
    "",
    "The requirements I would use as the starting checklist are:",
    scope,
    "",
    `A preliminary delivery plan is ${commercials.timeline}, divided into discovery, core implementation, and QA/handoff milestones. This is a planning estimate, subject to reviewing the actual scope and integrations.`,
    "",
    "Which integrations and data sources are essential for the first release? What would you need to see in the first demonstration to consider it a success?",
    "",
    "Blair",
    "Atlasium",
  ].join("\n");
  return {
    ...commercials,
    body,
    questions: [
      "Which integrations and data sources are essential for the first release?",
      "What would you need to see in the first demonstration to consider it successful?",
    ],
  };
}
