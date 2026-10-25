import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OpportunityBoard } from "@/components/opportunity-board";
import { getAdminSession } from "@/lib/auth/server";
import { listOpportunityCards } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function NurturePage() {
  const session = await getAdminSession();
  if (!session?.user?.email) redirect("/login");
  const opportunities = await listOpportunityCards();
  return <AppShell email={session.user.email}>
    <main className="section-page section-nurture">
      <header className="section-hero"><div>
        <p className="eyebrow">05 · RELATIONSHIPS</p>
        <h1>Keep the connection alive.</h1>
        <p>Genuine conversations, useful updates and future opportunities. An unanswered message does not mean an opt-out.</p>
      </div><span className="section-index">NURTURE</span></header>
      <div className="section-layout visez-pipeline-layout">
        <OpportunityBoard opportunities={opportunities} mode="nurture"/>
        <aside className="rules-panel">
          <div className="rules-heading"><span>05</span><div><h2>Respectful relationship follow-ups</h2><p>Manual, appropriate Upwork messages only.</p></div></div>
          <div className="visez-guidance">
            <p>Use an existing Upwork conversation to share useful updates and check whether the client still needs help.</p>
            <p>Open the opportunity to save a note and set the next reminder. Every message needs human review.</p>
            <p>If the client explicitly requests no further contact, stop nurturing them. No staff-created opt-outs.</p>
          </div>
        </aside>
      </div>
    </main>
  </AppShell>;
}