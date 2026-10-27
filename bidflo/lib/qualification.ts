import type { OpportunityInput, QualificationRules, ScoreBreakdown } from "./types";

function escapePattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+");
}

/** Match configured phrases as terms, so short keywords such as "ai" do not match "email". */
function matchingSignals(haystack: string, needles: string[]) {
  return needles.filter((needle) => {
    const value = needle.trim();
    return value.length > 0 && new RegExp(`(^|[^a-z0-9])${escapePattern(value)}($|[^a-z0-9])`, "i").test(haystack);
  });
}

function hasPermittedJobLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["upwork.com", "www.upwork.com"].includes(url.hostname.toLowerCase())
      && /^\/(?:jobs\/|nx\/search\/jobs\/details\/|freelance-jobs\/apply\/)/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function qualifyOpportunity(opportunity: OpportunityInput, rules: QualificationRules) {
  const text = `${opportunity.title}\n${opportunity.description}\n${opportunity.requirements.join("\n")}`;
  const fitMatches = matchingSignals(text, rules.serviceFitKeywords);
  const poorMatches = matchingSignals(text, rules.poorFitKeywords);
  const complexityMatches = matchingSignals(text, rules.complexityPenaltyKeywords);
  const recurringMatches = matchingSignals(text, rules.recurringKeywords);
  const unsafeSignals = [
    /\b(?:contact|message|reach)\s+(?:me|us)\s+(?:on|via)\s+(?:telegram|whatsapp)\b/i,
    /\b(?:pay|payment)\s+(?:outside|off)\s+(?:of\s+)?upwork\b/i,
    /\b(?:buy|purchase)\s+(?:equipment|gift cards?)\b/i,
    /\b(?:free|unpaid)\s+(?:trial|sample|test)\b/i,
  ].filter((pattern) => pattern.test(text));
  const budget = opportunity.budgetMax ?? opportunity.budgetMin;
  const isHourly = opportunity.budgetType === "hourly";
  const budgetTarget = isHourly ? rules.targetHourlyRate : rules.minimumBudget;
  const budgetRatio = budget == null ? null : budget / Math.max(budgetTarget, 1);
  const lowValue = budget != null && budget < budgetTarget;
  const thinBrief = opportunity.description.replace(/\s+/g, " ").trim().length < 50;
  const invalidSource = !hasPermittedJobLink(opportunity.jobUrl);
  const untitled = /^(?:untitled|new job|upwork opportunity)\b/i.test(opportunity.title.trim());

  const serviceFit = fitMatches.length ? Math.min(25, 8 + fitMatches.length * 4) : 0;
  const budgetScore = budgetRatio == null ? 7 : Math.max(0, Math.min(20, Math.round(budgetRatio * 20)));
  const profitability = budgetRatio == null ? 7 : Math.max(0, Math.min(15, Math.round(budgetRatio * 15)));
  const complexity = Math.max(0, 15 - complexityMatches.length * 4);
  const credibilityAdjustment = (opportunity.clientRating ?? 0) >= 4.8 ? 1
    : opportunity.clientRating != null && opportunity.clientRating < 4 ? -3
      : (opportunity.clientSpend ?? 0) >= 10_000 ? 1 : 0;
  const deliveryFeasibility = Math.max(0, Math.min(15,
    (fitMatches.length ? 8 + fitMatches.length * 2 : 2)
    - complexityMatches.length * 4 - (thinBrief ? 4 : 0) + credibilityAdjustment,
  ));
  const recurringRevenue = Math.min(10, recurringMatches.length * 5);
  const rawScore = serviceFit + budgetScore + profitability + complexity + deliveryFeasibility + recurringRevenue;
  const score = Math.max(0, Math.min(100, rawScore - poorMatches.length * 25 - unsafeSignals.length * 50));
  const opportunityTier = budget == null ? "Unpriced opportunity"
    : isHourly ? (budget >= rules.targetHourlyRate * 1.5 ? "Premium hourly opportunity" : "Core hourly opportunity")
      : budget >= 25_000 ? "Enterprise / premium opportunity"
        : budget >= 5_000 ? "Core revenue opportunity" : "Quick-win opportunity";

  const reasons = [
    fitMatches.length ? `Matched capabilities: ${fitMatches.join(", ")}` : "Limited explicit Atlasium capability match",
    budget == null ? "Budget was not stated" : `${isHourly ? "Hourly ceiling" : "Budget signal"}: ${opportunity.currency ?? "USD"} ${budget}`,
    opportunityTier,
    lowValue ? `${isHourly ? "Hourly ceiling" : "Fixed budget"} is below Atlasium's configured minimum` : "Budget meets the configured minimum",
    recurringMatches.length ? `Recurring potential: ${recurringMatches.join(", ")}` : "No recurring-revenue signal",
    thinBrief ? "Insufficient project detail to estimate delivery safely" : "Project brief has enough detail for initial qualification",
    invalidSource ? "Source is not a direct permitted Upwork job URL" : "Direct Upwork job URL verified",
    ...complexityMatches.map((match) => `Delivery risk: ${match}`),
    ...poorMatches.map((match) => `Poor-fit signal: ${match}`),
    ...unsafeSignals.map(() => "Unsafe or off-platform job instruction detected"),
  ];
  const breakdown: ScoreBreakdown = { serviceFit, budget: budgetScore, profitability, complexity, deliveryFeasibility, recurringRevenue, reasons };
  const rejectionReason = unsafeSignals.length ? "Unsafe or off-platform job instruction detected"
    : invalidSource ? "Source is not a direct permitted Upwork job URL"
      : untitled || thinBrief ? "Insufficient project detail for reliable qualification"
        : poorMatches.length ? `Poor-fit signal: ${poorMatches.join(", ")}`
          : fitMatches.length === 0 ? "No direct match to Atlasium's configured services"
            : lowValue ? `${isHourly ? "Hourly ceiling" : "Fixed budget"} ${opportunity.currency ?? "USD"} ${budget} is below the configured ${budgetTarget} minimum`
              : score < rules.minimumScore ? `Score ${score} is below threshold ${rules.minimumScore}` : null;
  const rejected = rejectionReason !== null;

  return {
    score,
    breakdown,
    rejected,
    rejectionReason,
    recurringPotential: recurringMatches.length > 0,
  };
}

