"use client";

import { useEffect, useState } from "react";

type Brand = { id: string; name: string; status: string; timezone: string };
type CustomerWorkspace = {
  workspace: { id: string; name: string; role: string };
  brands: Brand[];
  channels: [];
  publishingEnabled: false;
  note: string;
  access: { subscribed: boolean; creditsRemaining: number; canPublish: boolean };
};
export default function AtlasiumCustomerWorkspace() {
  const [data, setData] = useState<CustomerWorkspace | null>(null);
  const [message, setMessage] = useState("");
  const [brandName, setBrandName] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    const response = await fetch("/api/atlasium/customer/workspace", { cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 401 ? "Please sign in from Atlasium Core." : "Could not load your workspace.");
    setData(await response.json() as CustomerWorkspace);
  }
  useEffect(() => {
    // A customer session must never reuse a previously saved, globally privileged
    // owner publishing key from this browser, including on a shared device.
    localStorage.removeItem("echoflow-access-key");
    localStorage.removeItem("atlasium-upload-key");
    void load().catch((err: Error) => setMessage(err.message));
  }, []);

  async function addBrand(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating || !brandName.trim()) return;
    setCreating(true);
    setMessage("");
    try {
      const response = await fetch("/api/atlasium/customer/brands", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: brandName.trim() }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not save this brand.");
      setBrandName("");
      await load();
      setMessage("Draft brand created. Nothing was published.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save this brand."); }
    finally { setCreating(false); }
  }

  return <main style={{ minHeight: "100vh", background: "#061426", color: "#f2f7ff", fontFamily: "system-ui, sans-serif", padding: "clamp(18px, 5vw, 48px)" }}>
    <div style={{ maxWidth: 900, margin: "auto" }}>
      <header style={{ display: "flex", gap: 20, justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div><p style={{ color: "#85bcfa", fontSize: 12, letterSpacing: 2 }}>ATLASIUM 7/88 / ECHOFLOW</p>
          <h1>Your social workspace</h1>
          <p style={{ color: "#b1c4d9" }}>Your brand, your workspace. One Atlasium login.</p></div>
        <a href="/auth/atlasium/logout" style={{ color: "#b8dafa" }}>Sign out</a>
      </header>
      {message && <p role="status" style={{ color: "#b8dafa" }}>{message}</p>}
      {!data && !message && <p role="status">Loading your isolated workspace…</p>}
      {data && <>
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 30 }}>
          <div style={{ padding: 18, border: "1px solid #315578", borderRadius: 12 }}><small>EchoFlow plan</small><h2>{data.access.subscribed ? "Active" : "Not active"}</h2></div>
          <div style={{ padding: 18, border: "1px solid #315578", borderRadius: 12 }}><small>Social credits</small><h2>{data.access.creditsRemaining}</h2></div>
          <div style={{ padding: 18, border: "1px solid #315578", borderRadius: 12 }}><small>Publishing</small><h2>Not enabled yet</h2></div>
        </section>
        <section style={{ marginTop: 30, padding: 22, border: "1px solid #315578", borderRadius: 14 }}>
          <h2 style={{ fontSize: 20 }}>Your brands</h2>
          {data.brands.length === 0
            ? <p style={{ color: "#b1c4d9" }}>No brands yet. Add your first brand below.</p>
            : <ul>{data.brands.map((brand) => <li key={brand.id} style={{ padding: "7px 0" }}>{brand.name} · Draft setup</li>)}</ul>}
          <form onSubmit={addBrand} style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 20 }}>
            <label style={{ flex: 1, minWidth: 180 }}>Brand name
              <input value={brandName} onChange={(event) => setBrandName(event.target.value)} minLength={2} maxLength={120} required placeholder="Your business name" style={{ display: "block", marginTop: 6, width: "100%", boxSizing: "border-box", borderRadius: 8, border: "1px solid #526e90", padding: 12, color: "#fff", background: "#0b223c" }} />
            </label>
            <button disabled={creating || data.brands.length >= 3} type="submit" style={{ alignSelf: "end", background: "#1678b4", borderRadius: 8, border: 0, padding: 13, color: "white", cursor: "pointer" }}>{creating ? "Saving…" : "Add draft brand"}</button>
          </form>
          <p style={{ fontSize: 12, color: "#91a9c3" }}>Brand setup does not publish posts or consume credits. Customer social-channel connections and paid publishing are being securely integrated.</p>
        </section>
        <p style={{ marginTop: 22, fontSize: 13, color: "#a5b9cf" }}>{data.note}</p>
      </>}
    </div>
  </main>;
}
