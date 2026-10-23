import { audit, db } from "@/lib/db";
import { requireAdminSession, unauthorizedResponse } from "@/lib/auth/server";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  let actor = "admin";
  try {
    const session = await requireAdminSession();
    actor = session.user?.email ?? actor;
  } catch {
    return unauthorizedResponse();
  }
  const { id } = await context.params;
  const sql = db();
  const [row] = await sql`
    select o.*, p.id as proposal_id, p.body, p.questions, p.bid_amount, p.timeline, p.milestones, p.status as proposal_status
    from bidflo_opportunities o
    join lateral (select * from bidflo_proposals where opportunity_id = o.id order by version desc limit 1) p on true
    where o.id = ${id}
  `;
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  if (row.status !== "approved" || row.proposal_status !== "approved") {
    return Response.json({ error: "Human approval is required before submission" }, { status: 409 });
  }

  const bridgeUrl = process.env.UPWORK_SUBMISSION_WEBHOOK_URL;
  const bridgeToken = process.env.UPWORK_SUBMISSION_TOKEN;
  if (!bridgeUrl || !bridgeToken) {
    await sql`update bidflo_opportunities set status = 'ready_to_submit', updated_at = now() where id = ${id}`;
    await sql`insert into bidflo_submission_events (opportunity_id, proposal_id, status, detail) values (${id}, ${String(row.proposal_id)}, 'manual_required', ${sql.json({ jobUrl: row.job_url })})`;
    await audit(actor, "submission.manual_handoff", "opportunity", id);
    return Response.json({ status: "manual_required", jobUrl: row.job_url });
  }

  const response = await fetch(bridgeUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${bridgeToken}`, "Content-Type": "application/json", "Idempotency-Key": `bidflo-${id}-${String(row.proposal_id)}` },
    body: JSON.stringify({
      opportunityId: id,
      proposalId: row.proposal_id,
      jobUrl: row.job_url,
      proposal: { body: row.body, questions: row.questions, bidAmount: Number(row.bid_amount), timeline: row.timeline, milestones: row.milestones },
      approvedBy: actor,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    await audit(actor, "submission.bridge_failed", "opportunity", id, { status: response.status });
    return Response.json({ error: "Authorized submission bridge failed" }, { status: 502 });
  }
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  await sql`update bidflo_opportunities set status = 'submitted', updated_at = now() where id = ${id}`;
  await sql`
    insert into bidflo_submission_events (opportunity_id, proposal_id, status, external_submission_id, detail)
    values (${id}, ${String(row.proposal_id)}, 'submitted', ${result.submissionId ? String(result.submissionId) : null}, ${sql.json({ bridge: true })})
  `;
  await audit(actor, "proposal.submitted", "opportunity", id, { via: "authorized_bridge" });
  return Response.json({ status: "submitted", submissionId: result.submissionId ?? null });
}
