import type { OpportunityStatus } from "./types";

// One shared source for every pipeline status, including future stages.
export type OpportunityStage = OpportunityStatus;

export function canEditProposal(stage: OpportunityStage): boolean {
  return stage === "proposal_ready" || stage === "approved";
}

export function canRescore(stage: OpportunityStage): boolean {
  return ["new", "rejected", "qualified", "proposal_ready"].includes(stage);
}

export function canApproveProposal(stage: OpportunityStage): boolean {
  return stage === "proposal_ready";
}

export function canConfirmManualSubmission(stage: OpportunityStage): boolean {
  return stage === "ready_to_submit";
}

export function canResolveUncertainSubmission(stage: OpportunityStage): boolean {
  return stage === "submission_processing";
}

export function canSetStage(current: OpportunityStage, next: string): boolean {
  const rules: Record<string, readonly string[]> = {
    submitted: ["replied", "interviewed", "won", "lost", "nurture"],
    replied: ["interviewed", "won", "lost", "nurture"],
    interviewed: ["won", "lost", "nurture"],
    nurture: ["replied", "interviewed", "won", "lost"],
  };
  return (rules[current] ?? []).includes(next);
}
