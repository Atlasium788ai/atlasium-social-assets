import { db } from "./db";
import type { OpportunityRow } from "./types";

export async function listOpportunityCards(): Promise<OpportunityRow[]> {
  const sql = db();
  return await sql<OpportunityRow[]>`
    select o.*,
      p.id as proposal_id, p.body as proposal_body, p.questions as proposal_questions,
      p.bid_amount as proposal_bid_amount, p.timeline as proposal_timeline,
      p.milestones as proposal_milestones, p.quality_score, p.quality_review,
      p.human_judgment_required, p.status as proposal_status
    from bidflo_opportunities o
    left join lateral (
      select * from bidflo_proposals where opportunity_id = o.id order by version desc limit 1
    ) p on true
    order by
      case when o.status in ('proposal_ready', 'approved', 'ready_to_submit') then 0 else 1 end,
      o.score desc nulls last,
      o.created_at desc
    limit 100
  `;
}

export async function getDashboardMetrics() {
  const sql = db();
  const [counts] = await sql`
    select
      count(*)::int as total,
      count(*) filter (where status = 'proposal_ready')::int as approval_queue,
      count(*) filter (where status in ('submitted', 'replied', 'interviewed', 'won'))::int as submitted,
      count(*) filter (where status = 'won')::int as won,
      coalesce(sum(suggested_bid) filter (where status in ('approved', 'ready_to_submit', 'submitted', 'replied', 'interviewed')), 0) as pipeline,
      coalesce(avg(score) filter (where score is not null), 0)::numeric(5,1) as average_score
    from bidflo_opportunities
  `;
  const stages = await sql`
    select status, count(*)::int as count
    from bidflo_opportunities
    group by status
    order by count desc
  `;
  return { ...counts, stages };
}
