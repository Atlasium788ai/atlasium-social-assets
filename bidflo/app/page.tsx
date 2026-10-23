import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/server";
import { getDashboardMetrics, listOpportunityCards } from "@/lib/queries";
import { AppShell } from "@/components/app-shell";
import { Dashboard } from "@/components/dashboard";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await getAdminSession();
  if (!session?.user?.email) redirect("/login");
  const [opportunities, metrics, params] = await Promise.all([listOpportunityCards(), getDashboardMetrics(), searchParams]);
  return <AppShell email={session.user.email}><Dashboard opportunities={opportunities} metrics={metrics as never} view={params.view} /></AppShell>;
}
