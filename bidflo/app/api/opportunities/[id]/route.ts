import { z } from "zod";
import { audit, db } from "@/lib/db";
import { requireAdminSession, unauthorizedResponse } from "@/lib/auth/server";
import { isSameOriginMutation, mutationForbidden } from "@/lib/security";
import { qualifyAndPrepare } from "@/lib/workflow";
import { queueSlackAlertSafely } from "@/lib/slack-alerts";
import { proposalMeetsRequiredOpening } from "@/lib/application-rules";
import { canEditProposal, canRescore, canApproveProposal, canConfirmManualSubmission, canSetStage, type OpportunityStage } from "@/lib/pipeline-guards";

const updateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().max(500).optional() }),
  z.object({ action: z.literal("mark_submitted") }),
  z.object({ action: z.literal("set_stage"), stage: z.enum(["replied", "interviewed", "won", "lost"]) }),
  z.object({
    action: z.literal("edit"),
    body: z.string().min(20).max(5000),
    bidAmount: z.number().positive(),
    timeline: z.string().min(2).max(100),
    questions: z.array(z.string().min(2).max(300)).max(8),
  }),
  z.object({ action: z.literal("rescore") }),
]);

async function sessionOrResponse() {
  try {
    return { session: await requireAdminSession(), response: null };
  } catch {
    return { session: null, response: unauthorizedResponse() };
  }
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await sessionOrResponse();
  if (auth.response) return auth.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Invalid opportunity id" }, { status: 400 });
  const sql = db();
  const rows = await sql`
    select o.*,
      p.id as proposal_id, p.body as proposal_body, p.questions as proposal_questions,
      p.bid_amount as proposal_bid_amount, p.timeline as proposal_timeline,
      p.milestones as proposal_milestones, p.quality_score, p.quality_review,
      p.human_judgment_required, p.status as proposal_status
    from bidflo_opportunities o
    left join lateral (
      select * from bidflo_proposals where opportunity_id = o.id order by version desc limit 1
    ) p on true
    where o.id = ${id}
  `;
  if (!rows[0]) return Response.json({ error: "Not found" }, { status: 404 });
  const messages = await sql`select * from bidflo_messages where opportunity_id = ${id} order by created_at desc`;
  const submissionEvents = await sql`select * from bidflo_submission_events where opportunity_id = ${id} order by created_at desc`;
  return Response.json({ opportunity: rows[0], messages, submissionEvents });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(request)) return mutationForbidden();
  const auth = await sessionOrResponse();
  if (auth.response || !auth.session) return auth.response!;
  const actor = auth.session.user?.email ?? "admin";
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Invalid opportunity id" }, { status: 400 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request", detail: parsed.error.flatten() }, { status: 400 });
  const sql = db();
  const [opportunity] = await sql`select id, status from bidflo_opportunities where id = ${id}`;
  if (!opportunity) return Response.json({ error: "Not found" }, { status: 404 });

  if (parsed.data.action === "rescore") {
    if (!canRescore(String(opportunity.status) as OpportunityStage)) return Response.json({ error: "Cannot rescore an active or submitted bid" }, { status: 409 });
    const result = await qualifyAndPrepare(id);
    await audit(actor, "opportunity.rescored", "opportunity", id, result);
    return Response.json(result);
  }
  if (parsed.data.action === "edit") {
    const editData = parsed.data;
    // Serialise against submission: editing an approved proposal revokes approval.
    const result = await sql.begin(async (tx) => {
      const [current] = await tx`select status from bidflo_opportunities where id = ${id} for update`;
      if (!current || !canEditProposal(String(current.status) as OpportunityStage)) return null;
      const [proposal] = await tx`
        select id from bidflo_proposals where opportunity_id = ${id}
        order by version desc limit 1
      `;
      if (!proposal) return null;
      await tx`
        update bidflo_proposals
           set body = ${editData.body}, bid_amount = ${editData.bidAmount},
               timeline = ${editData.timeline}, questions = ${tx.json(editData.questions)},
               status = 'edited', quality_score = null,
               quality_review = ${tx.json({ issues: ["Manual edits must be reviewed"], humanJudgmentRequired: true })},
               human_judgment_required = true, updated_at = now()
         where id = ${String(proposal.id)}
      `;
      await tx`update bidflo_opportunities set status = 'proposal_ready', updated_at = now()
        where id = ${id}`;
      return String(proposal.id);
    });
    if (!result) return Response.json({ error: "This proposal is no longer editable; refresh first" }, { status: 409 });
    await audit(actor, "proposal.edited", "proposal", result, { opportunityId: id });
    return Response.json({ ok: true, status: "proposal_ready" });
  }

  if (parsed.data.action === "approve") {
    const result = await sql.begin(async (tx) => {
      const [current] = await tx`select status, description from bidflo_opportunities where id = ${id} for update`;
      if (!current || !canApproveProposal(String(current.status) as OpportunityStage)) return null;
      const [proposal] = await tx`
        select id, status, body from bidflo_proposals
         where opportunity_id = ${id} order by version desc limit 1
      `;
      if (!proposal || !["needs_review", "edited", "ready", "draft"].includes(String(proposal.status))) return null;
      if (!proposalMeetsRequiredOpening(String(current.description), String(proposal.body))) return "required_opening_missing";
      await tx`update bidflo_proposals set status = 'approved', updated_at = now()
        where id = ${String(proposal.id)}`;
      await tx`update bidflo_opportunities set status = 'approved', updated_at = now()
        where id = ${id}`;
      return String(proposal.id);
    });
    if (result === "required_opening_missing") return Response.json({ error: "Client requires a specific opening phrase. Edit the draft to follow the job instructions before approval." }, { status: 409 });
    if (!result) return Response.json({ error: "Proposal is not awaiting approval; refresh first" }, { status: 409 });
    await audit(actor, "proposal.approved", "proposal", result, { opportunityId: id });
    return Response.json({ ok: true, status: "approved" });
  }
  if (parsed.data.action === "reject") {
    if (!canRescore(String(opportunity.status) as OpportunityStage) && opportunity.status !== "approved") return Response.json({ error: "Cannot reject a submitted or closed bid" }, { status: 409 });
    await sql`update bidflo_opportunities set status = 'rejected', rejection_reason = ${parsed.data.reason ?? "Rejected by reviewer"}, updated_at = now() where id = ${id}`;
    await audit(actor, "opportunity.rejected", "opportunity", id, { reason: parsed.data.reason ?? "Rejected by reviewer" });
    return Response.json({ ok: true, status: "rejected" });
  }
  if (parsed.data.action === "mark_submitted") {
    // This is a RECORD of a manual action already performed in Upwork,
    // not an automated bid. Check and update inside one database transaction.
    const completed = await sql.begin(async (tx) => {
      const [current] = await tx`
        select status from bidflo_opportunities where id = ${id} for update
      `;
      if (!current || !canConfirmManualSubmission(String(current.status) as OpportunityStage)) return false;
      const [prepared] = await tx`
        select p.id from bidflo_proposals p
        where p.opportunity_id = ${id} and p.status = 'approved'
          and p.version = (select max(version) from bidflo_proposals where opportunity_id = ${id})
          and exists (
            select 1 from bidflo_submission_events e
            where e.opportunity_id = ${id} and e.proposal_id = p.id
              and e.status = 'manual_required'
          )
        limit 1
      `;
      if (!prepared) return false;
      await tx`update bidflo_opportunities set status = 'submitted', updated_at = now()
        where id = ${id}`;
      await tx`insert into bidflo_submission_events (opportunity_id, proposal_id, status, detail)
        values (${id}, ${String(prepared.id)}, 'submitted', ${tx.json({ method: "human_confirmed" })})`;
      return true;
    });
    if (!completed) return Response.json({ error: "Manual submission was not prepared or already confirmed" }, { status: 409 });
    await audit(actor, "proposal.submitted_confirmed", "opportunity", id);
    const [detail] = await sql`select title from bidflo_opportunities where id = ${id}`;
    await queueSlackAlertSafely(`submitted:${id}`, {
      kind: "submitted", opportunityId: id, title: String(detail?.title ?? "Upwork opportunity"),
    });
    return Response.json({ ok: true, status: "submitted" });
  }
  if (!canSetStage(String(opportunity.status) as OpportunityStage, parsed.data.stage)) {
    return Response.json({ error: "Invalid stage transition; refresh the opportunity" }, { status: 409 });
  }
  const [updated] = await sql`update bidflo_opportunities set status = ${parsed.data.stage}, updated_at = now()
    where id = ${id} and status = ${String(opportunity.status)} returning id`;
  if (!updated) return Response.json({ error: "Opportunity status changed; refresh first" }, { status: 409 });
  await audit(actor, `opportunity.${parsed.data.stage}`, "opportunity", id);
  if (parsed.data.stage === "interviewed" || parsed.data.stage === "won") {
    const [detail] = await sql`select title from bidflo_opportunities where id = ${id}`;
    await queueSlackAlertSafely(`stage:${id}:${parsed.data.stage}`, {
      kind: parsed.data.stage, opportunityId: id, title: String(detail?.title ?? "Upwork opportunity"),
    });
  }
  return Response.json({ ok: true, status: parsed.data.stage });
}
