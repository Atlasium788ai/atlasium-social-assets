import { createHash } from "node:crypto";
import type { OpportunityInput } from "./types";

export type ParsedInbound =
  | { kind: "opportunity"; opportunity: OpportunityInput }
  | { kind: "reply"; jobUrl?: string; subject: string; body: string }
  | { kind: "ignored"; reason: string };

export function plainTextFromEmail(text?: string | null, html?: string | null) {
  if (text?.trim()) return text.trim().slice(0, 20_000);
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 20_000);
}

function firstMatch(value: string, expressions: RegExp[]) {
  for (const expression of expressions) {
    const match = value.match(expression);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export function canonicalUpworkUrl(value: string) {
  const match = value.match(/https?:\/\/(?:www\.)?upwork\.com\/(?:ab\/messages|jobs|nx\/search\/jobs\/details)\/[^\s<>\])"']+/i);
  if (!match) return null;
  try {
    const url = new URL(match[0].replace(/&amp;/g, "&"));
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function parseMoney(value?: string | null) {
  if (!value) return null;
  const amount = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function extractBudget(body: string) {
  const hourly = body.match(/\$([\d,.]+)\s*(?:-|–|to)\s*\$?([\d,.]+)\s*(?:\/\s*(?:hr|hour)|hourly)/i);
  if (hourly) {
    return { budgetMin: parseMoney(hourly[1]), budgetMax: parseMoney(hourly[2]), budgetType: "hourly" as const };
  }
  const labeled = body.match(/(?:budget|fixed[ -]price)\s*:?\s*(?:USD\s*)?\$([\d,.]+)(?:\s*(?:-|–|to)\s*\$?([\d,.]+))?/i);
  if (labeled) {
    const low = parseMoney(labeled[1]);
    return { budgetMin: low, budgetMax: parseMoney(labeled[2]) ?? low, budgetType: "fixed" as const };
  }
  return { budgetMin: null, budgetMax: null, budgetType: "unknown" as const };
}

function cleanTitle(subject: string, body: string) {
  const subjectTitle = subject
    .replace(/^\s*(?:upwork\s*[-:]\s*)?/i, "")
    .replace(/^new job(?: recommendation| posted)?\s*:?\s*/i, "")
    .replace(/^job alert\s*:?\s*/i, "")
    .trim();
  if (subjectTitle && !/^(new jobs?|recommended jobs?|upwork)$/i.test(subjectTitle)) return subjectTitle.slice(0, 180);
  return (body.split("\n").map((line) => line.trim()).find((line) => line.length >= 8 && line.length <= 180) ?? "Untitled Upwork opportunity").slice(0, 180);
}

function extractRequirements(body: string) {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(?:[-•*]|\d+[.)])\s+/.test(line))
    .map((line) => line.replace(/^(?:[-•*]|\d+[.)])\s+/, "").slice(0, 300))
    .filter((line) => line.length > 3)
    .slice(0, 12);
}

function safeDescription(body: string) {
  return body
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/unsubscribe[\s\S]*$/i, "")
    .replace(/\b(?:ignore|disregard) (?:all|any|previous) instructions\b/gi, "[removed unsafe instruction]")
    .replace(/\b(?:system|developer) (?:prompt|message)\b/gi, "[removed unsafe instruction]")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 12_000);
}

export function parseUpworkEmail(input: {
  subject: string;
  text?: string | null;
  html?: string | null;
  receivedAt: string;
}): ParsedInbound {
  const body = plainTextFromEmail(input.text, input.html);
  const combined = `${input.subject}\n${body}`;
  const jobUrl = canonicalUpworkUrl(combined);
  const looksLikeReply = /(?:replied|message from|invitation|interview|offer|re:\s*)/i.test(input.subject);

  if (looksLikeReply) {
    return { kind: "reply", jobUrl: jobUrl ?? undefined, subject: input.subject.slice(0, 300), body: safeDescription(body) };
  }
  if (!jobUrl) return { kind: "ignored", reason: "No permitted Upwork job link found" };

  const budget = extractBudget(body);
  const jobId = jobUrl.match(/~[A-Za-z0-9]+/)?.[0];
  const externalKey = jobId ?? createHash("sha256").update(jobUrl).digest("hex");
  const clientRating = parseMoney(firstMatch(body, [/client rating\s*:?\s*([\d.]+)/i, /([\d.]+)\s*(?:out of 5|stars)/i]));
  const clientSpend = parseMoney(firstMatch(body, [/\$([\d,.]+)\+?\s*(?:total )?spent/i]));

  return {
    kind: "opportunity",
    opportunity: {
      externalKey,
      title: cleanTitle(input.subject, body),
      description: safeDescription(body),
      clientName: firstMatch(body, [/client\s*:?\s*([^\n]+)/i]),
      clientLocation: firstMatch(body, [/location\s*:?\s*([^\n]+)/i]),
      clientSpend,
      clientRating,
      ...budget,
      currency: "USD",
      jobUrl,
      requirements: extractRequirements(body),
      sourceSubject: input.subject.slice(0, 500),
      sourceReceivedAt: input.receivedAt,
    },
  };
}
