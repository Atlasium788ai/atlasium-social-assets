import { redirect } from "next/navigation";
import { getAuthenticatedAdminSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getAuthenticatedAdminSession();
  if (!session?.user?.email) redirect("/login");
  redirect("/find");
}
