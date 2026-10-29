"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type ProofDocument = {
  id: string; name: string; size_bytes: number; description: string;
  keywords: string[]; verified: boolean; href: string;
};

export function ProofLibrary({ documents }: { documents: ProofDocument[] }) {
  const router = useRouter();
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setNotice("Uploading…");
    const form = event.currentTarget;
    const response = await fetch("/api/proof-documents", { method: "POST", body: new FormData(form) });
    const result = await response.json().catch(() => ({})) as { error?: string };
    setPending(false);
    if (!response.ok) { setNotice(result.error ?? "Could not upload the PDF."); return; }
    form.reset();
    setNotice("Proof uploaded. Visez will match it to relevant jobs.");
    router.refresh();
  }

  return <div className="proof-library">
    <div className="proof-list">
      {documents.map((document) => <article key={document.id}>
        <div><strong>{document.name}</strong><p>{document.description || "Approved Atlasium proof document"}</p><small>{document.keywords.slice(0, 6).join(" · ")} · {document.size_bytes ? `${Math.max(1, Math.round(document.size_bytes / 1024))} KB` : "Included with Visez"}</small></div>
        <div><span className={document.verified ? "proof-ready" : "proof-review"}>{document.verified ? "Auto-match ready" : "Review only"}</span><a className="secondary-button" href={document.href}>Download</a></div>
      </article>)}
      {!documents.length && <p>No proof documents have been added yet.</p>}
    </div>
    <form className="settings-form rules-form proof-upload-form" onSubmit={upload}>
      <label>PDF proof document <small>Maximum 10 MB</small><input name="file" type="file" accept="application/pdf,.pdf" required /></label>
      <label>What this proves <small>Short, factual description</small><textarea name="description" rows={3} placeholder="Verified capabilities, case study, delivery approach, or results shown in this PDF" /></label>
      <label>Match to jobs containing <small>Optional; Visez also derives terms from the filename and description.</small><textarea name="keywords" rows={3} placeholder="Google Ads, paid media, lead generation" /></label>
      <label className="proof-approval"><input name="verified" type="checkbox" value="true" defaultChecked /> Approved for relevant Upwork proposals</label>
      <div className="settings-actions"><button className="primary-button" disabled={pending}>{pending ? "Uploading…" : "Add proof PDF"}</button><span role="status">{notice}</span></div>
    </form>
  </div>;
}
