import { z } from "zod";
import { audit, db } from "@/lib/db";
import { requireAdminSession, unauthorizedResponse } from "@/lib/auth/server";

const rulesSchema = z.object({
  minimumScore: z.number().int().min(0).max(100),
  autoPrepareScore: z.number().int().min(0).max(100),
  minimumBudget: z.number().nonnegative(),
  targetHourlyRate: z.number().positive(),
  serviceFitKeywords: z.array(z.string().min(1)).max(100),
  poorFitKeywords: z.array(z.string().min(1)).max(100),
  complexityPenaltyKeywords: z.array(z.string().min(1)).max(100),
  recurringKeywords: z.array(z.string().min(1)).max(100),
});

export async function GET() {
  try { await requireAdminSession(); } catch { return unauthorizedResponse(); }
  const [settings] = await db()`select * from bidflo_settings where id = 'default'`;
  return Response.json({ settings });
}

export async function PATCH(request: Request) {
  let actor = "admin";
  try { actor = (await requireAdminSession()).user?.email ?? actor; } catch { return unauthorizedResponse(); }
  const parsed = rulesSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid rules", detail: parsed.error.flatten() }, { status: 400 });
  const sql = db();
  await sql`update bidflo_settings set qualification_rules = ${sql.json(parsed.data)}, updated_at = now() where id = 'default'`;
  await audit(actor, "settings.qualification_updated", "settings", "default");
  return Response.json({ ok: true });
}