export function recommendCommercials(opportunity: OpportunityInput, targetHourlyRate: number) {
  const maximum = opportunity.budgetMax ?? opportunity.budgetMin;
  let bidAmount: number;
  if (opportunity.budgetType === "hourly") bidAmount = maximum == null
    ? targetHourlyRate
    : Math.min(maximum, Math.max(opportunity.budgetMin ?? 0, targetHourlyRate));
  else if (maximum) bidAmount = Math.max(500, Math.round(maximum * 0.92 / 50) * 50);
  else bidAmount = 2500;

  // Never automatically propose an amount above a client's stated ceiling.
  // Low-budget opportunities still need human review for profitability.
  if (maximum != null && maximum > 0) bidAmount = Math.min(bidAmount, maximum);

  const scopeSignals = opportunity.requirements.length || Math.ceil(opportunity.description.length / 500);
  const size = opportunity.budgetType === "hourly"
    ? scopeSignals <= 2 ? "1–2 weeks for initial delivery" : scopeSignals <= 5 ? "2–4 weeks for initial delivery" : "4–8 weeks for initial delivery"
    : bidAmount < 1500 ? "1–2 weeks" : bidAmount < 5000 ? "2–4 weeks" : "4–8 weeks";
  if (opportunity.budgetType === "hourly") {
    return {
      bidAmount,
      timeline: size,
      milestones: [{
        name: "Hourly delivery rate", amount: bidAmount,
        deliverable: "Agreed hourly rate with scope, weekly progress, testing, and handoff tracked against the client's priorities",
      }],
    };
  }
  const milestones = [
    { name: "Discovery & technical plan", amount: Math.round(bidAmount * 0.2), deliverable: "Confirmed scope, risks, acceptance criteria, and implementation plan" },
    { name: "Core implementation", amount: Math.round(bidAmount * 0.55), deliverable: "Working core solution demonstrated against agreed acceptance criteria" },
    { name: "QA, handoff & launch", amount: bidAmount - Math.round(bidAmount * 0.2) - Math.round(bidAmount * 0.55), deliverable: "Production verification, documentation, and handoff" },
  ];
  return { bidAmount, timeline: size, milestones };
}
