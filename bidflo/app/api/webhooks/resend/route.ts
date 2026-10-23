import { Resend } from "resend";
import { audit } from "@/lib/db";
import { recordInboundEvent } from "@/lib/workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAllowedSender(sender: string) {
  const allowed = (process.env.UPWORK_ALLOWED_SENDERS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const normalized = sender.match(/<([^>]+)>/)?.[1]?.toLowerCase() ?? sender.toLowerCase();
  return allowed.includes(normalized);
}

export async function POST(request: Request) {
  const apiKey = process.env.RESEND_API_KEY;
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!apiKey || !secret) return new Response("Webhook unavailable", { status: 503 });
  const resend = new Resend(apiKey);
  try {
    const payload = await request.text();
    const event = resend.webhooks.verify({
      payload,
      headers: {
        id: request.headers.get("svix-id") ?? "",
        timestamp: request.headers.get("svix-timestamp") ?? "",
        signature: request.headers.get("svix-signature") ?? "",
      },
      webhookSecret: secret,
    });
    // Resend Inboxes use a separate event and retrieval API from classic Receiving.
    if (event.type === "inbox.email.received") {
      const data = event.data as {
        inbox_id: string;
        thread_id: string;
        email_id: string;
        email?: { from: string; subject: string };
      };
      if (!data.email || !isAllowedSender(data.email.from)) {
        await audit("system:webhook", "inbound.rejected_sender", "inbound_event", data.email_id, {
          sender: data.email?.from ?? "unknown",
        });
        return new Response("OK");
      }
      const result = await resend.inboxes.threads.emails.get({
        inboxId: data.inbox_id,
        threadId: data.thread_id,
        emailId: data.email_id,
      });
      if (result.error || !result.data) {
        throw new Error(result.error?.message ?? "Unable to retrieve inbox email");
      }
      await recordInboundEvent({
        providerEventId: `inbox:${data.email_id}`,
        sender: data.email.from,
        subject: data.email.subject,
        receivedAt: event.created_at ?? new Date().toISOString(),
        text: result.data.text,
        html: result.data.html,
      });
      return new Response("OK");
    }
    if (event.type !== "email.received") return new Response("OK");
    const data = event.data as { email_id: string; from: string; subject: string; created_at?: string; message_id?: string };
    if (!isAllowedSender(data.from)) {
      await audit("system:webhook", "inbound.rejected_sender", "inbound_event", data.email_id, { sender: data.from });
      return new Response("OK");
    }
    const result = await resend.emails.receiving.get(data.email_id);
    if (result.error || !result.data) throw new Error(result.error?.message ?? "Unable to retrieve inbound email");
    await recordInboundEvent({
      providerEventId: data.email_id,
      messageId: data.message_id ?? null,
      sender: data.from,
      subject: data.subject,
      receivedAt: data.created_at ?? new Date().toISOString(),
      text: result.data.text,
      html: result.data.html,
    });
    return new Response("OK");
  } catch (error) {
    console.error("BidFlo inbound webhook rejected", error instanceof Error ? error.message : "Unknown error");
    return new Response("Invalid webhook", { status: 400 });
  }
}
