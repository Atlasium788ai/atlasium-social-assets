import { db } from "@/lib/db";
import { requireAdminSession, unauthorizedResponse } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminSession();
  } catch {
    return unauthorizedResponse();
  }
  const sql = db();
  const replies = await sql`
    select
      m.id, m.body, m.received_at, m.upwork_room_url,
      o.id as opportunity_id, o.title, o.job_url
    from bidflo_messages m
    join bidflo_opportunities o on o.id = m.opportunity_id
    where m.direction = 'inbound' and m.kind = 'client_reply'
      and coalesce(m.received_at, m.created_at) > now() - interval '14 days'
    order by coalesce(m.received_at, m.created_at) desc, m.created_at desc
    limit 10
  `;
  return Response.json({ replies }, { headers: { "Cache-Control": "no-store" } });
}
