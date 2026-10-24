import { audit, db } from "./db";
import { formatSlackAlert, type SlackAlertInput } from "./slack-message";

/**
 * Queue safely: event_key is unique and duplicate ingestion cannot spam Slack.
 * Queueing is independent from delivery so a Slack outage never blocks BidFlo.
 */
export async function queueSlackAlert(eventKey: string, input: SlackAlertInput) {
  if (!/^[a-z0-9_.:-]{6,200}$/i.test(eventKey)) throw new Error("Invalid Slack event key");
  const sql = db();
  const content = formatSlackAlert(input, process.env.BIDFLO_URL ?? "");
  await sql`
    insert into bidflo_notifications (event_key, event_type, opportunity_id, message)
    values (${eventKey}, ${input.kind}, ${input.opportunityId ?? null}, ${content})
    on conflict (event_key) do nothing
  `;
}

export async function queueSlackAlertSafely(eventKey: string, input: SlackAlertInput) {
  try {
    await queueSlackAlert(eventKey, input);
  } catch (error) {
    await audit("system:slack", "slack.enqueue_failed", "opportunity", input.opportunityId ?? undefined, {
      eventKey,
      reason: error instanceof Error ? error.message.slice(0, 180) : "Unknown queue failure",
    }).catch(() => {});
  }
}

function getDestination() {
  const botToken = process.env.SLACK_BOT_TOKEN?.trim();
  const destination = process.env.SLACK_DESTINATION_ID?.trim();
  const webhook = process.env.SLACK_WEBHOOK_URL?.trim();
  if (botToken && destination && /^[CDGUW][A-Z0-9]{7,}$/.test(destination)) {
    return { kind: "bot" as const, botToken, destination };
  }
  if (webhook) {
    try {
      const url = new URL(webhook);
      if (url.protocol === "https:" && ["hooks.slack.com", "hooks.slack-gov.com"].includes(url.hostname)
        && url.pathname.startsWith("/services/")) return { kind: "webhook" as const, webhook };
    } catch {}
  }
  return null;
}

export function slackDeliveryConfigured() {
  return getDestination() !== null;
}

type SlackResponse = { ok?: boolean; error?: string; channel?: string | { id?: string } };

async function postWithToken(token: string, method: string, data: object) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Slack API HTTP ${response.status}`);
  const payload = await response.json() as SlackResponse;
  if (!payload.ok) throw new Error(`Slack ${method}: ${String(payload.error ?? "unknown_error").slice(0, 90)}`);
  return payload;
}

async function deliver(text: string) {
  const delivery = getDestination();
  if (!delivery) throw new Error("Slack bot credentials or incoming webhook not configured");
  if (delivery.kind === "webhook") {
    const response = await fetch(delivery.webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, unfurl_links: false }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Slack webhook HTTP ${response.status}`);
    const acknowledgement = (await response.text()).trim();
    if (acknowledgement !== "ok") throw new Error("Slack webhook did not acknowledge delivery");
    return;
  }
  let channel = delivery.destination;
  if (/^[UW]/.test(channel)) {
    const conversation = await postWithToken(delivery.botToken, "conversations.open", { users: channel });
    const dmId = conversation.channel && typeof conversation.channel === "object" ? conversation.channel.id : undefined;
    if (!dmId) throw new Error("Slack DM could not be opened");
    channel = dmId;
  }
  await postWithToken(delivery.botToken, "chat.postMessage", {
    channel, text, link_names: false, unfurl_links: false, unfurl_media: false,
  });
}

export async function processSlackAlerts(limit = 10) {
  if (!slackDeliveryConfigured()) return { configured: false, delivered: 0, failed: 0, pending: true };
  const sql = db();
  // Reclaim interrupted attempts. Lock and claim atomically to avoid duplicate concurrent delivery.
  await sql`
    update bidflo_notifications set status = 'pending', updated_at = now()
    where status = 'sending' and updated_at < now() - interval '5 minutes'
  `;
  const candidates = await sql`
    with picked as (
      select id from bidflo_notifications
      where status = 'pending' and retry_at <= now()
      order by created_at asc
      limit ${Math.max(1, Math.min(limit, 20))}
      for update skip locked
    )
    update bidflo_notifications as n
    set status = 'sending', attempts = attempts + 1, updated_at = now()
    from picked
    where n.id = picked.id
    returning n.id, n.event_type, n.opportunity_id, n.message, n.attempts
  `;
  let delivered = 0, failed = 0;
  for (const item of candidates) {
    try {
      await deliver(String(item.message));
      await sql`
        update bidflo_notifications
        set status = 'sent', sent_at = now(), last_error = null, updated_at = now()
        where id = ${String(item.id)}
      `;
      await audit("system:slack", "slack.notification_sent", "notification", String(item.id), {
        eventType: String(item.event_type), opportunityId: item.opportunity_id ? String(item.opportunity_id) : null,
      });
      delivered++;
    } catch (error) {
      failed++;
      const reason = error instanceof Error ? error.message.slice(0, 180) : "Slack delivery failed";
      // Retry with capped exponential backoff; stop after 8 attempts.
      const exhausted = Number(item.attempts) >= 8;
      const retryMinutes = Math.min(2 ** Math.min(Number(item.attempts), 7), 120);
      await sql`
        update bidflo_notifications
        set status = ${exhausted ? "failed" : "pending"},
            last_error = ${reason},
            retry_at = now() + (${retryMinutes} * interval '1 minute'),
            updated_at = now()
        where id = ${String(item.id)}
      `;
      await audit("system:slack", "slack.notification_failed", "notification", String(item.id), {
        eventType: String(item.event_type), reason,
      });
    }
  }
  return { configured: true, delivered, failed };
}
