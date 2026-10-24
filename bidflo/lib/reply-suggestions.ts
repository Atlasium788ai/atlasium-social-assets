export const REPLY_TONES = ["direct", "consultative", "friendly"] as const;
export type ReplyTone = (typeof REPLY_TONES)[number];

export const REPLY_LABELS: Record<ReplyTone, string> = {
  direct: "Direct",
  consultative: "Consultative",
  friendly: "Friendly",
};

function cleanLabel(text: string) {
  return text.replace(/[\r\n<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 95);
}

/**
 * An explicit, non-AI alternative while the account has no funded AI key.
 * It never promises a meeting time, sends a message, or directs a prospect off Upwork.
 */
export function starterReply(title: string, clientMessage: string, tone: ReplyTone, generation: number) {
  const project = cleanLabel(title) || "your project";
  const short = project.length > 66 ? `${project.slice(0, 63)}…` : project;
  const note = clientMessage.toLowerCase();
  const meetingRequested = /\b(meet|meeting|call|interview|schedule|availability|available to talk|zoom)\b/.test(note);
  const invitation = meetingRequested
    ? "Please send a meeting invitation in Upwork Messages with the time you prefer. I'll confirm availability there."
    : "Would you be open to a short meeting through Upwork Messages? You can send an invitation using Upwork's meeting scheduler.";
  const starters: Record<ReplyTone, string[]> = {
    direct: [
      `Thanks for your response about ${short}. The next step is a quick discussion of priorities and scope.`,
      `Thanks for getting back to me. I can discuss the requirements for ${short} and outline a practical next step.`,
      `Appreciate the reply. A brief conversation would help us agree on the key deliverables for ${short}.`,
      `Thanks for the update. Let's clarify the immediate needs for ${short} before we commit to a plan.`,
    ],
    consultative: [
      `Thanks for the message. I'd like to understand the biggest priority for ${short} and what success looks like on your side.`,
      `I appreciate the response. A few minutes discussing your current process and constraints would help us define the right scope for ${short}.`,
      `Thanks for following up. It would help to understand which part of ${short} matters most first, then map out a focused approach.`,
      `Good to hear from you. Before suggesting the next milestone, I'd like to clarify the goals and dependencies for ${short}.`,
    ],
    friendly: [
      `Great to hear back from you. ${short} sounds like a project worth discussing in a little more detail.`,
      `Thanks for reaching out. Happy to talk through what you're aiming to achieve with ${short}.`,
      `Appreciate you getting back to me. I'd be glad to learn more about the direction you're considering for ${short}.`,
      `Thanks for the note. It would be great to walk through your priorities for ${short} together.`,
    ],
  };
  return `${starters[tone][generation % starters[tone].length]}\n\n${invitation}`;
}

export function safeSuggestedReply(text: string): boolean {
  const value = text.trim();
  if (value.length < 50 || value.length > 1300) return false;
  if (!/\bupwork\b/i.test(value) || !/\b(call|meet|meeting|invite|interview)\b/i.test(value)) return false;
  if (/https?:\/\/|www\.|@[a-z0-9.-]+\.[a-z]{2,}|\b(calendly|whatsapp|telegram|skype|google meet|my email|your email|email me|text me)\b/i.test(value)) return false;
  return true;
}
