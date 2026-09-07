"use client";

/* eslint-disable @next/next/no-img-element */

import { ProductNavigation } from "@/app/components/product-navigation";
import { AccessSessionAction } from "@/app/components/access-session-action";
import { useFlowWorkspace } from "../state/use-flow-workspace";
import { FlowChannels } from "./flow-channels";
import { FlowOperations } from "./flow-operations";
import { FlowSectionNavigation, type FlowSection } from "./flow-section-navigation";

function FlowIdentity() {
  return <div className="echo-identity">
    <img className="echo-art-compact" src="/echoflow-social.png" alt="EchoFlow Social, powered by Atlasium 7/88 AI" width={1254} height={1254} />
    <span><b>EchoFlow</b><em>Social</em></span>
  </div>;
}

export function FlowWorkspace({ activeSection }: { activeSection: FlowSection }) {
  const flow = useFlowWorkspace();
  return <main className="app-shell flow-shell">
    <header className="app-header"><FlowIdentity /><div className="app-header-actions"><span className="powered">Powered by Atlasium 7/88 AI</span><AccessSessionAction /></div></header>
    <ProductNavigation active="flow" />
    <FlowSectionNavigation active={activeSection} />

    {flow.access === "checking" && <section className="flow-access-card" aria-live="polite"><p>Preparing FLOW workspace…</p></section>}

    {flow.access === "missing" && <section className="flow-access-card">
      <p className="eyebrow">PRIVATE WORKSPACE</p><h1>FLOW</h1><p>Sign in with the company email to continue.</p><a className="access-login-link" href="/signin-with-chatgpt?return_to=%2Fflow" target="_top">Sign in</a>
    </section>}

    {flow.access === "granted" && <>
      <section className="flow-brand-bar" aria-label="Active FLOW brand">
        <span className="flow-brand-mark">{flow.activeBrand?.name.charAt(0).toUpperCase() || "E"}</span>
        <label><span>ACTIVE BRAND</span><select value={flow.activeBrandId} onChange={(event) => flow.selectBrand(event.target.value)} aria-label="Active brand">{flow.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
        <small>{flow.activeBrand?.timezone || "Brand-scoped connections"}</small>
      </section>
      {flow.flowError && <p className="message error" role="status">! {flow.flowError}</p>}
      {flow.data?.refreshError && <p className="message error" role="status">! Buffer history loaded, but delivery refresh needs attention: {flow.data.refreshError}</p>}
      {flow.data && flow.data.reconciliation.checked > 0 && <p className="flow-reconciliation" role="status">Checked {flow.data.reconciliation.checked} Buffer delivery record{flow.data.reconciliation.checked === 1 ? "" : "s"}: {flow.data.reconciliation.sent} sent, {flow.data.reconciliation.pending} pending, {flow.data.reconciliation.failed} failed.</p>}
      {flow.activeBrand && !flow.data && <section className="flow-access-card" aria-live="polite"><p>Loading Buffer operations…</p></section>}
      {flow.activeBrand && flow.data && activeSection === "channels" && <FlowChannels brand={flow.activeBrand} previewMode={flow.previewMode} channels={flow.data.channels} />}
      {flow.activeBrand && flow.data && activeSection !== "channels" && <FlowOperations section={activeSection} brand={flow.activeBrand} jobs={flow.data.jobs} refreshing={flow.refreshing} onRefresh={flow.refresh} />}
    </>}

    <footer>EchoFlow Social · Create and schedule in ECHO · Monitor Buffer delivery in FLOW.</footer>
  </main>;
}
