import { Resend } from "resend";
import { db, audit } from "./db";
import { parseUpworkEmail } from "./email-parser";
import { generateProposal, reviewProposal } from "./ai";
import { prepareManualReviewDraft } from "./manual-draft";
import { queueSlackAlert } from "./slack-alerts";
import { qualifyOpportunity, recommendCommercials } from "./qualification";
import type { OpportunityInput, ProposalDraft, QualificationRules } from "./types";

/** Delivery queue errors must never block qualification or client reply ingestion. */
async function queueSlackSafely(eventKey: string, input: Parameters<typeof queueSlackAlert>[1]) {
  try {
    await queueSlackAlert(eventKey, input);
  } catch (error) {
    await audit("system:slack", "slack.enqueue_failed", "opportunity", input.opportunityId ?? undefined, {
      eventKey,
      reason: error instanceof Error ? error.message.slice(0, 180) : "Unknown queue failure",
    }).catch(() => {});
  }
}

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

async function notifyProposalReady(opportunityId: string, title: string, score: number, needsReview: boolean) {
  const apiKey = process.env.RESEND_API_KEY;
  const owner = process.env.BIDFLO_OWNER_EMAIL;
  const from = process.env.BIDFLO_EMAIL_FROM;
  if (!apiKey || !owner || !from) return;
  const appUrl = (process.env.BIDFLO_URL ?? "").replace(/\/$/, "");
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: [owner],
    subject: `BidFlo ${needsReview ? "human review needed" : "approval ready"}: ${title}`,
    text: `A ${score}/100 opportunity has a ${needsReview ? "draft requiring human review because automated AI review was unavailable" : "reviewed proposal ready for approval"}.\n\n${title}\n${appUrl}/opportunities/${opportunityId}\n\nNo bid has been submitted.`,
  });
  if (error) throw new Error(`Proposal notification failed: ${error.message}`);
}

