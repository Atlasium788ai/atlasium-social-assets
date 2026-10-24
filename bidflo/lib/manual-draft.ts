import type { OpportunityInput, ProposalDraft } from "./types";
import { requiredProposalOpening, requestsShortProposal, requiresVerifiedExample, requestsDeliveryCommitment } from "./application-rules";
import { extractManualRequirements } from "./job-requirements";

function cleanLine(value: string, maxLength = 220) {
  return value.replace(/[\r\n\t]+/g, " ").replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sentenceList(values: string[]) {
  if (values.length < 2) return values[0] ?? "the agreed first-release scope";
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function tailoredQuestions(opportunity: OpportunityInput) {
  const source = `${opportunity.title} ${opportunity.description} ${opportunity.requirements.join(" ")}`.toLowerCase();
  const questions: string[] = [];
  if (/crm|lead capture|qualification/.test(source)) questions.push("Which CRM is currently in place, and what fields or lifecycle stages must be preserved?");
  if (/social|funnel|campaign|prospect|lead/.test(source)) questions.push("Which traffic sources and prospect segments should the first workflow handle?");
  if (/appointment|booking|calendar|schedul/.test(source)) questions.push("Which scheduling and calendar tools need to be part of the booking flow?");
  if (/integration|data source|migration|api/.test(source)) questions.push("Which systems and data sources are essential for the first release?");
  questions.push("What result should the first working demonstration prove for you?");
  return [...new Set(questions)].slice(0, 3);
}

function currency(amount: number, code = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: 0 }).format(amount);
}

/** Safe degraded mode, always requiring human review and approval. */
export function prepareManualReviewDraft(opportunity: OpportunityInput, commercials: ProposalDraft): ProposalDraft {
  const title = cleanLine(opportunity.title, 150) || "your project";
  const requirements = (opportunity.requirements.length
    ? opportunity.requirements
    : extractManualRequirements(opportunity.description))
    .map((requirement) => cleanLine(requirement))
    .filter(Boolean)
    .slice(0, 8);
  const priorities = requirements.length ? requirements.slice(0, 3) : ["the core workflow", "its integrations", "clear acceptance criteria"];
  const scope = requirements.length ? requirements.map((requirement) => `- ${requirement}`).join("\n") : "- Confirm the core workflow and first-release acceptance criteria";
  const questions = tailoredQuestions(opportunity);
  const milestones = commercials.milestones.slice(0, 3).map((milestone) => `- ${cleanLine(milestone.name, 100)}: ${cleanLine(milestone.deliverable, 220)}`).join("\n");
  const opener = requiredProposalOpening(opportunity.description);
  const wantsExample = requiresVerifiedExample(opportunity.description);
  const wantsShort = requestsShortProposal(opportunity.description);
  const requested30Days = requestsDeliveryCommitment(opportunity.description);
  const honestProof = "[Insert one genuine similar project you delivered and the outcome]";
  if (wantsShort) {
    const sentences = [
      `I would map your current systems, then build ${sentenceList(priorities.map((value) => cleanLine(value, 85)))} as one connected, testable workflow.`,
      requirements.length > 3
        ? `I would also include ${sentenceList(requirements.slice(3, 6).map((item) => /^Track /i.test(item) ? "tracking " + item.slice(6) : item[0].toLowerCase() + item.slice(1)))} in the build, validate the journey using test leads, and provide the requested documentation and training.`
        : /train|walkthrough|documentation|handoff/i.test(opportunity.description)
          ? "I would validate the funnel and pipeline using test leads, then provide documented handoff and the requested training."
          : "I would verify the workflow end to end before handoff and provide a clear operating guide.",
      wantsExample ? `${honestProof}.`
        : "I would divide the work into discovery, implementation, and acceptance testing.",
      `My fixed-price quote is ${currency(commercials.bidAmount, opportunity.currency ?? "USD")}, ${requested30Days ? "and [confirm ability to deliver within 30 days before applying]" : `with a preliminary timeline of ${commercials.timeline} subject to scope review`}.`,
      questions[0] + (questions[0].endsWith("?") ? "" : "?"),
    ];
    return {
      ...commercials,
      body: [opener, sentences.join(" "), "", "Blair", "Atlasium"].filter(Boolean).join("\n"),
      questions: questions.slice(0, 1),
    };
  }
  const body = [
    `Your ${title} brief calls for ${sentenceList(priorities.map((item) => cleanLine(item, 100)))}. I would treat those as one connected delivery so the handoffs, data, and reporting work together from the start.`,
    "",
    "I would begin by mapping the current tools, data sources, ownership, and success criteria. From there, I would build one end-to-end workflow first, demonstrate it with real test cases, and then complete the remaining automation and handoff documentation.",
    "",
    "The initial delivery checklist would be:",
    scope,
    "",
    milestones ? `Proposed milestones:\n${milestones}` : "The work would be divided into discovery, implementation, and QA/handoff milestones.",
    "",
    `The preliminary bid is ${currency(commercials.bidAmount, opportunity.currency ?? "USD")} over ${commercials.timeline}. I would confirm that after reviewing the existing systems and access requirements; no scope or integration is assumed at this stage.`,
    "",
    wantsExample ? `${honestProof}.` : "",
    questions.join(" "),
    "",
    "Blair",
    "Atlasium 7/88",
  ].join("\n");
  return {
    ...commercials,
    body: opener ? opener + "\n\n" + body : body,
    questions,
  };
}
