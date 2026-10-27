export type SlackAlertKind = "qualified" | "proposal_ready" | "client_reply" | "submitted" | "interviewed" | "won";

export type SlackAlertInput = {
  kind: SlackAlertKind;
  title: string;
  opportunityId?: string | null;
  score?: number | null;
  amount?: number | null;
  clientRoomUrl?: string | null;
};

const descriptions: Record<SlackAlertKind, string> = {
  qualified: "Qualified job found",
  proposal_ready: "Proposal needs review",
  client_reply: "Client replied: action needed",
  submitted: "Submission recorded",
  interviewed: "Interview stage updated",
  won: "Opportunity marked won",
};

export function slackEscape(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}

export function formatSlackAlert(input: SlackAlertInput, baseUrl: string) {
  const lines = [
    `*Visez | ${descriptions[input.kind]}*`,
    `*${slackEscape(input.title || "Upwork opportunity")}*`,
  ];
  if (Number.isFinite(input.score)) lines.push(`Fit score: ${input.score}/100`);
  if (input.amount != null && Number.isFinite(input.amount)) {
    lines.push(`Suggested bid: US$${Math.round(input.amount).toLocaleString("en-US")} (review required)`);
  }
  const origin = baseUrl.replace(/\/$/, "");
  const safeOrigin = ["https://atlasium-visez.onrender.com", "https://atlasium-bidflo.onrender.com"].includes(origin) ||
    /^https:\/\/([a-z0-9-]+\.)?atlasium788\.ca$/i.test(origin) ? origin : "";
  const link = input.opportunityId && /^[0-9a-f-]{36}$/i.test(input.opportunityId)
    ? `${safeOrigin}/opportunities/${input.opportunityId}`
    : `${safeOrigin}/follow-up`;
  if (safeOrigin) lines.push(`<${link}|Open in Visez>`);
  if (input.clientRoomUrl) {
    try {
      const url = new URL(input.clientRoomUrl);
      if (url.protocol === "https:" && ["www.upwork.com", "upwork.com"].includes(url.hostname.toLowerCase())
        && url.pathname.startsWith("/ab/messages/rooms/")) {
        url.search = "";
        lines.push(`<${url.href}|Open Upwork conversation>`);
      }
    } catch { /* Ignore unsafe URLs. */ }
  }
  lines.push("No proposals or replies were sent automatically.");
  return lines.join("\n");
}
