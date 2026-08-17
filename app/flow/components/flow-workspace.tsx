"use client";

/* eslint-disable @next/next/no-img-element */

import { ProductNavigation } from "@/app/components/product-navigation";
import { useFlowWorkspace } from "../state/use-flow-workspace";
import { FlowChannels } from "./flow-channels";
import { FlowInactiveSection } from "./flow-inactive-section";
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
    <header className="app-header"><FlowIdentity /><span className="powered">Powered by Atlasium 7/88 AI</span></header>
    <ProductNavigation active="flow" />
    <FlowSectionNavigation active={activeSection} />

    {flow.access === "checking" && <section className="flow-access-card" aria-live="polite"><p>Preparing FLOW workspace…</p></section>}

    {flow.access === "missing" && <section className="flow-access-card">
      <p className="eyebrow">PRIVATE WORKSPACE</p><h1>FLOW</h1><p>Open your private authenticated EchoFlow link in this browser to continue.</p>
    </section>}

    {flow.access === "granted" && <>
      <section className="flow-brand-bar" aria-label="Active FLOW brand">
        <span className="flow-brand-mark">{flow.activeBrand?.name.charAt(0).toUpperCase() || "E"}</span>
        <label><span>ACTIVE BRAND</span><select value={flow.activeBrandId} onChange={(event) => flow.selectBrand(event.target.value)} aria-label="Active brand">{flow.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
        <small>{flow.activeBrand?.timezone || "Brand-scoped connections"}</small>
      </section>
      {flow.flowError && <p className="message error" role="status">! {flow.flowError}</p>}
      {flow.activeBrand && activeSection === "channels" && <FlowChannels brand={flow.activeBrand} previewMode={flow.previewMode} />}
      {flow.activeBrand && activeSection !== "channels" && <FlowInactiveSection section={activeSection} />}
    </>}

    <footer>EchoFlow Social · FLOW is isolated from ECHO · No direct publishing is active.</footer>
  </main>;
}
