import type { OpportunityInput, QualificationRules, ScoreBreakdown } from "./types";

function includesAny(haystack: string, needles: string[]) {
  return needles.filter((needle) => haystack.includes(needle.toLowerCase()));
}

export function qualifyOpportunity(opportunity: OpportunityInput, rules: QualificationRules) {
  const text = `${opportunity.title}\n${opportunity.description}\n${opportunity.requirements.join("\n")}`.toLowerCase();
  const fitMatches = includesAny(text, rules.serviceFitKeywords);
  const poorMatches = includesAny(text, rules.poorFitKeywords);
  const complexityMatches = includesAny(text, rules.complexityPenaltyKeywords);
  const recurringMatches = includesAny(text, rules.recurringKeywords);
  const budget = opportunity.budgetMax ?? opportunity.budgetMin;

  const serviceFit = Math.min(25, 5 + fitMatches.length * 5);
  const budgetScore = budget == null ? 8 : Math.max(0, Math.min(20, Math.round((budget / Math.max(rules.minimumBudget, 1)) * 12)));
  const profitability = budget == null
    ? 8
    : opportunity.budgetType === "hourly"
      ? Math.max(0, Math.min(15, Math.round((budget / Math.max(rules.targetHourlyRate, 1)) * 15)))
      : budget >= rules.minimumBudget
        ? 15
        : Math.round((budget / Math.max(rules.minimumBudget, 1)) * 15);
  const complexity = Math.max(0, 15 - complexityMatches.length * 5);
  const deliveryFeasibility = Math.max(0, Math.min(15, 6 + fitMatches.length * 3 - poorMatches.length * 8));
  const recurringRevenue = Math.min(10, recurringMatches.length * 5);
  const rawScore = serviceFit + budgetScore + profitability + complexity + deliveryFeasibility + recurringRevenue;
  const score = Math.max(0, Math.min(100, poorMatches.length ? rawScore - 35 : rawScore));
  const reasons = [
    fitMatches.length ? `Matched capabilities: ${fitMatches.join(", ")}` : "Limited explicit Atlasium capability match",
    budget == null ? "Budget was not stated" : `Budget signal: ${opportunity.currency ?? "USD"} ${budget}`,
    recurringMatches.length ? `Recurring potential: ${recurringMatches.join(", ")}` : "No recurring-revenue signal",
    ...complexityMatches.map((match) => `Delivery risk: ${match}`),
    ...poorMatches.map((match) => `Poor-fit signal: ${match}`),
  ];
  const breakdown: ScoreBreakdown = { serviceFit, budget: budgetScore, profitability, complexity, deliveryFeasibility, recurringRevenue, reasons };
  const rejected = score < rules.minimumScore || poorMatches.length > 0;

  return {
    score,
    breakdown,
    rejected,
    rejectionReason: rejected ? (poorMatches.length ? `Poor-fit signal: ${poorMatches.join(", ")}` : `Score ${score} is below threshold ${rules.minimumScore}`) : null,
    recurringPotential: recurringMatches.length > 0,
  };
}

export function recommendCommercials(opportunity: OpportunityInput, targetHourlyRate: number) {
  const maximum = opportunity.budgetMax ?? opportunity.budgetMin;
  let bidAmount: number;
  if (opportunity.budgetType === "hourly") bidAmount = Math.max(targetHourlyRate, Math.min(maximum ?? targetHourlyRate, targetHourlyRate * 1.15));
  else if (maximum) bidAmount = Math.max(500, Math.round(maximum * 0.92 / 50) * 50);
  else bidAmount = 2500;

  // Never automatically propose an amount above a client's stated ceiling.
  // Low-budget opportunities still need human review for profitability.
  if (maximum != null && maximum > 0) bidAmount = Math.min(bidAmount, maximum);

  const size = bidAmount < 1500 ? "1–2 weeks" : bidAmount < 5000 ? "2–4 weeks" : "4–8 weeks";
  const milestones = [
    { name: "Discovery & technical plan", amount: Math.round(bidAmount * 0.2), deliverable: "Confirmed scope, risks, acceptance criteria, and implementation plan" },
    { name: "Core implementation", amount: Math.round(bidAmount * 0.55), deliverable: "Working core solution demonstrated against agreed acceptance criteria" },
    { name: "QA, handoff & launch", amount: bidAmount - Math.round(bidAmount * 0.2) - Math.round(bidAmount * 0.55), deliverable: "Production verification, documentation, and handoff" },
  ];
  return { bidAmount, timeline: size, milestones };
}
