export type OpportunityStatus =
  | "new"
  | "rejected"
  | "qualified"
  | "proposal_ready"
  | "approved"
  | "ready_to_submit"
  | "submission_processing"
  | "submitted"
  | "replied"
  | "interviewed"
  | "won"
  | "nurture"
  | "opted_out"
  | "lost";

export type ScoreBreakdown = {
  serviceFit: number;
  budget: number;
  profitability: number;
  complexity: number;
  deliveryFeasibility: number;
  recurringRevenue: number;
  reasons: string[];
};

export type QualificationRules = {
  minimumScore: number;
  autoPrepareScore: number;
  minimumBudget: number;
  targetHourlyRate: number;
  serviceFitKeywords: string[];
  poorFitKeywords: string[];
  complexityPenaltyKeywords: string[];
  recurringKeywords: string[];
};

export type OpportunityInput = {
  externalKey: string;
  title: string;
  description: string;
  clientName?: string | null;
  clientLocation?: string | null;
  clientSpend?: number | null;
  clientRating?: number | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  budgetType?: "fixed" | "hourly" | "unknown";
  currency?: string;
  jobUrl: string;
  requirements: string[];
  sourceSubject: string;
  sourceReceivedAt: string;
};

export type ProposalDraft = {
  body: string;
  questions: string[];
  bidAmount: number;
  timeline: string;
  milestones: Array<{ name: string; amount: number; deliverable: string }>;
};

export type OpportunityRow = {
  id: string;
  title: string;
  description: string;
  client_name: string | null;
  client_location: string | null;
  budget_min: string | null;
  budget_max: string | null;
  budget_type: string | null;
  currency: string;
  job_url: string;
  requirements: string[];
  status: OpportunityStatus;
  nurture_note?: string | null;
  nurture_due_at?: string | null;
  opted_out_at?: string | null;
  score: number | null;
  score_breakdown: ScoreBreakdown | null;
  rejection_reason: string | null;
  recurring_potential: boolean;
  suggested_bid: string | null;
  suggested_timeline: string | null;
  created_at: string;
  updated_at: string;
  proposal_id: string | null;
  proposal_body: string | null;
  proposal_questions: string[] | null;
  proposal_bid_amount: string | null;
  proposal_timeline: string | null;
  proposal_milestones: ProposalDraft["milestones"] | null;
  attachment_recommendations: Array<{
    id: string;
    name: string;
    href: string;
    description: string;
    reason: string;
    verified: boolean;
  }> | null;
  quality_score: number | null;
  quality_review: Record<string, unknown> | null;
  human_judgment_required: boolean | null;
  proposal_status: string | null;
  follow_up_state?: {
    ageDays: number;
    due: boolean;
    level: "upcoming" | "first" | "second" | "stale";
    label: string;
  };
};
