import { processPendingEvents } from "@/lib/workflow";
import { processSlackAlerts } from "@/lib/slack-alerts";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(secret && bearer && bearer === secret);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const events = await processPendingEvents(5);
  const slack = await processSlackAlerts(10);
  return Response.json({ ...events, slack });
}
