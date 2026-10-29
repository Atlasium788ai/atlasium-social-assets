import { audit, db } from "@/lib/db";
import { requireAdminSession, unauthorizedResponse } from "@/lib/auth/server";
import { isSameOriginMutation, mutationForbidden } from "@/lib/security";
import { deriveProofKeywords, MAX_PROOF_DOCUMENT_BYTES, safeProofFilename, validateProofPdf } from "@/lib/proof-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { await requireAdminSession(); } catch { return unauthorizedResponse(); }
  const documents = await db()`
    select id, name, mime_type, size_bytes, description, keywords, verified, active, created_at
    from visez_proof_documents
    where active = true
    order by created_at desc
  `;
  return Response.json({ documents });
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return mutationForbidden();
  let actor = "admin";
  try { actor = (await requireAdminSession()).user?.email ?? actor; } catch { return unauthorizedResponse(); }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_PROOF_DOCUMENT_BYTES + 1024 * 1024) {
    return Response.json({ error: "PDF must be 10 MB or smaller." }, { status: 413 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose a PDF to upload." }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validationError = validateProofPdf({ name: file.name, size: file.size, bytes });
  if (validationError) return Response.json({ error: validationError }, { status: 400 });

  const name = safeProofFilename(file.name);
  const description = String(form?.get("description") ?? "").trim().slice(0, 1000);
  const keywords = deriveProofKeywords(name, description, String(form?.get("keywords") ?? ""));
  if (!keywords.length) return Response.json({ error: "Add a description or matching term for this proof." }, { status: 400 });
  const verified = form?.get("verified") === "true";
  const sql = db();
  const [document] = await sql`
    insert into visez_proof_documents
      (name, content, mime_type, size_bytes, description, keywords, verified, created_by)
    values
      (${name}, ${Buffer.from(bytes)}, 'application/pdf', ${file.size}, ${description}, ${keywords}, ${verified}, ${actor})
    returning id, name, size_bytes, description, keywords, verified, active, created_at
  `;
  await audit(actor, "proof_document.uploaded", "proof_document", String(document.id), {
    name, sizeBytes: file.size, verified, keywordCount: keywords.length,
  });
  return Response.json({ document }, { status: 201 });
}
