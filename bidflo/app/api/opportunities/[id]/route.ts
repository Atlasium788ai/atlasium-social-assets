import { z } from "zod";
import { audit, db } from "@/lib/db";
import { requireAdminSession, unauthorizedResponse } from "@/lib/auth/server";
import { qualifyAndPrepare } from "@/lib/workflow";
import { queueSlackAlert } from "@/lib/slack-alerts";

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
  const auth = await sessionOrResponse();
  if (auth.response || !auth.session) return auth.response!;
  const actor = auth.session.user?.email ?? "admin";
  const { id } = await context.params;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid request", detail: parsed.error.flatten() }, { status: 400 });
  const sql = db();
  const [opportunity] = await sql`select id, status from bidflo_opportunities where id = ${id}`;
  if (!opportunity) return Response.json({ error: "Not found" }, { status: 404 });

  if (parsed.data.action === "rescore") {
    const result = await qualifyAndPrepare(id);
    await audit(actor, "opportunity.rescored", "opportunity", id, result);
    return Response.json(result);
  }
  if (parsed.data.action === "edit") {
    const [proposal] = await sql`select id from bidflo_proposals where opportunity_id = ${id} order by version desc limit 1`;
    if (!proposal) return Response.json({ error: "No proposal to edit" }, { status: 409 });
    await sql`
      update bidflo_proposals set body = ${parsed.data.body}, bid_amount = ${parsed.data.bidAmount},
        timeline = ${parsed.data.timeline}, questions = ${sql.json(parsed.data.questions)},
        status = 'edited', human_judgment_required = true, updated_at = now()
      where id = ${String(proposal.id)}
    `;
    await audit(actor, "proposal.edited", "proposal", String(proposal.id), { opportunityId: id });
    return Response.json({ ok: true, status: "proposal_ready" });
  }
  if (parsed.data.action === "approve") {
    const [proposal] = await sql`select id from bidflo_proposals where opportunity_id = ${id} order by version desc limit 1`;
    if (!proposal) return Response.json({ error: "No proposal to approve" }, { status: 409 });
    await sql`update bidflo_proposals set status = 'approved', updated_at = now() where id = ${String(proposal.id)}`;
    await sql`update bidflo_opportunities set status = 'approved', updated_at = now() where id = ${id}`;
    await audit(actor, "proposal.approved", "proposal", String(proposal.id), { opportunityId: id });
    return Response.json({ ok: true, status: "approved" });
  }
  if (parsed.data.action === "reject") {
    await sql`update bidflo_opportunities set status = 'rejected', rejection_reason = ${parsed.data.reason ?? "Rejected by reviewer"}, updated_at = now() where id = ${id}`;
    await audit(actor, "opportunity.rejected", "opportunity", id, { reason: parsed.data.reason ?? "Rejected by reviewer" });
    return Response.json({ ok: true, status: "rejected" });
  }
  if (parsed.data.action === "mark_submitted") {
    await sql`update bidflo_opportunities set status = 'submitted', updated_at = now() where id = ${id}`;
    await sql`insert into bidflo_submission_events (opportunity_id, status, detail) values (${id}, 'submitted', ${sql.json({ method: "human_confirmed" })})`;
    await audit(actor, "proposal.submitted_confirmed", "opportunity", id);
    const [detail] = await sql`select title from bidflo_opportunities where id = ${id}`;
    try {
      await queueSlackAlert(`submitted:${id}`, { kind: "submitted", opportunityId: id, title: String(detail?.title ?? "Upwork opportunity") });
    } catch (error) {
      await audit("system:slack", "slack.enqueue_failed", "opportunity", id, {
        reason: error instanceof Error ? error.message.slice(0, 150) : "Unknown queue failure",
      }).catch(() => {});
    }
    return Response.json({ ok: true, status: "submitted" });
  }
  await sql`update bidflo_opportunities set status = ${parsed.data.stage}, updated_at = now() where id = ${id}`;
  await audit(actor, `opportunity.${parsed.data.stage}`, "opportunity", id);
  if (parsed.data.stage === "interviewed" || parsed.data.stage === "won") {
    const [detail] = await sql`select title from bidflo_opportunities where id = ${id}`;
    try {
      await queueSlackAlert(`stage:${id}:${parsed.data.stage}`, {
        kind: parsed.data.stage, opportunityId: id, title: String(detail?.title ?? "Upwork opportunity"),
      });
    } catch (error) {
      await audit("system:slack", "slack.enqueue_failed", "opportunity", id, {
        reason: error instanceof Error ? error.message.slice(0, 150) : "Unknown queue failure",
      }).catch(() => {});
    }
  }
  return Response.json({ ok: true, status: parsed.data.stage });
}
