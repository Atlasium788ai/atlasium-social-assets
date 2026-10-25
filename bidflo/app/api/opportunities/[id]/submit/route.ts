import { audit, db } from "@/lib/db";
import { z } from "zod";
import { isAuthDisabled } from "@/lib/auth/server";
import { isSameOriginMutation, mutationForbidden } from "@/lib/security";
import { requireAdminSession, unauthorizedResponse } from "@/lib/auth/server";
import { resolveSubmissionBridge } from "@/lib/submission-bridge";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(request)) return mutationForbidden();
  let actor = "admin";
  try {
    const session = await requireAdminSession();
    actor = session.user?.email ?? actor;
  } catch {
    return unauthorizedResponse();
  }
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Invalid opportunity id" }, { status: 400 });
  const sql = db();
  const [row] = await sql`
    select o.*, p.id as proposal_id, p.body, p.questions, p.bid_amount, p.timeline, p.milestones, p.status as proposal_status
    from bidflo_opportunities o
    join lateral (select * from visez_proposals where opportunity_id = o.id order by version desc limit 1) p on true
    where o.id = ${id}
  `;
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  // Reopening an existing manual handoff must not create new events or submit twice.
  if (row.status === "ready_to_submit" && row.proposal_status === "approved") {
    const [handoff] = await sql`select id from bidflo_submission_events where opportunity_id = ${id} and proposal_id = ${String(row.proposal_id)} and status = 'manual_required' limit 1`;
    if (handoff) return Response.json({ status: "manual_required", jobUrl: row.job_url, alreadyPrepared: true });
  }
  if (row.status !== "approved" || row.proposal_status !== "approved") {
    return Response.json({ error: "An approved proposal is required; this bid may already be in progress" }, { status: 409 });
  }

  const bridge = resolveSubmissionBridge({
    UPWORK_SUBMISSION_BRIDGE_ENABLED: process.env.UPWORK_SUBMISSION_BRIDGE_ENABLED,
    UPWORK_SUBMISSION_WEBHOOK_URL: process.env.UPWORK_SUBMISSION_WEBHOOK_URL,
    UPWORK_SUBMISSION_TOKEN: process.env.UPWORK_SUBMISSION_TOKEN,
  }, isAuthDisabled());
  // Explicit opt-in AND enabled authentication are required before spending Upwork Connects.
  if (bridge.mode === "manual") {
    const manualHandoffPrepared = await sql.begin(async (tx) => {
      const [claimed] = await tx`
        update bidflo_opportunities set status = 'ready_to_submit', updated_at = now()
        where id = ${id} and status = 'approved' returning id
      `;
      if (!claimed) return false;
      await tx`insert into bidflo_submission_events (opportunity_id, proposal_id, status, detail)
        values (${id}, ${String(row.proposal_id)}, 'manual_required', ${tx.json({ jobUrl: row.job_url })})`;
      return true;
    });
    if (!manualHandoffPrepared) {
      return Response.json({ error: "Submission already started; refresh first" }, { status: 409 });
    }
    await audit(actor, "submission.manual_handoff", "opportunity", id);
    return Response.json({ status: "manual_required", jobUrl: row.job_url });
  }
  if (bridge.mode === "error") return Response.json({ error: bridge.error }, { status: 503 });
  // Atomic claim blocks double-clicks and simultaneous auto-submissions.
  const [claimed] = await sql`
    update bidflo_opportunities set status = 'submission_processing', updated_at = now()
    where id = ${id} and status = 'approved' returning id
  `;
  if (!claimed) return Response.json({ error: "Submission is already being processed" }, { status: 409 });

  try {
    const response = await fetch(bridge.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bridge.token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `visez-${id}-${String(row.proposal_id)}`,
      },
      body: JSON.stringify({
        opportunityId: id,
        proposalId: row.proposal_id,
        jobUrl: row.job_url,
        proposal: {
          body: row.body, questions: row.questions, bidAmount: Number(row.bid_amount),
          timeline: row.timeline, milestones: row.milestones,
        },
        approvedBy: actor,
      }),
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    if (!response.ok) {
      await audit(actor, "submission.bridge_uncertain", "opportunity", id, { status: response.status });
      return Response.json({ error: "Submission status uncertain. Check Upwork before attempting anything else." }, { status: 502 });
    }
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    await sql.begin(async (tx) => {
      await tx`update bidflo_opportunities set status = 'submitted', updated_at = now()
        where id = ${id} and status = 'submission_processing'`;
      await tx`
        insert into bidflo_submission_events (opportunity_id, proposal_id, status, external_submission_id, detail)
        values (${id}, ${String(row.proposal_id)}, 'submitted',
          ${typeof result.submissionId === "string" ? result.submissionId.slice(0, 180) : null},
          ${tx.json({ bridge: true })})
      `;
    });
    await audit(actor, "proposal.submitted", "opportunity", id, { via: "authorized_bridge" });
    return Response.json({ status: "submitted", submissionId: result.submissionId ?? null });
  } catch (error) {
    // A timeout can happen AFTER Upwork accepted the bid. Never automatically retry.
    await audit(actor, "submission.bridge_uncertain", "opportunity", id, {
      reason: error instanceof Error ? error.name : "Unknown error",
    }).catch(() => {});
    return Response.json({ error: "Submission result uncertain. Verify on Upwork before another attempt." }, { status: 502 });
  }
}
