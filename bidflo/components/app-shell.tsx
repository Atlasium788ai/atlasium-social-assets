"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { ReplyNotification } from "@/components/reply-notification";
import { BellIcon, DocumentIcon, LogoMark, SearchIcon } from "@/components/bidflo-icons";

const items = [
  ["/find", "Find", SearchIcon],
  ["/bid", "Bid", DocumentIcon],
  ["/follow-up", "Follow Up", BellIcon],
] as const;

export function AppShell({ children, email, publicAccess = false }: { children: React.ReactNode; email: string; publicAccess?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const openAccess = publicAccess || process.env.NEXT_PUBLIC_BIDFLO_AUTH_DISABLED === "true";
  return (
    <div className="app-shell">
      <header className="workspace-topbar">
        <Link href="/" className="wordmark compact"><LogoMark /><strong>Visez</strong></Link>
        <nav aria-label="Main navigation">
          {items.map(([href, label, Icon]) => (
            <Link key={label} href={href} className={pathname === href ? "active" : ""}>
              <Icon />{label}
            </Link>
          ))}
        </nav>
        <div className="workspace-account"><span className="sync-chip"><i /> Agent live</span>{openAccess ? <span className="public-access-chip">Open access</span> : <button className="profile-button" title={`${email} · Sign out`} onClick={async () => { await authClient.signOut(); router.replace("/login"); router.refresh(); }}>{email.slice(0, 1).toUpperCase()}</button>}</div>
      </header>
      <div className="app-content">{children}</div>
      <ReplyNotification />
    </div>
  );
}
