import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OpportunityBoard } from "@/components/opportunity-board";
import { getAdminSession } from "@/lib/auth/server";
import { listOpportunityCards } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function WonPage() {
  const session = await getAdminSession();
  if (!session?.user?.email) redirect("/login");
  const opportunities = await listOpportunityCards();
  return <AppShell email={session.user.email} publicAccess={session.user.name === "Visez Preview"}>
    <main className="section-page section-won">
      <header className="section-hero"><div>
        <p className="eyebrow">04 · CLIENT WINS</p>
        <h1>Celebrate the wins.</h1>
        <p>Projects and relationships successfully converted into clients.</p>
      </div><span className="section-index">WON</span></header>
      <OpportunityBoard opportunities={opportunities} mode="won"/>
    </main>
  </AppShell>;
}