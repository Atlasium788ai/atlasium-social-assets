import { Resend } from "resend";
import { db, audit } from "./db";
import { parseUpworkEmail } from "./email-parser";
import { generateProposal, reviewProposal } from "./ai";
import { qualifyOpportunity, recommendCommercials } from "./qualification";
import type { OpportunityInput, ProposalDraft, QualificationRules } from "./types";

type EventPayload = {
  text?: string | null;
  html?: string | null;
};

function rowToOpportunity(row: Record<string, unknown>): OpportunityInput {
  return {
    externalKey: String(row.external_key),
    title: String(row.title),
    description: String(row.description),
    clientName: row.client_name ? String(row.client_name) : null,
    clientLocation: row.client_location ? String(row.client_location) : null,
    clientSpend: row.client_spend == null ? null : Number(row.client_spend),
    clientRating: row.client_rating == null ? null : Number(row.client_rating),
    budgetMin: row.budget_min == null ? null : Number(row.budget_min),
    budgetMax: row.budget_max == null ? null : Number(row.budget_max),
    budgetType: (row.budget_type as OpportunityInput["budgetType"]) ?? "unknown",
    currency: String(row.currency ?? "USD"),
    jobUrl: String(row.job_url),
    requirements: (row.requirements as string[]) ?? [],
    sourceSubject: String(row.source_subject),
    sourceReceivedAt: new Date(String(row.source_received_at)).toISOString(),
  };
}

export async function recordInboundEvent(input: {
  providerEventId: string;
  messageId?: string | null;
  sender: string;
  subject: string;
  receivedAt: string;
  text?: string | null;
  html?: string | null;
}) {
  const sql = db();
  const rows = await sql`
    insert into bidflo_inbound_events (
      provider, provider_event_id, message_id, sender, subject, received_at, payload
    ) values (
      'resend', ${input.providerEventId}, ${input.messageId ?? null}, ${input.sender},
      ${input.subject.slice(0, 500)}, ${input.receivedAt},
      ${sql.json({ text: input.text?.slice(0, 20_000) ?? null, html: input.html?.slice(0, 50_000) ?? null })}
    )
    on conflict (provider, provider_event_id) do nothing
    returning id
  `;
  if (rows[0]) await audit("system:email", "inbound.received", "inbound_event", String(rows[0].id), { sender: input.sender });
  return rows[0]?.id ? String(rows[0].id) : null;
}

async function notifyProposalReady(opportunityId: string, title: string, score: number) {
  const apiKey = process.env.RESEND_API_KEY;
  const owner = process.env.BIDFLO_OWNER_EMAIL;
  const from = process.env.BIDFLO_EMAIL_FROM;
  if (!apiKey || !owner || !from) return;
  const appUrl = (process.env.BIDFLO_URL ?? "").replace(/\/$/, "");
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: [owner],
    subject: `BidFlo approval ready: ${title}`,
    text: `A ${score}/100 opportunity has a reviewed proposal ready for approval.\n\n${title}\n${appUrl}/opportunities/${opportunityId}\n\nNo bid has been submitted.`,
  });
  if (error) throw new Error(`Proposal notification failed: ${error.message}`);
}

export async function qualifyAndPrepare(opportunityId: string) {
  const sql = db();
  const [opportunityRow] = await sql`select * from bidflo_opportunities where id = ${opportunityId}`;
  const [settings] = await sql`select * from bidflo_settings where id = 'default'`;
  if (!opportunityRow || !settings) throw new Error("Opportunity or BidFlo settings not found");

  const opportunity = rowToOpportunity(opportunityRow);
  const rules = settings.qualification_rules as QualificationRules;
  const result = qualifyOpportunity(opportunity, rules);
  const commercials = recommendCommercials(opportunity, rules.targetHourlyRate);
  const nextStatus = result.rejected ? "rejected" : "qualified";
  await sql`
    update bidflo_opportunities set
      score = ${result.score},
      score_breakdown = ${sql.json(result.breakdown)},
      rejection_reason = ${result.rejectionReason},
      recurring_potential = ${result.recurringPotential},
      suggested_bid = ${commercials.bidAmount},
      suggested_timeline = ${commercials.timeline},
      suggested_milestones = ${sql.json(commercials.milestones)},
      status = ${nextStatus},
      updated_at = now()
    where id = ${opportunityId}
  `;
  await audit("system:qualification", "opportunity.scored", "opportunity", opportunityId, { score: result.score, status: nextStatus });
  if (result.rejected || result.score < rules.autoPrepareScore) return { score: result.score, status: nextStatus };

  const commercialDraft: ProposalDraft = { body: "", questions: [], ...commercials };
  const draft = await generateProposal({
    opportunity,
    score: result.score,
    breakdown: result.breakdown,
    capabilityProfile: settings.capability_profile as Record<string, unknown>,
    proposalRules: settings.proposal_rules as Record<string, unknown>,
    commercials: commercialDraft,
    approvedExamples: ((settings.proposal_rules as Record<string, unknown>).approvedExamples as string[] | undefined) ?? [],
  });
  const minimumQualityScore = Number((settings.proposal_rules as Record<string, unknown>).minimumQualityScore ?? 80);
  const review = await reviewProposal({
    opportunity,
    proposal: draft,
    capabilityProfile: settings.capability_profile as Record<string, unknown>,
    proposalRules: settings.proposal_rules as Record<string, unknown>,
    minimumQualityScore,
  });
  const finalDraft = review.score < minimumQualityScore && review.revisedProposal ? review.revisedProposal : draft;
  const proposalStatus = review.score >= minimumQualityScore && !review.humanJudgmentRequired ? "ready" : "needs_review";
  const [versionRow] = await sql`select coalesce(max(version), 0)::int + 1 as version from bidflo_proposals where opportunity_id = ${opportunityId}`;
  const [proposal] = await sql`
    insert into bidflo_proposals (
      opportunity_id, version, body, questions, bid_amount, timeline, milestones,
      quality_score, quality_review, human_judgment_required, status
    ) values (
      ${opportunityId}, ${Number(versionRow.version)}, ${finalDraft.body}, ${sql.json(finalDraft.questions)},
      ${finalDraft.bidAmount}, ${finalDraft.timeline}, ${sql.json(finalDraft.milestones)},
      ${review.score}, ${sql.json(review)}, ${review.humanJudgmentRequired}, ${proposalStatus}
    ) returning id
  `;
  await sql`update bidflo_opportunities set status = 'proposal_ready', updated_at = now() where id = ${opportunityId}`;
  await audit("system:review", "proposal.prepared", "proposal", String(proposal.id), { opportunityId, qualityScore: review.score, proposalStatus });
  try {
    await notifyProposalReady(opportunityId, opportunity.title, result.score);
  } catch (error) {
    await audit("system:notification", "notification.failed", "opportunity", opportunityId, { error: error instanceof Error ? error.message : "Unknown error" });
  }
  return { score: result.score, status: "proposal_ready", proposalId: String(proposal.id) };
}

