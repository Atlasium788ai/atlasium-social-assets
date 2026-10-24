import { createHash } from "node:crypto";
import { z } from "zod";
import { requireAdminSession, unauthorizedResponse } from "@/lib/auth/server";
import { db, audit } from "@/lib/db";
import { parseUpworkEmail } from "@/lib/email-parser";
import { qualifyAndPrepare } from "@/lib/workflow";
import { validUpworkJobUrl } from "@/lib/manual-intake";

export const runtime = "nodejs";

const intake = z.object({
  title: z.string().trim().min(8).max(180),
  jobUrl: z.string().trim().url().max(900),
  description: z.string().trim().min(80).max(12000),
  budgetUsd: z.number().nonnegative().max(10_000_000).nullable().optional(),
}).strict();

/** Manual bridge while Upwork OAuth / email job alerts are not enabled. Nothing is bid or sent. */
export async function POST(request: Request) {
  let session;
  try {
    session = await requireAdminSession();
  } catch {
    return unauthorizedResponse();
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host !== request.headers.get("host") || originUrl.protocol !== "https:") {
        return Response.json({ error: "Invalid request origin" }, { status: 403 });
      }
    } catch {
      return Response.json({ error: "Invalid request origin" }, { status: 403 });
    }
  }

  const parsed = intake.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Provide the Upwork job link, title and copied project requirements (80+ characters)." }, { status: 400 });
  }
  const jobUrl = validUpworkJobUrl(parsed.data.jobUrl);
  if (!jobUrl) return Response.json({ error: "Use a direct Upwork job posting URL." }, { status: 400 });

  const sql = db();
  const [counts] = await sql`
    select count(*)::int as total from bidflo_audit_logs
    where action = 'opportunity.manual_added' and created_at > now() - interval '1 hour'
  `;
  // A simple guard during the short no-login internal pilot.
  if (Number(counts?.total ?? 0) >= 30) {
    return Response.json({ error: "Too many manual imports this hour. Try again later." }, { status: 429 });
  }

  const safeTitle = parsed.data.title.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  const budgetText = parsed.data.budgetUsd != null
    ? `\nBudget: $${parsed.data.budgetUsd.toFixed(2)}`
    : "";
  const receivedAt = new Date().toISOString();
  const emailLike = parseUpworkEmail({
    subject: "New job",
    text: `${safeTitle}\n${jobUrl}\n${parsed.data.description}${budgetText}`,
    receivedAt,
  });
  if (emailLike.kind !== "opportunity") {
    return Response.json({ error: "Could not parse this Upwork posting." }, { status: 422 });
  }
  const opportunity = emailLike.opportunity;
  // The source is user-pasted. Never label this a verified live Upwork feed.
  opportunity.title = safeTitle;
  opportunity.jobUrl = jobUrl;
  opportunity.externalKey = jobUrl.match(/~[a-z0-9]+/i)?.[0] ??
    createHash("sha256").update(jobUrl).digest("hex");
  opportunity.sourceSubject = "Manual Upwork job import";
  opportunity.sourceReceivedAt = receivedAt;

  const [inserted] = await sql`
    insert into bidflo_opportunities (
      external_key, title, description, client_name, client_location,
      client_spend, client_rating, budget_min, budget_max, budget_type,
      currency, job_url, requirements, source_subject, source_received_at
    ) values (
      ${opportunity.externalKey}, ${opportunity.title}, ${opportunity.description},
      ${opportunity.clientName ?? null}, ${opportunity.clientLocation ?? null},
      ${opportunity.clientSpend ?? null}, ${opportunity.clientRating ?? null},
      ${opportunity.budgetMin ?? null}, ${opportunity.budgetMax ?? null},
      ${opportunity.budgetType ?? "unknown"}, ${opportunity.currency ?? "USD"},
      ${opportunity.jobUrl}, ${sql.json(opportunity.requirements)},
      ${opportunity.sourceSubject}, ${opportunity.sourceReceivedAt}
    )
    on conflict (external_key) do nothing
    returning id
  `;

  if (!inserted) {
    const [existing] = await sql`
      select id from bidflo_opportunities where external_key = ${opportunity.externalKey}
    `;
    if (!existing) return Response.json({ error: "Could not resolve duplicate posting." }, { status: 409 });
    return Response.json({ opportunityId: String(existing.id), duplicate: true });
  }

  const opportunityId = String(inserted.id);
  await audit(session.user?.email ?? "operator", "opportunity.manual_added", "opportunity", opportunityId, {
    source: "operator_paste", jobUrl,
  });
  try {
    const result = await qualifyAndPrepare(opportunityId);
    return Response.json({ opportunityId, duplicate: false, score: result.score, status: result.status });
  } catch (error) {
    await audit("system:import", "opportunity.manual_processing_failed", "opportunity", opportunityId, {
      error: error instanceof Error ? error.message.slice(0, 200) : "Unknown processing error",
    });
    return Response.json({
      opportunityId, duplicate: false, status: "new",
      note: "Job captured. Score or draft needs a retry from the opportunity page.",
    });
  }
}
