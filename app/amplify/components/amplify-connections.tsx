"use client";

import { useState } from "react";
import { AMPLIFY_CONNECTION_LABELS, AMPLIFY_PROVIDER_CAPABILITIES, type AmplifyProviderCapability } from "../providers/amplify-provider-catalog";
import type { AmplifyBrand, AmplifyConnectionStatus } from "../types";

function displayedStatus(provider: AmplifyProviderCapability, previewMode: boolean): AmplifyConnectionStatus {
  return previewMode && provider.providerId === "meta" ? "mock_connection" : provider.connectionStatus;
}

export function AmplifyConnections({ brand, previewMode }: { brand: AmplifyBrand; previewMode: boolean }) {
  const [selected, setSelected] = useState<AmplifyProviderCapability | null>(null);
  return <section className="amplify-page">
    <header className="amplify-page-heading"><div><p className="eyebrow">CONNECTIONS · {brand.name}</p><h1>Advertising connections</h1><p>Organic publishing permissions do not automatically grant advertising access.</p></div>{previewMode && <span className="amplify-preview-label">MOCK PREVIEW — NO LIVE ADS</span>}</header>
    <div className="amplify-connection-grid" aria-label="Advertising providers">
      {AMPLIFY_PROVIDER_CAPABILITIES.map((provider) => {
        const status = displayedStatus(provider, previewMode);
        const Icon = provider.Icon;
        return <button type="button" key={provider.providerId} className={`amplify-provider-card ${status}`} onClick={() => setSelected(provider)} aria-describedby={`${provider.providerId}-reason`}>
          <span className="amplify-provider-icon"><Icon aria-hidden="true" /></span>
          <span className="amplify-provider-copy"><strong>{provider.displayName}</strong><small>{provider.surfaces.join(" · ")}</small></span>
          <span className="amplify-connection-status">{AMPLIFY_CONNECTION_LABELS[status]}</span>
          <span id={`${provider.providerId}-reason`} className="sr-only">{status === "mock_connection" ? "Development-only mock connection. No platform account is connected." : provider.unavailableReason}</span>
        </button>;
      })}
    </div>
    <aside className="amplify-organic-note"><span>ORGANIC ≠ ADS</span><div><strong>Enable Ads will appear only after official approval</strong><p>ECHO and Buffer remain active for organic publishing. AMPLIFY has separate advertising permissions and never treats an organic connection as an ad account.</p></div></aside>
    {selected && <div className="amplify-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}>
      <section className="amplify-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-dialog-title">
        <button className="amplify-dialog-close" type="button" onClick={() => setSelected(null)} aria-label="Close connection details">×</button>
        <span className="amplify-provider-icon"><selected.Icon aria-hidden="true" /></span>
        <p className="eyebrow">{AMPLIFY_CONNECTION_LABELS[displayedStatus(selected, previewMode)]}</p>
        <h2 id="provider-dialog-title">{selected.displayName}</h2>
        {displayedStatus(selected, previewMode) === "mock_connection" ? <p><strong>MOCK CONNECTION</strong><br />This development preview represents the future connection layout only. No advertising account, token or platform permission exists.</p> : <p>{selected.unavailableReason}</p>}
        <details><summary>Future connection steps</summary><ol><li>Authorize through the official platform.</li><li>Select the business and advertising account.</li><li>Select the page or identity.</li><li>Select tracking when applicable.</li><li>Confirm this brand-only connection.</li></ol></details>
        <details><summary>Supported architecture</summary><p>{selected.supportedCreativeFormats.length ? selected.supportedCreativeFormats.join(" · ") : "Advertising is not available."}</p></details>
        <button type="button" className="secondary" disabled>{selected.advertisingAvailable ? "Enable Ads unavailable" : "Not Available"}</button>
      </section>
    </div>}
  </section>;
}
