import { processAiBacklog, processOpportunityBacklog, processPendingEvents } from "@/lib/workflow";
import { processSlackAlerts } from "@/lib/slack-alerts";
import { diagnoseAiProvider } from "@/lib/ai-diagnostics";
import { audit, db } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(secret && bearer && bearer === secret);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const events = await processPendingEvents(5);
  const opportunityBacklog = await processOpportunityBacklog(1);
  const aiBacklog = await processAiBacklog(1);
  const slack = await processSlackAlerts(10);
  // One model-catalog request per six hours, never a billable completion.
  // Failure to diagnose must never stop the working intake processor.
  let ai: { checked: boolean; cached?: boolean; configured?: boolean; status?: number | null; fault?: string | null } = { checked: false };
  try {
    const sql = db();
    const [last] = await sql`select created_at, detail from bidflo_audit_logs
      where action = 'ai.connection_probed_v2' and created_at > now() - interval '6 hours'
      order by created_at desc limit 1`;
    if (!last) {
      const result = await diagnoseAiProvider();
      await audit("system:ai", "ai.connection_probed_v2", "integration", undefined, result);
      ai = { checked: true, cached: false, configured: result.configured, status: result.httpStatus, fault: result.fault };
    } else {
      const detail = last.detail as Record<string, unknown>;
      ai = {
        checked: true,
        cached: true,
        configured: Boolean(detail.configured),
        status: detail.httpStatus == null ? null : Number(detail.httpStatus),
        fault: typeof detail.fault === "string" ? detail.fault : null,
      };
    }
  } catch (error) {
    ai = { checked: false, fault: "probe_failed" };
    console.error("Visez AI readiness diagnostic failed", error instanceof Error ? error.name : "Unknown");
  }
  await audit("system:processor", "processor.checked", "integration", undefined, {
    eventCount: events.processed,
    resultStatuses: events.results.map((result) => String(result.status ?? "unknown")),
    slackDelivered: slack.delivered,
    slackFailed: slack.failed,
    aiAttempted: aiBacklog.attempted + events.results.filter((result) => Boolean((result.ai as { attempted?: boolean } | undefined)?.attempted)).length,
    aiReviewed: aiBacklog.reviewed + events.results.filter((result) => Boolean((result.ai as { reviewed?: boolean } | undefined)?.reviewed)).length,
    aiBacklogReason: aiBacklog.reason,
    opportunityBacklogProcessed: opportunityBacklog.processed,
    opportunityBacklogReason: opportunityBacklog.reason,
  });
  return Response.json({ ...events, opportunityBacklog, slack, ai: { ...ai, execution: aiBacklog } });
}
