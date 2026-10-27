import { redirect, notFound } from "next/navigation";
import { getAuthenticatedAdminSession } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { OpportunityDetail } from "@/components/opportunity-detail";
import type { OpportunityRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthenticatedAdminSession();
  if (!session?.user?.email) redirect("/login");
  const { id } = await params;
  const sql = db();
  const rows = await sql<OpportunityRow[]>`
    select o.*, p.id as proposal_id, p.body as proposal_body, p.questions as proposal_questions,
      p.bid_amount as proposal_bid_amount, p.timeline as proposal_timeline, p.milestones as proposal_milestones,
      p.quality_score, p.quality_review, p.human_judgment_required, p.status as proposal_status
    from bidflo_opportunities o
    left join lateral (select * from bidflo_proposals where opportunity_id = o.id order by version desc limit 1) p on true
    where o.id = ${id}
  `;
  if (!rows[0]) notFound();
  const messages = await sql`select * from bidflo_messages where opportunity_id = ${id} order by created_at desc`;
  return <AppShell email={session.user.email}><OpportunityDetail opportunity={rows[0]} messages={messages} /></AppShell>;
}
