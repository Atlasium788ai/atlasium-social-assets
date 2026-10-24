import { Resend } from "resend";

/**
 * Owner notification delivery lives here, independent of opportunity intake.
 * One place to change sender, recipient, or transport later.
 */
async function sendOwnerEmail(subject: string, body: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const owner = process.env.BIDFLO_OWNER_EMAIL;
  const from = process.env.BIDFLO_EMAIL_FROM;
  if (!apiKey || !owner || !from) return false;
  const { error } = await new Resend(apiKey).emails.send({
    from,
    to: [owner],
    subject,
    text: body,
  });
  if (error) throw new Error(`BidFlo email notification failed: ${error.message}`);
  return true;
}

export async function notifyProposalReady(
  opportunityId: string, title: string, score: number, needsReview: boolean,
): Promise<void> {
  const appUrl = (process.env.BIDFLO_URL ?? "").replace(/\/$/, "");
  const subject = `BidFlo ${needsReview ? "human review needed" : "approval ready"}: ${title}`;
  const detail = needsReview
    ? "draft requiring human review because automated AI review was unavailable"
    : "reviewed proposal ready for approval";
  await sendOwnerEmail(
    subject,
    `A ${score}/100 opportunity has a ${detail}.\n\n${title}\n${appUrl}/opportunities/${opportunityId}\n\nNo bid has been submitted.`,
  );
}

export async function notifyClientReply(
  opportunityId: string | undefined, title: string | undefined,
): Promise<boolean> {
  const appUrl = (process.env.BIDFLO_URL ?? "").replace(/\/$/, "");
  const safeTitle = (title ?? "Unlinked Upwork conversation").replace(/[\r\n\t]+/g, " ").trim().slice(0, 160);
  const reviewUrl = opportunityId ? `${appUrl}/opportunities/${opportunityId}` : `${appUrl}/follow-up`;
  const detail = opportunityId ? ` linked to ${safeTitle}` : " that could not be linked safely to one opportunity";
  return sendOwnerEmail(
    `BidFlo client reply: ${safeTitle}`,
    `BidFlo detected a new Upwork client reply${detail}.\n\nReview it in BidFlo:\n${reviewUrl}\n\nNo message has been sent to the client.`,
  );
}
