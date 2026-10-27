export type ProposalCheckState = "pass" | "review" | "pending";

export type ProposalCheck = {
  label: string;
  detail: string;
  state: ProposalCheckState;
};

export function getProposalChecks(input: {
  score: number | null;
  bidAmount: number;
  budgetMax: number | null;
  timeline: string;
  proposalStatus: string | null;
  humanJudgmentRequired: boolean;
  approvalIssues: string[];
}): ProposalCheck[] {
  const commerciallyComplete = input.bidAmount > 0
    && input.timeline.trim().length > 0
    && (!input.budgetMax || input.bidAmount <= input.budgetMax);
  const grounded = input.approvalIssues.length === 0;
  const qualityPassed = grounded && input.proposalStatus === "ready" && !input.humanJudgmentRequired;

  return [
    {
      label: "Opportunity fit",
      detail: input.score == null ? "Waiting for qualification" : `Fit scored ${input.score}/100`,
      state: input.score == null ? "pending" : input.score >= 55 ? "pass" : "review",
    },
    {
      label: "Price + timeline",
      detail: commerciallyComplete ? "Within the stated budget and ready to review" : "Confirm price, timeline, or budget",
      state: commerciallyComplete ? "pass" : "review",
    },
    {
      label: "Proposal quality",
      detail: qualityPassed
        ? "Independent review and rule check passed"
        : grounded ? "Blair's final judgment is required" : `${input.approvalIssues.length} issue${input.approvalIssues.length === 1 ? "" : "s"} to fix`,
      state: qualityPassed ? "pass" : input.proposalStatus ? "review" : "pending",
    },
  ];
}
