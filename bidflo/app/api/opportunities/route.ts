import { db } from "@/lib/db";
import { requireAdminSession, unauthorizedResponse } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAdminSession();
  } catch {
    return unauthorizedResponse();
  }
  const status = new URL(request.url).searchParams.get("status");
  const sql = db();
  const rows = status
    ? await sql`select * from bidflo_opportunities where status = ${status} order by score desc nulls last, created_at desc limit 100`
    : await sql`select * from bidflo_opportunities order by created_at desc limit 100`;
  return Response.json({ opportunities: rows });
}
