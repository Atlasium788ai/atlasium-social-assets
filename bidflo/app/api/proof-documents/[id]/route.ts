import { db } from "@/lib/db";
import { requireAdminSession, unauthorizedResponse } from "@/lib/auth/server";
import { safeProofFilename } from "@/lib/proof-library";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { await requireAdminSession(); } catch { return unauthorizedResponse(); }
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Invalid document id" }, { status: 400 });
  const [document] = await db()`
    select name, content, mime_type
    from visez_proof_documents
    where id = ${id} and active = true
  `;
  if (!document) return Response.json({ error: "Proof document not found" }, { status: 404 });
  const bytes = Buffer.from(document.content as Uint8Array);
  const content = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(content, {
    headers: {
      "Content-Type": String(document.mime_type),
      "Content-Disposition": `attachment; filename="${safeProofFilename(String(document.name))}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
