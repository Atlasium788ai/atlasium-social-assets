"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { PasswordField } from "@/components/password-field";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setPending(true);
    const form = new FormData(event.currentTarget); const password = String(form.get("password"));
    if (password.length < 10) { setPending(false); setError("Use at least 10 characters."); return; }
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    const result = await authClient.resetPassword({ newPassword: password, token });
    setPending(false);
    if (result.error) { setError(result.error.message ?? "This link is invalid or expired."); return; }
    router.replace("/login?reset=complete");
  }
  return <main className="login-shell"><section className="login-panel"><div className="brand-mark">V</div><p className="eyebrow">SECURE ACCESS</p><h1>Set your password</h1><p className="login-subtitle">Create a private password for the Visez workspace.</p><form onSubmit={submit} className="login-form"><PasswordField label="New password" name="password" minLength={10} autoComplete="new-password" placeholder="New password" required />{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={pending}>{pending ? "Securing account…" : "Set password"}</button></form></section></main>;
}