async function notifyClientReply(opportunityId: string | undefined, title: string | undefined) {
  const apiKey = process.env.RESEND_API_KEY;
  const owner = process.env.BIDFLO_OWNER_EMAIL;
  const from = process.env.BIDFLO_EMAIL_FROM;
  if (!apiKey || !owner || !from) return false;
  const appUrl = (process.env.BIDFLO_URL ?? "").replace(/\/$/, "");
  const safeTitle = (title ?? "Unlinked Upwork conversation").replace(/[\r\n\t]+/g, " ").trim().slice(0, 160);
  const reviewUrl = opportunityId ? `${appUrl}/opportunities/${opportunityId}` : `${appUrl}/follow-up`;
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: [owner],
    subject: `BidFlo client reply: ${safeTitle}`,
    text: `BidFlo detected a new Upwork client reply${opportunityId ? ` linked to ${safeTitle}` : " that could not be linked safely to one opportunity"}.\n\nReview it in BidFlo:\n${reviewUrl}\n\nNo message has been sent to the client.`,
  });
  if (error) throw new Error(`Client reply notification failed: ${error.message}`);
  return true;
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
  if (result.rejected || result.score < rules.autoPrepareScore) {
    if (!result.rejected) {
      await queueSlackSafely(`qualified:${opportunityId}`, {
        kind: "qualified", opportunityId, title: opportunity.title,
        score: result.score, amount: commercials.bidAmount,
      });
    }
    return { score: result.score, status: nextStatus };
  }

  const commercialDraft: ProposalDraft = { body: "", questions: [], ...commercials };
  // Never block opportunity intake when the model endpoint is down or a key has expired.
  // Unreviewed fallback drafts require a human to check every claim and commercial term.
  let draft: ProposalDraft = prepareManualReviewDraft(opportunity, commercialDraft);
  const minimumQualityScore = Number((settings.proposal_rules as Record<string, unknown>).minimumQualityScore ?? 80);
  let review: {
    score: number | null;
    issues: string[];
    humanJudgmentRequired: boolean;
    humanJudgmentReasons: string[];
    revisedProposal?: ProposalDraft | null;
  } = {
    score: null,
    issues: ["AI review unavailable; human review required"],
    humanJudgmentRequired: true,
    humanJudgmentReasons: ["Verify all scope, timeline and pricing before approving"],
    revisedProposal: null,
  };
  let aiReviewed = false;
  if (process.env.AI_API_KEY && process.env.AI_MODEL) {
    try {
      draft = await generateProposal({
        opportunity,
        score: result.score,
        breakdown: result.breakdown,
        capabilityProfile: settings.capability_profile as Record<string, unknown>,
        proposalRules: settings.proposal_rules as Record<string, unknown>,
        commercials: commercialDraft,
        approvedExamples: ((settings.proposal_rules as Record<string, unknown>).approvedExamples as string[] | undefined) ?? [],
      });
      review = await reviewProposal({
        opportunity,
        proposal: draft,
        capabilityProfile: settings.capability_profile as Record<string, unknown>,
        proposalRules: settings.proposal_rules as Record<string, unknown>,
        minimumQualityScore,
      });
      aiReviewed = true;
    } catch (error) {
      // If drafting succeeded but review failed, keep the draft but do not claim it was QC'd.
      const cause = error instanceof Error ? error.message.slice(0, 180) : "Unknown model failure";
      review.issues = [`Automated quality review unavailable: ${cause}`];
      await audit("system:ai", "ai.review_unavailable", "opportunity", opportunityId, { cause });
    }
  }
  const finalDraft = (review.score ?? 0) < minimumQualityScore && review.revisedProposal ? review.revisedProposal : draft;
  const proposalStatus = aiReviewed && (review.score ?? 0) >= minimumQualityScore && !review.humanJudgmentRequired ? "ready" : "needs_review";
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
  await queueSlackSafely(`proposal:${opportunityId}`, {
    kind: "proposal_ready", opportunityId, title: opportunity.title,
    score: result.score, amount: commercials.bidAmount,
  });
  try {
    await notifyProposalReady(opportunityId, opportunity.title, result.score, proposalStatus === "needs_review");
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
    // Link to the exact job or to a previously known Upwork conversation.
    // Never associate a client's private message with a guessed project.
    let opportunity: { id: string; title: string } | undefined;
    if (parsed.jobUrl) {
      const jobId = parsed.jobUrl.match(/~[A-Za-z0-9]+/)?.[0] ?? "";
      const matches = await sql`
        select id, title from bidflo_opportunities
        where job_url = ${parsed.jobUrl} or external_key = ${jobId}
        order by created_at desc limit 1
      `;
      if (matches[0]) opportunity = { id: String(matches[0].id), title: String(matches[0].title) };
    }
    if (!opportunity && parsed.roomUrl) {
      const matches = await sql`
        select o.id, o.title from bidflo_messages m
        join bidflo_opportunities o on o.id = m.opportunity_id
        where m.upwork_room_url = ${parsed.roomUrl}
        order by received_at desc limit 1
      `;
      if (matches[0]) opportunity = { id: String(matches[0].id), title: String(matches[0].title) };
    }
    if (!opportunity) {
      // An exact project-title mention is acceptable only if one active
      // submitted opportunity matches; ambiguous results stay unlinked.
      const candidates = await sql`
        select id, title from bidflo_opportunities
        where status in ('submitted', 'replied', 'interviewed')
          and strpos(lower(${parsed.subject}), lower(title)) > 0
        limit 2
      `;
      if (candidates.length === 1) opportunity = { id: String(candidates[0].id), title: String(candidates[0].title) };
    }
    const [inboundMessage] = await sql`
      insert into bidflo_messages (
        opportunity_id, direction, kind, sender, subject, body, received_at, upwork_room_url
      ) values (
        ${opportunity?.id ?? null}, 'inbound', 'client_reply',
        ${String(event.sender)}, ${parsed.subject}, ${parsed.body},
        ${String(event.received_at)}, ${parsed.roomUrl ?? null}
      ) returning id
    `;
    if (opportunity?.id) {
      await sql`update bidflo_opportunities set status = 'replied', updated_at = now() where id = ${opportunity.id}`;
    }
    await sql`update bidflo_inbound_events set status = 'processed', processed_at = now() where id = ${String(event.id)}`;
    await audit("system:email", "reply.detected", "opportunity", opportunity?.id, {
      subject: parsed.subject,
      linked: Boolean(opportunity?.id),
      hasRoomUrl: Boolean(parsed.roomUrl),
    });
    if (inboundMessage) {
      await queueSlackSafely(`reply:${String(inboundMessage.id)}`, {
        kind: "client_reply",
        opportunityId: opportunity?.id,
        title: opportunity?.title ?? parsed.subject,
        clientRoomUrl: parsed.roomUrl,
      });
    }
    try {
      if (await notifyClientReply(opportunity?.id, opportunity?.title)) {
        await audit("system:notification", "reply.notification_sent", "opportunity", opportunity?.id, { linked: Boolean(opportunity?.id) });
      }
    } catch (error) {
      await audit("system:notification", "reply.notification_failed", "opportunity", opportunity?.id, {
        error: error instanceof Error ? error.message.slice(0, 300) : "Unknown notification error",
      });
    }
    return { status: "reply", linked: Boolean(opportunity?.id) };
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
    // A previous processing attempt can fail after creating/scoring the opportunity.
    // Resume its draft instead of discarding it as a duplicate.
    const [existing] = await sql`select id from bidflo_opportunities where external_key = ${item.externalKey} limit 1`;
    if (existing) {
      const [proposal] = await sql`select id from bidflo_proposals where opportunity_id = ${String(existing.id)} limit 1`;
      if (!proposal) {
        const recovered = await qualifyAndPrepare(String(existing.id));
        await sql`update bidflo_inbound_events set status = 'processed', error = null, processed_at = now() where id = ${String(event.id)}`;
        return { ...recovered, recovered: true };
      }
    }
    await sql`update bidflo_inbound_events set status = 'duplicate', processed_at = now() where id = ${String(event.id)}`;
    return { status: "duplicate" };
  }
  const opportunityId = String(inserted.id);
  await audit("system:email", "opportunity.created", "opportunity", opportunityId, { externalKey: item.externalKey });
  const prepared = await qualifyAndPrepare(opportunityId);
  await sql`update bidflo_inbound_events set status = 'processed', error = null, processed_at = now() where id = ${String(event.id)}`;
  return prepared;
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
