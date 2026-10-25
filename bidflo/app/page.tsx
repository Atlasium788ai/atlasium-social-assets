import { redirect } from "next/navigation";
import { getAdminSession, isAuthDisabled } from "@/lib/auth/server";
import { getDashboardMetrics } from "@/lib/queries";
import { HomeHub } from "@/components/home-hub";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getAdminSession();
  if (!session?.user?.email) redirect("/login");
  const metrics = await getDashboardMetrics();
  return <HomeHub email={session.user.email} metrics={metrics as never} previewMode={isAuthDisabled()} />;
}
