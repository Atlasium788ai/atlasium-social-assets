import type { OpportunityRow, OpportunityStatus } from "./types";

type OpportunityMode = "find" | "bid" | "follow" | "nurture" | "won";

const statusPriority: Record<OpportunityMode, Partial<Record<OpportunityStatus, number>>> = {
  find: {
    proposal_ready: 0,
    qualified: 1,
    new: 2,
    approved: 3,
    ready_to_submit: 3,
    submission_processing: 3,
    replied: 4,
    interviewed: 4,
    submitted: 5,
    won: 6,
    nurture: 7,
    opted_out: 9,
    rejected: 9,
  },
  bid: {
    proposal_ready: 0,
    approved: 1,
    ready_to_submit: 2,
    submission_processing: 3,
    qualified: 4,
  },
  follow: {
    replied: 0,
    interviewed: 1,
    submission_processing: 2,
    submitted: 3,
    nurture: 4,
    won: 5,
  },
  nurture: { nurture: 0 },
  won: { won: 0 },
};

function numeric(value: string | number | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

/** Stable, non-mutating ordering that puts the next revenue action first. */
export function prioritizeOpportunities(items: OpportunityRow[], mode: OpportunityMode) {
  return items.map((item, index) => ({ item, index })).sort((left, right) => {
    const leftStage = statusPriority[mode][left.item.status] ?? 99;
    const rightStage = statusPriority[mode][right.item.status] ?? 99;
    if (leftStage !== rightStage) return leftStage - rightStage;

    if (mode === "follow") {
      const leftDue = left.item.follow_up_state?.due ? 1 : 0;
      const rightDue = right.item.follow_up_state?.due ? 1 : 0;
      if (leftDue !== rightDue) return rightDue - leftDue;
    }

    const scoreDifference = numeric(right.item.score) - numeric(left.item.score);
    if (scoreDifference !== 0) return scoreDifference;
    const budgetDifference = numeric(right.item.budget_max) - numeric(left.item.budget_max);
    if (budgetDifference !== 0) return budgetDifference;
    const updatedDifference = Date.parse(right.item.updated_at) - Date.parse(left.item.updated_at);
    return updatedDifference || left.index - right.index;
  }).map(({ item }) => item);
}
