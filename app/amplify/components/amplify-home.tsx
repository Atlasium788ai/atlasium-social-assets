import Link from "next/link";
import type { AmplifyBrand, AmplifyDraft, AmplifyFeatureFlags } from "../types";

export function AmplifyHome({ brand, drafts, flags, previewMode }: { brand: AmplifyBrand; drafts: AmplifyDraft[]; flags: AmplifyFeatureFlags; previewMode: boolean }) {
  const attention = drafts.filter((draft) => draft.status === "failed" || draft.status === "rejected").length;
  const dryPassed = drafts.filter((draft) => draft.status === "dry_test_passed").length;
  return <section className="amplify-home">
    <header className="amplify-hero">
      <div><p className="eyebrow">AMPLIFY · {brand.name}</p><h1>Run better ads.<br /><span>Without the maze.</span></h1><p>Turn a plain-English idea into a clear, brand-owned advertising draft. Review every decision before anything can go live.</p></div>
      <Link className="primary amplify-primary-link" href="/amplify/create">Create an Ad <span>→</span></Link>
    </header>
    {previewMode && <p className="amplify-safety-banner mock">MOCK PREVIEW — NO LIVE ADS</p>}
    {!flags.liveSubmissionEnabled && <p className="amplify-safety-banner"><strong>Dry-run mode</strong><span>No advertisements will be launched and no money will be spent.</span></p>}
    <div className="amplify-home-grid">
      <article className="amplify-summary-card"><span>AD CONNECTIONS</span><strong>0 active</strong><p>Platform application approvals and advertising permissions are still required.</p><Link href="/amplify/connections">View connections</Link></article>
      <article className="amplify-summary-card"><span>CAMPAIGN DRAFTS</span><strong>{drafts.length}</strong><p>{drafts.length ? `${dryPassed} passed a dry test.` : "Your first brand-scoped draft will appear here."}</p><Link href="/amplify/campaigns">View campaigns</Link></article>
      <article className="amplify-summary-card"><span>REQUIRES ATTENTION</span><strong>{attention}</strong><p>{attention ? "Review failed validation before continuing." : "Nothing requires attention."}</p></article>
      <article className="amplify-summary-card quiet"><span>ACTIVE CAMPAIGNS</span><strong>0</strong><p>Live advertising submission is disabled.</p></article>
    </div>
    <section className="amplify-recent"><div><p className="eyebrow">RECENT RESULTS</p><h2>No live results yet</h2></div><p>Real reporting will appear only after official platform connections and live campaign approval. EchoFlow will not invent performance data.</p></section>
  </section>;
}
