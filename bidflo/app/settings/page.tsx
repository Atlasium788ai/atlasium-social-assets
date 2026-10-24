import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getAdminSession();
  if (!session?.user?.email) redirect("/login");
  redirect("/find");
}