async function processEvent(event: Record<string, unknown>) {
  const sql = db();
  const payload = event.payload as EventPayload;
  const parsed = parseUpworkEmail({
    subject: String(event.subject),
    text: payload.text,
    html: payload.html,
    receivedAt: new Date(String(event.received_at)).toISOString(),
  });

  if (parsed.kind === "ignored") {
    await sql`update bidflo_inbound_events set status = 'ignored', error = ${parsed.reason}, processed_at = now() where id = ${String(event.id)}`;
    return { status: "ignored" };
  }
  if (parsed.kind === "reply") {
    const [opportunity] = parsed.jobUrl
      ? await sql`select id from bidflo_opportunities where job_url = ${parsed.jobUrl} order by created_at desc limit 1`
      : [];
    await sql`
      insert into bidflo_messages (opportunity_id, direction, kind, sender, subject, body, received_at)
      values (${opportunity?.id ?? null}, 'inbound', 'client_reply', ${String(event.sender)}, ${parsed.subject}, ${parsed.body}, ${String(event.received_at)})
    `;
    if (opportunity?.id) await sql`update bidflo_opportunities set status = 'replied', updated_at = now() where id = ${String(opportunity.id)}`;
    await sql`update bidflo_inbound_events set status = 'processed', processed_at = now() where id = ${String(event.id)}`;
    await audit("system:email", "reply.detected", "opportunity", opportunity?.id ? String(opportunity.id) : undefined, { subject: parsed.subject });
    return { status: "reply" };
  }

  const item = parsed.opportunity;
  const [inserted] = await sql`
    insert into bidflo_opportunities (
      external_key, title, description, client_name, client_location, client_spend, client_rating,
      budget_min, budget_max, budget_type, currency, job_url, requirements, source_subject, source_received_at
    ) values (
      ${item.externalKey}, ${item.title}, ${item.description}, ${item.clientName ?? null}, ${item.clientLocation ?? null},
      ${item.clientSpend ?? null}, ${item.clientRating ?? null}, ${item.budgetMin ?? null}, ${item.budgetMax ?? null},
      ${item.budgetType ?? "unknown"}, ${item.currency ?? "USD"}, ${item.jobUrl}, ${sql.json(item.requirements)},
      ${item.sourceSubject}, ${item.sourceReceivedAt}
    ) on conflict (external_key) do nothing returning id
  `;
  if (!inserted) {
    await sql`update bidflo_inbound_events set status = 'duplicate', processed_at = now() where id = ${String(event.id)}`;
    return { status: "duplicate" };
  }
  const opportunityId = String(inserted.id);
  await sql`update bidflo_inbound_events set status = 'processed', processed_at = now() where id = ${String(event.id)}`;
  await audit("system:email", "opportunity.created", "opportunity", opportunityId, { externalKey: item.externalKey });
  return qualifyAndPrepare(opportunityId);
}

export async function processPendingEvents(limit = 5) {
  const sql = db();
  const events = await sql`
    select * from bidflo_inbound_events
    where status = 'pending'
    order by received_at asc
    limit ${limit}
    for update skip locked
  `;
  const results: Array<Record<string, unknown>> = [];
  for (const event of events) {
    try {
      results.push(await processEvent(event));
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : "Unknown processing error";
      await sql`update bidflo_inbound_events set status = 'failed', error = ${message}, processed_at = now() where id = ${String(event.id)}`;
      await audit("system:workflow", "inbound.failed", "inbound_event", String(event.id), { error: message });
      results.push({ status: "failed", eventId: String(event.id), error: message });
    }
  }
  return { processed: results.length, results };
}
