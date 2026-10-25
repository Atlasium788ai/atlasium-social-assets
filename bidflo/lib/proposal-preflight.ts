import { proposalApprovalIssues, requestsDeliveryCommitment, requestsShortProposal, requiresVerifiedExample } from "./application-rules";
import { extractManualRequirements } from "./job-requirements";
import type { OpportunityInput, ProposalDraft } from "./types";

type PreflightInput = {
  opportunity: OpportunityInput;
  proposal: ProposalDraft;
  proposalRules?: Record<string, unknown>;
  capabilityProfile?: Record<string, unknown>;
  approvedExamples?: string[];
};

const STOP_WORDS = new Set([
  "about", "after", "also", "and", "are", "build", "client", "for", "from", "have", "into", "need", "needs",
  "our", "project", "should", "that", "the", "their", "this", "through", "using", "want", "with", "work", "would",
]);

function words(value: string) {
  return value.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]{2,}/g) ?? [];
}

function distinctiveWords(value: string) {
  return [...new Set(words(value).filter((word) => !STOP_WORDS.has(word)))];
}

function wordCount(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function sentenceCount(value: string) {
  const withoutSignoff = value
    .replace(/^\s*(?:Blair|Atlasium(?: 7\/88)?)\s*$/gim, "")
    .trim();
  return (withoutSignoff.match(/[^.!?\n][.!?](?=\s|$)/g) ?? []).length;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function requirementCovered(requirement: string, body: string) {
  const bodyWords = new Set(distinctiveWords(body));
  const requirementWords = distinctiveWords(requirement);
  if (!requirementWords.length) return true;
  const matched = requirementWords.filter((word) => bodyWords.has(word)).length;
  return matched >= Math.min(2, requirementWords.length);
}

function evidenceCovered(body: string, evidence: string[]) {
  return evidence.some((item) => {
    const tokens = distinctiveWords(item);
    if (!tokens.length) return false;
    const bodyTokens = new Set(distinctiveWords(body));
    return tokens.filter((token) => bodyTokens.has(token)).length >= Math.min(2, tokens.length);
  });
}

function concreteClaimNeedsEvidence(body: string) {
  return /\b(?:i|we|our team)\s+(?:have\s+)?(?:built|delivered|implemented|launched|managed|helped|worked)\b/i.test(body)
    || /\b\d{1,3}\+?\s+years?\b/i.test(body)
    || /\b(?:certified|certification|award-winning)\b/i.test(body)
    || /\b(?:increased|improved|reduced|generated|saved)\b.{0,50}\b(?:\d+(?:\.\d+)?%|\$[\d,.]+)\b/i.test(body);
}

function proposalMentionsAmount(body: string, amount: number) {
  const plain = String(Math.round(amount * 100) / 100);
  const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount);
  return body.replace(/,/g, "").includes(plain.replace(/,/g, "")) || body.includes(formatted);
}

function hasPracticalPlan(body: string) {
  const actions = body.match(/\b(?:audit|build|configure|connect|design|document|implement|integrate|map|migrate|prototype|set up|test|validate|verify)\b/gi) ?? [];
  return new Set(actions.map((action) => action.toLowerCase())).size >= 2;
}

function hasRelevantQuestion(opportunity: OpportunityInput, questions: string[]) {
  const scopeTerms = new Set(distinctiveWords(`${opportunity.title} ${opportunity.requirements.join(" ")}`));
  return questions.some((question) => {
    if (!question.trim().endsWith("?")) return false;
    const terms = distinctiveWords(question);
    return terms.some((term) => scopeTerms.has(term))
      || /\b(?:acceptance|access|calendar|crm|current|data|demonstration|metric|priority|result|source|system|tool|user|workflow)\b/i.test(question);
  });
}

function hasClientCallToAction(body: string) {
  const questions = body.match(/[^?\n]{8,}\?/g) ?? [];
  return questions.some((question) => /\b(?:available|calendar|call|confirm|current|discuss|priority|review|share|start|system|tool|workflow)\b/i.test(question));
}

export function rebalanceMilestones(milestones: ProposalDraft["milestones"], bidAmount: number) {
  if (!milestones.length) return milestones;
  const oldTotal = milestones.reduce((sum, milestone) => sum + Number(milestone.amount || 0), 0);
  let allocated = 0;
  return milestones.map((milestone, index) => {
    const amount = index === milestones.length - 1
      ? Math.round((bidAmount - allocated) * 100) / 100
      : Math.round((oldTotal > 0 ? bidAmount * Number(milestone.amount || 0) / oldTotal : bidAmount / milestones.length) * 100) / 100;
    allocated += amount;
    return { ...milestone, amount };
  });
}

/**
 * Deterministic release gate applied after AI QC and again at approval time.
 * It catches objective failures that a model review must never waive.
 */
export function proposalPreflight(input: PreflightInput) {
  const { opportunity, proposal } = input;
  const rules = input.proposalRules ?? {};
  const issues = proposalApprovalIssues(opportunity.description, proposal.body);
  const maximumWords = Number(rules.maxWords ?? 350);
  const proposalWords = wordCount(proposal.body);

  if (Number.isFinite(maximumWords) && proposalWords > maximumWords) {
    issues.push(`Shorten the proposal to ${maximumWords} words or fewer (currently ${proposalWords})`);
  }

  const bannedPhrases = stringArray(rules.bannedPhrases);
  const usedBannedPhrase = bannedPhrases.find((phrase) => proposal.body.toLowerCase().includes(phrase.toLowerCase()));
  if (usedBannedPhrase) issues.push(`Remove the banned phrase: ${usedBannedPhrase}`);
  if (/\b(?:dear hiring manager|i am excited to apply|i would love the opportunity|i am confident i (?:am|would be) the perfect fit)\b/i.test(proposal.body)) {
    issues.push("Replace the generic proposal opening with a direct client-specific opening");
  }

  if (["fixed", "hourly"].includes(opportunity.budgetType ?? "") && opportunity.budgetMax != null && proposal.bidAmount > opportunity.budgetMax) {
    issues.push(`${opportunity.budgetType === "hourly" ? "Hourly rate" : "Bid amount"} exceeds the client's stated ${opportunity.currency ?? "USD"} ${opportunity.budgetMax} maximum`);
  }

  if (!Number.isFinite(proposal.bidAmount) || proposal.bidAmount <= 0) issues.push("Set a valid positive bid amount");
  else if (!proposalMentionsAmount(proposal.body, proposal.bidAmount)) {
    issues.push(`State the proposed ${opportunity.budgetType === "hourly" ? "hourly rate" : "price"} in the proposal body`);
  }
  const milestoneTotal = proposal.milestones.reduce((sum, milestone) => sum + Number(milestone.amount || 0), 0);
  if (!proposal.milestones.length) issues.push("Add at least one priced delivery milestone");
  else if (Math.abs(milestoneTotal - proposal.bidAmount) > 0.01) issues.push("Make milestone amounts add up to the bid amount");

  if (!proposal.timeline.trim() || /^(?:tbd|unknown|n\/?a)$/i.test(proposal.timeline.trim())) {
    issues.push("Set a realistic delivery timeline");
  } else if (!/\b(?:day|days|week|weeks|month|months|ongoing)\b/i.test(proposal.body)) {
    issues.push("State the expected delivery timeline in the proposal body");
  }
  if (!hasRelevantQuestion(opportunity, proposal.questions)) {
    issues.push("Add at least one client-specific question");
  }
  if (!hasClientCallToAction(proposal.body)) {
    issues.push("End with a brief client-specific question that invites the next step");
  }
  if (!hasPracticalPlan(proposal.body)) issues.push("Describe a practical delivery approach with concrete implementation and validation steps");

  const requirements = (opportunity.requirements.length ? opportunity.requirements : extractManualRequirements(opportunity.description))
    .filter((requirement) => requirement.trim().length > 5)
    .slice(0, 8);
  const uncovered = requirements.filter((requirement) => !requirementCovered(requirement, proposal.body));
  const minimumCovered = Math.min(requirements.length, Math.max(1, Math.ceil(requirements.length * 0.6)));
  if (requirements.length - uncovered.length < minimumCovered) {
    issues.push(`Address more of the client's actual scope; missing: ${uncovered.slice(0, 3).join("; ")}`);
  }

  if (requestsShortProposal(opportunity.description)) {
    const sentences = sentenceCount(proposal.body);
    if (sentences < 3 || sentences > 5) issues.push(`Use the client's requested 3–5 sentence format (currently ${sentences})`);
  }

  if (requestsDeliveryCommitment(opportunity.description)
    && !/(?:30|thirty)[\s–-]*days?/i.test(`${proposal.body} ${proposal.timeline}`)) {
    issues.push("Explicitly confirm the requested 30-day delivery commitment after verifying feasibility");
  }

  const profileProof = stringArray(input.capabilityProfile?.proof);
  const evidence = [...profileProof, ...(input.approvedExamples ?? [])];
  if (requiresVerifiedExample(opportunity.description) && !evidenceCovered(proposal.body, evidence)) {
    issues.push("Include a relevant example that is verified in Atlasium's approved proof library");
  } else if (concreteClaimNeedsEvidence(proposal.body) && !evidenceCovered(proposal.body, evidence)) {
    issues.push("Remove or verify the proposal's experience, credential, or performance claim");
  }

  if (/\b(?:guarantee(?:d)?|100% guaranteed|zero risk|risk-free|flawless)\b/i.test(proposal.body)
    || /\b(?:will|can)\s+(?:double|triple)\b/i.test(proposal.body)) {
    issues.push("Remove unrealistic or guaranteed outcome language");
  }

  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}
