import { db, audit } from "./db";
import { parseUpworkEmail } from "./email-parser";
import { isExplicitClientStopRequest } from "./client-opt-out";
import { generateProposal, reviewProposal } from "./ai";
import { prepareManualReviewDraft } from "./manual-draft";
import { queueSlackAlertSafely } from "./slack-alerts";
import { notifyProposalReady, notifyClientReply } from "./owner-notifications";
import { qualifyOpportunity, recommendCommercials } from "./qualification";
import type { OpportunityInput, ProposalDraft, QualificationRules } from "./types";
import { canRescore, type OpportunityStage } from "./pipeline-guards";
import { proposalPreflight } from "./proposal-preflight";
import { retryPolicy } from "./retry-policy";

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

export async function qualifyAndPrepare(opportunityId: string) {
  const sql = db();
  const [opportunityRow] = await sql`select * from bidflo_opportunities where id = ${opportunityId}`;
  const [settings] = await sql`select * from bidflo_settings where id = 'default'`;
  if (!opportunityRow || !settings) throw new Error("Opportunity or Visez settings not found");
  if (!canRescore(String(opportunityRow.status) as OpportunityStage)) {
    throw new Error("Cannot rescore a submitted, approved, or closed opportunity");
  }

  const opportunity = rowToOpportunity(opportunityRow);
  const rules = settings.qualification_rules as QualificationRules;
  const result = qualifyOpportunity(opportunity, rules);
  const commercials = recommendCommercials(opportunity, rules.targetHourlyRate);
  const nextStatus = result.rejected ? "rejected" : "qualified";
  const willPrepareDraft = !result.rejected && result.score >= rules.autoPrepareScore;
  // Guard the update in SQL too: state can change between the initial read
  // and scoring, especially when a reviewer has the opportunity open.
  const [claim] = await sql`
    update bidflo_opportunities set
      score = ${result.score},
      score_breakdown = ${sql.json(result.breakdown)},
      rejection_reason = ${result.rejectionReason},
      recurring_potential = ${result.recurringPotential},
      suggested_bid = ${commercials.bidAmount},
      suggested_timeline = ${commercials.timeline},
      suggested_milestones = ${sql.json(commercials.milestones)},
      -- Keep the current reviewable draft visible while a replacement is prepared.
      status = case when status = 'proposal_ready' and ${willPrepareDraft}
                    then status else ${nextStatus} end,
      updated_at = now()
    where id = ${opportunityId}
      and status in ('new', 'rejected', 'qualified', 'proposal_ready')
    returning id
  `;
  if (!claim) throw new Error("Opportunity changed status before scoring could finish");
  await audit("system:qualification", "opportunity.scored", "opportunity", opportunityId, { score: result.score, status: nextStatus });
  if (result.rejected || result.score < rules.autoPrepareScore) {
    if (!result.rejected) {
      await queueSlackAlertSafely(`qualified:${opportunityId}`, {
        kind: "qualified", opportunityId, title: opportunity.title,
        score: result.score, amount: commercials.bidAmount,
      });
    }
    return { score: result.score, status: nextStatus };
  }

  const commercialDraft: ProposalDraft = { body: "", questions: [], ...commercials };
  const capabilityProfile = settings.capability_profile as Record<string, unknown>;
  const proposalRules = settings.proposal_rules as Record<string, unknown>;
  const approvedExamples = (proposalRules.approvedExamples as string[] | undefined) ?? [];
  // Never block opportunity intake when the model endpoint is down or a key has expired.
  // Unreviewed fallback drafts require a human to check every claim and commercial term.
  let draft: ProposalDraft = prepareManualReviewDraft(opportunity, commercialDraft);
  const minimumQualityScore = Number(proposalRules.minimumQualityScore ?? 80);
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
  if ((process.env.AI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim()) && process.env.AI_MODEL) {
    try {
      draft = await generateProposal({
        opportunity,
        score: result.score,
        breakdown: result.breakdown,
        capabilityProfile,
        proposalRules,
        commercials: commercialDraft,
        approvedExamples,
      });
      review = await reviewProposal({
        opportunity,
        proposal: draft,
        capabilityProfile,
        proposalRules,
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
  const preflight = proposalPreflight({ opportunity, proposal: finalDraft, proposalRules, capabilityProfile, approvedExamples });
  if (!preflight.ok) {
    review.issues = [...new Set([...review.issues, ...preflight.issues])];
    review.humanJudgmentRequired = true;
    review.humanJudgmentReasons = [...new Set([...review.humanJudgmentReasons, ...preflight.issues])].slice(0, 12);
  }
  const proposalStatus = aiReviewed && (review.score ?? 0) >= minimumQualityScore && !review.humanJudgmentRequired ? "ready" : "needs_review";
  // Serialization + state recheck prevent a slow AI operation from
  // inserting a new draft after human approval or submission. Version
  // numbering is protected by the parent opportunity row lock.
  const proposalId = await sql.begin(async (tx) => {
    const [latest] = await tx`
      select status from bidflo_opportunities where id = ${opportunityId} for update
    `;
    if (!latest || !canRescore(String(latest.status) as OpportunityStage)) return null;
    const [versionRow] = await tx`
      select coalesce(max(version), 0)::int + 1 as version
      from bidflo_proposals where opportunity_id = ${opportunityId}
    `;
    const [proposal] = await tx`
      insert into bidflo_proposals (
        opportunity_id, version, body, questions, bid_amount, timeline, milestones,
        quality_score, quality_review, human_judgment_required, status
      ) values (
        ${opportunityId}, ${Number(versionRow.version)}, ${finalDraft.body}, ${tx.json(finalDraft.questions)},
        ${finalDraft.bidAmount}, ${finalDraft.timeline}, ${tx.json(finalDraft.milestones)},
        ${review.score}, ${tx.json(review)}, ${review.humanJudgmentRequired}, ${proposalStatus}
      ) returning id
    `;
    await tx`
      update bidflo_opportunities set status = 'proposal_ready', updated_at = now()
      where id = ${opportunityId}
    `;
    return String(proposal.id);
  });
  if (!proposalId) throw new Error("Opportunity became approved or submitted while drafting");
  await audit("system:review", "proposal.prepared", "proposal", proposalId, { opportunityId, qualityScore: review.score, proposalStatus });
  await queueSlackAlertSafely(`proposal:${opportunityId}`, {
    kind: "proposal_ready", opportunityId, title: opportunity.title,
    score: result.score, amount: commercials.bidAmount,
  });
  try {
    await notifyProposalReady(opportunityId, opportunity.title, result.score, proposalStatus === "needs_review");
  } catch (error) {
    await audit("system:notification", "notification.failed", "opportunity", opportunityId, { error: error instanceof Error ? error.message : "Unknown error" });
  }
  return { score: result.score, status: "proposal_ready", proposalId };
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
        where job_url = ${parsed.jobUrl} or lower(external_key) = lower(${jobId})
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
        opportunity_id, direction, kind, sender, subject, body, received_at, upwork_room_url, source_event_id
      ) values (
        ${opportunity?.id ?? null}, 'inbound', 'client_reply',
        ${String(event.sender)}, ${parsed.subject}, ${parsed.body},
        ${String(event.received_at)}, ${parsed.roomUrl ?? null}, ${String(event.id)}
      ) on conflict (source_event_id) do nothing returning id
    `;
    if (opportunity?.id && inboundMessage && isExplicitClientStopRequest(payload.text ?? "")) {
      // The client, not the operator, explicitly requested no contact.
      // A won project remains a win; all other leads leave outreach queues.
      await sql`update bidflo_opportunities
        set opted_out_at = coalesce(opted_out_at, now()),
            opt_out_source = 'explicit_upwork_reply',
            status = case when status = 'won' then 'won' else 'opted_out' end,
            nurture_due_at = null,
            updated_at = now()
        where id = ${opportunity.id}`;
      await audit("system:upwork_client", "contact.opted_out", "opportunity", opportunity.id, {
        sourceEventId: String(event.id), clientRequested: true,
      });
    } else if (opportunity?.id) {
      // Client messages may resume active follow-ups; opted-out status cannot be reversed.
      await sql`update bidflo_opportunities set status = 'replied', updated_at = now()
        where id = ${opportunity.id} and status in ('submitted', 'replied', 'nurture') and opted_out_at is null`;
    }
    const [messageForAlert] = inboundMessage ? [inboundMessage] : await sql`
      select id from bidflo_messages where source_event_id = ${String(event.id)} limit 1
    `;
    if (inboundMessage) {
      await audit("system:email", "reply.detected", "opportunity", opportunity?.id, {
        subject: parsed.subject,
        linked: Boolean(opportunity?.id),
        hasRoomUrl: Boolean(parsed.roomUrl),
      });
    }
    if (messageForAlert) {
      await queueSlackAlertSafely(`reply:${String(messageForAlert.id)}`, {
        kind: "client_reply",
        opportunityId: opportunity?.id,
        title: opportunity?.title ?? parsed.subject,
        clientRoomUrl: parsed.roomUrl,
      });
    }
    try {
      if (inboundMessage && await notifyClientReply(opportunity?.id, opportunity?.title)) {
        await audit("system:notification", "reply.notification_sent", "opportunity", opportunity?.id, { linked: Boolean(opportunity?.id) });
      }
    } catch (error) {
      await audit("system:notification", "reply.notification_failed", "opportunity", opportunity?.id, {
        error: error instanceof Error ? error.message.slice(0, 300) : "Unknown notification error",
      });
    }
    await sql`update bidflo_inbound_events set status = 'processed', processed_at = now(), error = null
      where id = ${String(event.id)} and status = 'processing'`;
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
    ) on conflict do nothing returning id
  `;
  if (!inserted) {
    // A previous processing attempt can fail after creating/scoring the opportunity.
    // Resume its draft instead of discarding it as a duplicate.
    const [existing] = await sql`select id from bidflo_opportunities where lower(external_key) = lower(${item.externalKey}) limit 1`;
    if (existing) {
      const [proposal] = await sql`
        select id from bidflo_proposals where opportunity_id = ${String(existing.id)}
        order by version desc limit 1
      `;
      if (!proposal) {
        const recovered = await qualifyAndPrepare(String(existing.id));
        await sql`update bidflo_inbound_events
            set status = 'processed', error = null, processed_at = now()
            where id = ${String(event.id)}`;
        return { ...recovered, recovered: true };
      }
      // A previous worker may have inserted the proposal but crashed before
      // changing the opportunity status. Repair that incomplete state, only
      // while nobody has already approved or submitted it.
      const [repair] = await sql`
        update bidflo_opportunities set status = 'proposal_ready', updated_at = now()
        where id = ${String(existing.id)} and status in ('new', 'qualified')
        returning id
      `;
      if (repair) {
        await sql`update bidflo_inbound_events
           set status = 'processed', error = null, processed_at = now()
           where id = ${String(event.id)}`;
        await queueSlackAlertSafely(`proposal:${String(existing.id)}`, {
          kind: "proposal_ready", opportunityId: String(existing.id),
          title: String(item.title),
        });
        return { status: "proposal_ready", recovered: true };
      }
    }
    await sql`update bidflo_inbound_events set status = 'duplicate', processed_at = now()
      where id = ${String(event.id)}`;
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
  // A crashed worker cannot permanently strand messages. Claim eligible work in
  // one atomic statement; SELECT ... FOR UPDATE alone does not protect later queries.
  await sql`
    update bidflo_inbound_events
       set status = 'pending', retry_at = now()
     where status = 'processing'
       and processed_at is null
       and retry_at <= now()
  `;

  const events = await sql`
    with candidates as (
      select id from bidflo_inbound_events
       where status = 'pending' and retry_at <= now()
       order by received_at asc
       limit ${Math.max(1, Math.min(limit, 20))}
       for update skip locked
    )
    update bidflo_inbound_events as e
       set status = 'processing', attempts = attempts + 1,
           retry_at = now() + interval '10 minutes'
      from candidates
     where e.id = candidates.id
    returning e.*
  `;

  const results: Array<Record<string, unknown>> = [];
  for (const event of events) {
    try {
      results.push(await processEvent(event));
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 450) : "Processing failed";
      const attempt = Number(event.attempts ?? 1);
      const retry = retryPolicy(attempt, { maxAttempts: 5, maxDelayMinutes: 60 });
      const dead = retry.exhausted;
      const delay = retry.delayMinutes;
      await sql`
        update bidflo_inbound_events
           set status = ${dead ? "failed" : "pending"},
               error = ${message}, processed_at = ${dead ? new Date() : null},
               retry_at = now() + (${delay} * interval '1 minute')
         where id = ${String(event.id)} and status = 'processing'
      `;
      await audit("system:workflow", dead ? "inbound.dead_lettered" : "inbound.retry_scheduled",
        "inbound_event", String(event.id), { attempt, delayMinutes: delay, error: message });
      results.push({ status: dead ? "failed" : "retry_scheduled", eventId: String(event.id), attempt });
    }
  }
  return { processed: results.length, results };
}
