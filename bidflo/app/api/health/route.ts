import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const sql = db();
    // Check the actual dependency instead of reporting "ok" from a running
    // web process that has lost access to its data.
    await sql`select 1 as ready`;
    return Response.json({ status: "ok", service: "visez", database: "ready", timestamp: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("Visez readiness failed: database unreachable");
    return Response.json({ status: "degraded", service: "visez", database: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
