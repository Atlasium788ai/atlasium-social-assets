const baseUrl = process.env.VISEZ_URL?.replace(/\/$/, "");
const secret = process.env.CRON_SECRET;

if (!baseUrl || !secret) throw new Error("VISEZ_URL and CRON_SECRET are required");

const response = await fetch(`${baseUrl}/api/cron/process`, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(290_000),
});

const body = await response.text();
if (!response.ok) throw new Error(`Visez processing failed (${response.status}): ${body.slice(0, 500)}`);
console.log(body);
