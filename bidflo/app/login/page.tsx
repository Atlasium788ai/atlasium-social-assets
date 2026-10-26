"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { LogoMark } from "@/components/visez-icons";
import { withDeadline } from "@/lib/with-deadline";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);


  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await withDeadline(authClient.signIn.email({
        email: String(form.get("email")),
        password: String(form.get("password")),
      }), 30_000, "Sign-in took too long. Please try again.");
      if (result.error) {
        setError(result.error.message ?? "Sign-in failed");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function resetAccess(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault(); setError(""); setNotice("");
    const form = event.currentTarget.closest("form");
    const email = String(new FormData(form ?? undefined).get("email") ?? "");
    if (!email) { setError("Enter your Atlasium email first."); return; }
    setPending(true);
    try {
      const result = await withDeadline(
        authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` }),
        30_000,
        "The password request took too long. Please try again.",
      );
      if (result.error) { setError(result.error.message ?? "Could not send the access link."); return; }
      setNotice("Check your email for a secure password link.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the access link.");
    } finally {
      setPending(false);
    }
  }


  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="visez-login-brand"><LogoMark /><h1>Visez</h1></div>
        <p className="visez-login-powered">POWERED BY ATLASIUM 7/88</p>
        <div className="visez-login-divider" aria-hidden="true" />
        <h2>Your Upwork <span>advantage.</span></h2>
        <p className="visez-login-slogan">Aim. Pitch. Win.</p>
        <p className="visez-login-subtitle">EVERY OPPORTUNITY. EVERY TIME.</p>
        <form onSubmit={submit} className="login-form">
          <label className="visez-login-field"><span>Email address</span><input type="email" name="email" autoComplete="email" placeholder="Email address" required /></label>
          <label className="visez-login-field"><span>Password</span><input type="password" name="password" autoComplete="current-password" placeholder="Password" required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          {notice && <p className="form-success" role="status">{notice}</p>}
          <button className="primary-button" disabled={pending}>{pending ? "Signing in…" : "Sign In"}</button>
          <button className="text-button" type="button" disabled={pending} onClick={resetAccess}>Set or reset password</button>
        </form>
        <p className="login-note">Restricted Atlasium operations workspace</p>
      </section>
    </main>
  );
}
