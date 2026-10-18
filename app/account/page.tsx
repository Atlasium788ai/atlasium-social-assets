"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { ProductNavigation } from "../components/product-navigation";
import { AccessSessionAction } from "../components/access-session-action";

type Account = {
  user: { id: string; email: string | null; displayName: string };
  workspace: { id: string; name: string; role: "owner" | "admin" | "editor" | "viewer" };
  members: Array<{ id: string; email: string | null; displayName: string; role: string }>;
  permissions: { manageWorkspace: boolean; createContent: boolean; scheduleContent: boolean; manageConnections: boolean };
  productAccess: string[];
};

export default function AccountPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unauthorized" | "error">("loading");

  useEffect(() => {
    fetch("/api/account", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        const data = await response.json() as Account & { error?: string };
        if (response.status === 401) { setStatus("unauthorized"); return; }
        if (!response.ok) throw new Error(data.error || "Could not load the account.");
        setAccount(data);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  return <main className="account-shell">
    <header className="account-topbar">
      <a className="brand-mark" href="/echo" aria-label="EchoFlow home"><img src="/echoflow-social-blue.png" alt="" /><span>EchoFlow Social</span></a>
      <AccessSessionAction />
    </header>
    <ProductNavigation active="echo" />

    {status === "loading" && <section className="account-state"><p>Preparing your account…</p></section>}
    {status === "unauthorized" && <section className="account-state"><p className="eyebrow">COMPANY LOGIN</p><h1>Sign in to EchoFlow.</h1><p>Use an approved company email to open the workspace.</p><a className="primary account-login" href="/signin-with-chatgpt?return_to=%2Faccount" target="_top">Sign in</a></section>}
    {status === "error" && <section className="account-state"><h1>Account temporarily unavailable.</h1><p>Refresh the page or return to ECHO.</p><a href="/echo">Return to ECHO</a></section>}

    {status === "ready" && account && <div className="account-workspace">
      <section className="account-hero">
        <p className="eyebrow">ACCOUNT &amp; WORKSPACE</p>
        <h1>{account.workspace.name}</h1>
        <p>Signed in as <b>{account.user.displayName}</b>{account.user.email ? <> · {account.user.email}</> : null}</p>
        <span className={`account-role ${account.workspace.role}`}>{account.workspace.role}</span>
      </section>

      <section className="account-grid">
        <article className="card account-card"><p className="eyebrow">YOUR ACCESS</p><h2>What you can use</h2><ul>{account.productAccess.map((product) => <li key={product}><b>{product}</b><span>{product === "ECHO" ? "Create social, blog and newsletter content" : product === "FLOW" ? "Schedule, publish and monitor content" : "Prepare and test advertising drafts"}</span></li>)}</ul></article>
        <article className="card account-card"><p className="eyebrow">PERMISSIONS</p><h2>Your role</h2><ul className="permission-list"><li><b>{account.permissions.createContent ? "✓" : "—"}</b><span>Create and edit content</span></li><li><b>{account.permissions.scheduleContent ? "✓" : "—"}</b><span>Schedule and publish</span></li><li><b>{account.permissions.manageConnections ? "✓" : "—"}</b><span>Manage social connections</span></li><li><b>{account.permissions.manageWorkspace ? "✓" : "—"}</b><span>Manage the workspace</span></li></ul></article>
      </section>

      <section className="card account-team"><header><div><p className="eyebrow">TEAM</p><h2>Workspace members</h2></div><span>{account.members.length} active</span></header><div>{account.members.map((member) => <article key={member.id}><span className="account-avatar">{member.displayName.slice(0, 1).toUpperCase()}</span><div><b>{member.displayName}</b><small>{member.email || "Company account"}</small></div><i>{member.role}</i></article>)}</div></section>

      <section className="account-next card"><div><p className="eyebrow">CONNECTION STATUS</p><h2>Account foundation is ready.</h2><p>Meta, Instagram, LinkedIn and TikTok authorization can be completed when the platform administrators are available. Content creation and workspace access can continue now.</p></div><a href="/flow/channels">Open channel setup →</a></section>
    </div>}
  </main>;
}
