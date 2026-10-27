"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { ReplyNotification } from "@/components/reply-notification";
import { BellIcon, BriefcaseIcon, DocumentIcon, LogoMark, SearchIcon, SlidersIcon } from "@/components/visez-icons";

const items = [
  ["/find", "Opportunities", SearchIcon],
  ["/bid", "Proposals", DocumentIcon],
  ["/approvals", "Approvals", BriefcaseIcon],
  ["/follow-up", "Follow-ups", BellIcon],
  ["/settings", "Settings", SlidersIcon],
] as const;

export function AppShell({ children, email, publicAccess = false }: { children: React.ReactNode; email: string; publicAccess?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const openAccess = publicAccess;
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
        <div className="workspace-account"><span className="sync-chip"><i /> Agent live</span>{openAccess ? <Link href="/login" className="public-access-chip" title="Sign in to manage proposals">View only · Sign in</Link> : <button className="profile-button" title={`${email} · Sign out`} onClick={async () => { await authClient.signOut(); router.replace("/login"); router.refresh(); }}>{email.slice(0, 1).toUpperCase()}</button>}</div>
      </header>
      <div className="app-content">{children}</div>
      {!openAccess && <ReplyNotification />}
    </div>
  );
}
