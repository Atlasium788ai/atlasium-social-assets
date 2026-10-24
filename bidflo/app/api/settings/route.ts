import { z } from "zod";
import { audit, db } from "@/lib/db";
import { requireAdminSession, unauthorizedResponse } from "@/lib/auth/server";

const qualificationSchema = z.object({
  section: z.literal("qualification").optional(),
  minimumScore: z.number().int().min(0).max(100),
  autoPrepareScore: z.number().int().min(0).max(100),
  minimumBudget: z.number().nonnegative(),
  targetHourlyRate: z.number().positive(),
  serviceFitKeywords: z.array(z.string().min(1)).max(100),
  poorFitKeywords: z.array(z.string().min(1)).max(100),
  complexityPenaltyKeywords: z.array(z.string().min(1)).max(100),
  recurringKeywords: z.array(z.string().min(1)).max(100),
});

const bidSchema = z.object({
  section: z.literal("bid"),
  capabilityProfile: z.object({
    company: z.string().min(1).max(100), positioning: z.string().min(1).max(500),
    services: z.array(z.string().min(1)).max(100), proof: z.array(z.string().min(1)).max(100),
    deliveryStandards: z.array(z.string().min(1)).max(100),
  }),
  proposalRules: z.object({
    maxWords: z.number().int().min(80).max(800), minimumQualityScore: z.number().int().min(0).max(100),
    tone: z.string().min(1).max(500), pricingNotes: z.string().max(2000),
    bannedPhrases: z.array(z.string().min(1)).max(100), requiredSections: z.array(z.string().min(1)).max(50),
    approvalRequired: z.literal(true),
  }),
});

const followUpSchema = z.object({
  section: z.literal("followUp"),
  followUpRules: z.object({ firstReminderDays: z.number().int().min(1).max(30), secondReminderDays: z.number().int().min(2).max(60), staleAfterDays: z.number().int().min(3).max(120), notifyOnReply: z.literal(true) }),
});

export async function GET() {
  try { await requireAdminSession(); } catch { return unauthorizedResponse(); }
  const [settings] = await db()`select * from bidflo_settings where id = 'default'`;
  return Response.json({ settings });
}

export async function PATCH(request: Request) {
  let actor = "admin";
  try { actor = (await requireAdminSession()).user?.email ?? actor; } catch { return unauthorizedResponse(); }
  const body = await request.json();
  const sql = db();
  if (body.section === "bid") {
    const parsed = bidSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "Invalid bidding rules", detail: parsed.error.flatten() }, { status: 400 });
    const [current] = await sql`select proposal_rules from bidflo_settings where id = 'default'`;
    const nextRules = { ...(current.proposal_rules as Record<string, unknown>), ...parsed.data.proposalRules };
    await sql`update bidflo_settings set capability_profile = ${sql.json(parsed.data.capabilityProfile)}, proposal_rules = ${sql.json(nextRules as never)}, updated_at = now() where id = 'default'`;
    await audit(actor, "settings.bid_updated", "settings", "default");
    return Response.json({ ok: true });
  }
  if (body.section === "followUp") {
    const parsed = followUpSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "Invalid follow-up rules", detail: parsed.error.flatten() }, { status: 400 });
    const [current] = await sql`select proposal_rules from bidflo_settings where id = 'default'`;
    const next = { ...(current.proposal_rules as Record<string, unknown>), followUp: parsed.data.followUpRules };
    await sql`update bidflo_settings set proposal_rules = ${sql.json(next as never)}, updated_at = now() where id = 'default'`;
    await audit(actor, "settings.follow_up_updated", "settings", "default");
    return Response.json({ ok: true });
  }
  const parsed = qualificationSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid rules", detail: parsed.error.flatten() }, { status: 400 });
  const { section: _section, ...rules } = parsed.data;
  await sql`update bidflo_settings set qualification_rules = ${sql.json(rules)}, updated_at = now() where id = 'default'`;
  await audit(actor, "settings.qualification_updated", "settings", "default");
  return Response.json({ ok: true });
}
