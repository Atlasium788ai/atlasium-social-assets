import Link from "next/link";
import { amplifyProvider } from "../providers/amplify-provider-catalog";
import type { AmplifyBrand, AmplifyDraft } from "../types";

const statusLabels: Record<string, string> = {
  draft: "Draft", ready_for_review: "Ready for Review", dry_test_passed: "Dry Test Passed", submission_pending: "Submission Pending", submitted_to_platform: "Submitted to Platform", under_platform_review: "Under Platform Review", approved: "Approved", scheduled: "Scheduled", active: "Active", paused: "Paused", rejected: "Rejected", completed: "Completed", failed: "Failed", validation_failed: "Validation Failed",
};

export function AmplifyCampaigns({ brand, drafts }: { brand: AmplifyBrand; drafts: AmplifyDraft[] }) {
  return <section className="amplify-page">
    <header className="amplify-page-heading"><div><p className="eyebrow">CAMPAIGNS · {brand.name}</p><h1>Campaigns</h1><p>Brand-owned drafts and dry-test status. No live advertisements are active.</p></div><Link className="primary amplify-primary-link" href="/amplify/create">Create an Ad</Link></header>
    {!drafts.length ? <div className="amplify-empty"><span>NO CAMPAIGNS</span><h2>Start with one clear idea</h2><p>Your advertising drafts will stay isolated to {brand.name}.</p><Link className="secondary" href="/amplify/create">Create your first draft</Link></div> : <div className="amplify-campaign-list">
      {drafts.map((draft) => <article key={draft.id} className="amplify-campaign-card">
        <div className="amplify-campaign-main"><span className={`amplify-status ${draft.status}`}>{statusLabels[draft.status] || draft.status}</span><h2>{draft.name}</h2><p>{draft.payload.goal.replaceAll("_", " ")} · {draft.payload.budget.currency} {draft.payload.budget.maximumSpend.toFixed(2)} maximum</p><small>{draft.payload.schedule.startAt} to {draft.payload.schedule.endAt} · {draft.payload.schedule.timezone}</small></div>
        <div className="amplify-platform-statuses">{draft.platformStatuses.map((platform) => <span key={platform.providerId}><b>{amplifyProvider(platform.providerId)?.displayName || platform.providerId}</b><small>{statusLabels[platform.status] || platform.status}</small></span>)}</div>
        <div className="amplify-card-actions"><Link href={`/amplify/create?draft=${encodeURIComponent(draft.id)}`}>Edit Draft</Link><button type="button" disabled title="Live campaign controls are not active">Duplicate Draft</button><button type="button" disabled>Pause</button><Link href="/amplify/results">View Results</Link></div>
      </article>)}
    </div>}
  </section>;
}
