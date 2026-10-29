import type { OpportunityInput } from "./types";

export type ApprovedAttachment = {
  id: string;
  name: string;
  href: string;
  description: string;
  keywords: string[];
  verified: boolean;
};

export type AttachmentRecommendation = ApprovedAttachment & { reason: string };

function approvedAttachments(proposalRules: Record<string, unknown>): ApprovedAttachment[] {
  const value = proposalRules.approvedAttachments;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const keywords = Array.isArray(row.keywords)
      ? row.keywords.filter((keyword): keyword is string => typeof keyword === "string" && keyword.trim().length > 1)
      : [];
    if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.href !== "string"
      || typeof row.description !== "string" || row.verified !== true || !keywords.length) return [];
    if (!row.href.startsWith("/api/attachments/")) return [];
    return [{
      id: row.id,
      name: row.name,
      href: row.href,
      description: row.description,
      keywords,
      verified: true,
    }];
  });
}

export function recommendAttachments(
  opportunity: OpportunityInput,
  proposalRules: Record<string, unknown>,
): AttachmentRecommendation[] {
  const source = `${opportunity.title}\n${opportunity.description}\n${opportunity.requirements.join("\n")}`.toLowerCase();
  return approvedAttachments(proposalRules).flatMap((attachment) => {
    const matched = attachment.keywords.filter((keyword) => source.includes(keyword.toLowerCase()));
    if (!matched.length) return [];
    return [{
      ...attachment,
      reason: `Relevant to the client's ${matched.slice(0, 3).join(", ")} requirements`,
    }];
  }).slice(0, 3);
}
