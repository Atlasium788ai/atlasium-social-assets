"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";

export default function LoginPage() {
  const router = useRouter();
  const openAccess = process.env.NEXT_PUBLIC_BIDFLO_AUTH_DISABLED === "true";
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => { if (openAccess) router.replace("/"); }, [openAccess, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Sign-in failed");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  async function resetAccess(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault(); setError(""); setNotice("");
    const form = event.currentTarget.closest("form");
    const email = String(new FormData(form ?? undefined).get("email") ?? "");
    if (!email) { setError("Enter your Atlasium email first."); return; }
    setPending(true);
    const result = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` });
    setPending(false);
    if (result.error) { setError(result.error.message ?? "Could not send the access link."); return; }
    setNotice("Check your email for a secure password link.");
  }

  if (openAccess) return <main className="login-shell"><p className="login-subtitle">Opening Visez…</p></main>;

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="brand-mark" aria-hidden="true"><span>7</span><i>/</i><span>88</span></div>
        <p className="eyebrow">ATLASIUM 7/88</p>
        <h1>Visez</h1>
        <p className="login-subtitle">AI Opportunity &amp; Proposal Automation</p>
        <form onSubmit={submit} className="login-form">
          <label>Email<input type="email" name="email" autoComplete="email" required /></label>
          <label>Password<input type="password" name="password" autoComplete="current-password" required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          {notice && <p className="form-success" role="status">{notice}</p>}
          <button className="primary-button" disabled={pending}>{pending ? "Signing in…" : "Enter workspace"}</button>
          <button className="text-button" type="button" disabled={pending} onClick={resetAccess}>Set or reset password</button>
        </form>
        <p className="login-note">Restricted Atlasium operations workspace</p>
      </section>
    </main>
  );
}
