"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";

const items = [
  ["/", "Overview", "⌁"],
  ["/?view=inbox", "Opportunity inbox", "↳"],
  ["/?view=approval", "Approval queue", "✓"],
  ["/?view=replies", "Client replies", "↗"],
  ["/?view=analytics", "Performance", "◫"],
  ["/settings", "Scoring rules", "⚙"],
];

export function AppShell({ children, email }: { children: React.ReactNode; email: string }) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-icon">B</div>
          <div><strong>BidFlo</strong><span>ATLASIUM 7/88</span></div>
        </div>
        <nav aria-label="Main navigation">
          {items.map(([href, label, icon]) => (
            <Link key={label} href={href} className={pathname === href || (href === "/" && pathname === "/") ? "active" : ""}>
              <span aria-hidden="true">{icon}</span>{label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="live-dot" />
          <div><strong>Automation active</strong><small>5-minute recovery cycle</small></div>
        </div>
        <button className="profile-button" onClick={async () => { await authClient.signOut(); router.replace("/login"); router.refresh(); }}>
          <span>{email.slice(0, 1).toUpperCase()}</span><div>{email}<small>Sign out</small></div>
        </button>
      </aside>
      <div className="mobile-brand"><strong>BidFlo</strong><span>Atlasium 7/88</span></div>
      <div className="app-content">{children}</div>
    </div>
  );
}
