"use client";

import { useState } from "react";
import type { FlowBrand } from "../services/flow-brand-service";
import type { FlowConnectedAccount } from "../services/flow-connection-service";
import { FLOW_PROVIDER_TILES, FLOW_STATUS_LABELS } from "../providers/provider-catalog";
import { FlowConnectedAccountCard } from "./flow-connected-account-card";

const previewAccounts: readonly FlowConnectedAccount[] = Object.freeze([
  { id: "preview-instagram", brandId: "brand_atlasium_788_ai", providerId: "instagram", accountName: "Atlasium 7/88 AI", handle: "@atlasium788ai", accountType: "Business account", status: "connected" },
]);

export function FlowChannels({ brand, previewMode }: { brand: FlowBrand; previewMode: boolean }) {
  const [accounts, setAccounts] = useState<FlowConnectedAccount[]>(() => previewMode ? [...previewAccounts] : []);
  const [notice, setNotice] = useState("");
  const brandAccounts = accounts.filter((account) => account.brandId === brand.id);

  function reconnect(account: FlowConnectedAccount) {
    if (!previewMode) return;
    setNotice(`${account.accountName} mock authorization completed.`);
  }

  function disconnect(account: FlowConnectedAccount) {
    if (!previewMode) return;
    setAccounts((current) => current.filter((item) => item.id !== account.id || item.brandId !== brand.id));
    setNotice(`${account.accountName} disconnected from ${brand.name}.`);
  }

  return <section className="flow-channels-workspace">
    <header className="flow-section-heading">
      <div><p className="eyebrow">CHANNELS</p><h1>{brandAccounts.length ? "Your channels" : "Connect your channels"}</h1><p>Choose where this brand will publish.</p></div>
      {previewMode && <span className="flow-preview-label">LOCAL MOCK PREVIEW</span>}
    </header>

    {notice && <p className="message ok" role="status">✓ {notice}</p>}

    {brandAccounts.length > 0 && <div className="flow-connected-list" aria-label={`${brand.name} connected channels`}>
      {brandAccounts.map((account) => <FlowConnectedAccountCard key={account.id} account={account} onReconnect={reconnect} onDisconnect={disconnect} />)}
    </div>}

    <div className="flow-platform-grid" aria-label="Social platforms">
      {FLOW_PROVIDER_TILES.map((provider) => {
        const connected = brandAccounts.some((account) => account.providerId === provider.providerId);
        const status = connected ? "connected" : provider.status;
        const enabled = provider.authorizationEnabled && (status === "connect" || status === "reconnect");
        const Icon = provider.Icon;
        const content = <><span className="flow-platform-icon"><Icon aria-hidden="true" /></span><span className="flow-platform-name">{provider.name}</span><span className={`flow-platform-status ${status}`}>{connected && <i>✓</i>}{FLOW_STATUS_LABELS[status]}</span></>;
        return enabled
          ? <button type="button" className="flow-platform-tile enabled" key={provider.providerId} data-feature-flag={provider.featureFlag}>{content}</button>
          : <article className="flow-platform-tile disabled" key={provider.providerId} data-feature-flag={provider.featureFlag}>{content}</article>;
      })}
    </div>

    <aside className="flow-buffer-note"><span className="dot active" /><div><strong>Buffer remains active in ECHO</strong><small>FLOW direct publishing is not enabled.</small></div></aside>
  </section>;
}
