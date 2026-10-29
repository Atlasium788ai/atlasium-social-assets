import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { requireAdminSession, unauthorizedResponse } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { await requireAdminSession(); } catch { return unauthorizedResponse(); }
  try {
    const content = await readFile(join(process.cwd(), "output", "pdf", "atlasium-paid-media-fulfilment-overview.pdf"));
    return new Response(content, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="Atlasium-Paid-Media-Fulfilment-Overview.pdf"',
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Attachment is not available" }, { status: 404 });
  }
}
