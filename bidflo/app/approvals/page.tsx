import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OpportunityBoard } from "@/components/opportunity-board";
import { getAdminSession } from "@/lib/auth/server";
import { listOpportunityCards } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const session = await getAdminSession();
  if (!session?.user?.email) redirect("/login");
  const opportunities = await listOpportunityCards();
  return <AppShell email={session.user.email} publicAccess={session.user.name === "Visez Preview"}>
    <main className="section-page section-bid">
      <header className="section-hero"><div><p className="eyebrow">REVIEW · DECIDE · CONTROL</p><h1>Approval queue.</h1><p>Review quality checks, edit the proposal, and approve only the opportunities Atlasium should pursue.</p></div><span className="section-index">APPROVALS</span></header>
      <OpportunityBoard opportunities={opportunities} mode="approval" />
    </main>
  </AppShell>;
}
