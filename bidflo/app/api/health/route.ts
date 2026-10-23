export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ status: "ok", service: "bidflo", timestamp: new Date().toISOString() });
}
