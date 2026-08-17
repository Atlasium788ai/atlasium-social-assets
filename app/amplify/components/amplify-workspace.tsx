"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { ProductNavigation } from "@/app/components/product-navigation";
import { useAmplifyWorkspace } from "../state/use-amplify-workspace";
import { AmplifyCampaigns } from "./amplify-campaigns";
import { AmplifyConnections } from "./amplify-connections";
import { AmplifyCreate } from "./amplify-create";
import { AmplifyHome } from "./amplify-home";
import { AmplifyResults } from "./amplify-results";
import { AmplifySectionNavigation, type AmplifySection } from "./amplify-section-navigation";

function AmplifyIdentity() {
  return <Link className="echo-identity" href="/amplify" aria-label="EchoFlow Social AMPLIFY home">
    <img className="echo-art-compact" src="/echoflow-social.png" alt="EchoFlow Social, powered by Atlasium 7/88 AI" width={1254} height={1254} />
    <span><b>EchoFlow</b><em>Social</em></span>
  </Link>;
}

export function AmplifyWorkspace({ activeSection }: { activeSection: AmplifySection }) {
  const amplify = useAmplifyWorkspace();
  const workspace = amplify.workspace;
  return <main className="app-shell amplify-shell">
    <header className="app-header"><AmplifyIdentity /><span className="powered">Powered by Atlasium 7/88 AI</span></header>
    <ProductNavigation active="amplify" />
    <AmplifySectionNavigation active={activeSection} />

    {amplify.access === "checking" && <section className="amplify-access" aria-live="polite"><span className="spinner" /><p>Preparing AMPLIFY…</p></section>}
    {amplify.access === "missing" && <section className="amplify-empty"><p className="eyebrow">PRIVATE WORKSPACE</p><h1>AMPLIFY</h1><p>Open your private authenticated EchoFlow link in this browser to continue.</p><p>ECHO and Buffer remain available through the same private authorization.</p></section>}

    {amplify.access === "granted" && workspace && <>
      <section className="amplify-brand-bar" aria-label="Active AMPLIFY brand">
        <span className="amplify-brand-mark">{workspace.activeBrand.logoUrl ? <img src={workspace.activeBrand.logoUrl} alt="" /> : workspace.activeBrand.name.charAt(0).toUpperCase()}</span>
        <label><span>ACTIVE BRAND</span><select value={amplify.activeBrandId} onChange={(event) => amplify.selectBrand(event.target.value)} aria-label="Active brand" disabled={amplify.loadingBrand}>{workspace.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
        <small>{workspace.activeBrand.timezone}</small>
        <Link href="/echo?new-brand=1" className="amplify-new-brand">+ New Brand</Link>
      </section>
      {amplify.loadingBrand && <p className="amplify-brand-loading" role="status">Switching brand and clearing previous brand data…</p>}
      {amplify.error && <p className="message error" role="alert">! {amplify.error}</p>}
      {!amplify.loadingBrand && activeSection === "home" && <AmplifyHome brand={workspace.activeBrand} drafts={workspace.drafts} flags={workspace.featureFlags} previewMode={amplify.previewMode} />}
      {!amplify.loadingBrand && activeSection === "create" && <AmplifyCreate key={workspace.activeBrand.id} brand={workspace.activeBrand} sources={workspace.creativeSources} drafts={workspace.drafts} privateKey={amplify.accessKey} previewMode={amplify.previewMode} dryRunEnabled={workspace.featureFlags.dryRunEnabled} onDraft={amplify.mergeDraft} onCreative={amplify.addCreative} />}
      {!amplify.loadingBrand && activeSection === "campaigns" && <AmplifyCampaigns brand={workspace.activeBrand} drafts={workspace.drafts} />}
      {!amplify.loadingBrand && activeSection === "results" && <AmplifyResults brand={workspace.activeBrand} previewMode={amplify.previewMode} />}
      {!amplify.loadingBrand && activeSection === "connections" && <AmplifyConnections brand={workspace.activeBrand} previewMode={amplify.previewMode} />}
    </>}
    <footer className="amplify-footer">EchoFlow Social · AMPLIFY is isolated from ECHO and FLOW · Live advertising is disabled.</footer>
  </main>;
}
