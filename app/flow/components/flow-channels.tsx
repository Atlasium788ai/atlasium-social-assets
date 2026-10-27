"use client";

import { useState } from "react";
import type { FlowBrand, FlowChannel, FlowAvailableAccount } from "../services/flow-brand-service";
import { saveFlowAccountAssignments } from "../services/flow-brand-service";
import type { FlowConnectedAccount } from "../services/flow-connection-service";
import { FLOW_PROVIDER_TILES, FLOW_STATUS_LABELS } from "../providers/provider-catalog";
import { FlowConnectedAccountCard } from "./flow-connected-account-card";

type ConnectionStatus = "connected" | "not_configured" | "unavailable";

export function FlowChannels({
  brand, previewMode, channels, availableAccounts = [], publishingConnectionStatus = "not_configured", accessKey, onSaved,
}: {
  brand: FlowBrand;
  previewMode: boolean;
  channels: FlowChannel[];
  availableAccounts?: FlowAvailableAccount[];
  publishingConnectionStatus?: ConnectionStatus;
  accessKey: string;
  onSaved: () => Promise<void>;
}) {
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string[]>(() => channels.filter((account) =>
    availableAccounts.some((available) => available.id === account.providerChannelId)).map((account) => account.providerChannelId));
  const brandAccounts = channels.filter((account) => account.brandId === brand.id) as FlowConnectedAccount[];
  const canAssign = previewMode || publishingConnectionStatus === "connected";
  const linkedElsewhere = (account: FlowAvailableAccount) => Boolean(account.assignedBrandId && account.assignedBrandId !== brand.id);
  const missingConnections = brandAccounts.filter((account) => account.status !== "connected");
  const hasChanges = [...selected].sort().join("|") !== channels.map((channel) => channel.providerChannelId).sort().join("|");

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setNotice("");
    setError("");
  }

  async function save() {
    if (saving || !canAssign || !hasChanges) return;
    if (previewMode) { setNotice("Local preview only. No accounts were changed."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      await saveFlowAccountAssignments(accessKey, brand.id, selected);
      await onSaved();
      setNotice("Account assignments saved to this brand. No posts were sent.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update account assignments.");
    } finally { setSaving(false); }
  }

  return <section className="flow-channels-workspace">
    <header className="flow-section-heading">
      <div><p className="eyebrow">CHANNELS</p><h1>Social accounts for {brand.name}</h1><p>Connect accounts, then assign each one to the correct brand. No cross-brand publishing.</p></div>
      {previewMode && <span className="flow-preview-label">LOCAL MOCK PREVIEW</span>}
    </header>

    {notice && <p className="message ok" role="status">{notice}</p>}
    {error && <p className="message error" role="alert">{error}</p>}

    {brandAccounts.length > 0 && <div className="flow-connected-list" aria-label={`${brand.name} connected channels`}>
      {brandAccounts.map((account) => <FlowConnectedAccountCard key={account.id} account={account}
        onReconnect={() => setNotice("Reconnect through the social account provider, then refresh FLOW.")}
        onDisconnect={() => setNotice("Unselect this account below and save assignments to unlink it from this brand.")}
        managedExternally />)}
    </div>}

    <section className="card" aria-label="Assign connected accounts">
      <h2>Assign accounts to this brand</h2>
      <p className="wizard-help">First authorize each social account with the current publishing provider. Accounts already authorized there appear below. Your brand can exist before any accounts are connected.</p>
      <p className="wizard-help">Current connection: {publishingConnectionStatus === "connected" ? "Ready to load accounts" : publishingConnectionStatus === "unavailable" ? "Temporarily unavailable; saved assignments are protected" : "Not configured on this deployment"}.</p>
      <p><a className="access-login-link" href="https://publish.buffer.com/" target="_blank" rel="noreferrer">Connect a social account</a></p>
      <div className="assignment-list" aria-label="Available social account assignments">
        {availableAccounts.map((account) => {
          const unavailable = linkedElsewhere(account);
          const checked = selected.includes(account.id);
          return <label key={account.id} className={unavailable ? "unavailable" : ""}>
            <input type="checkbox" checked={checked} disabled={unavailable || !canAssign || saving}
              onChange={() => toggle(account.id)} />
            <span className="channel-icon">{account.service.slice(0, 1).toUpperCase()}</span>
            <span><b>{account.displayName || account.name || account.id}</b><small>{account.service}{unavailable ? ` · assigned to ${account.assignedBrandName || "another brand"}` : ""}</small></span>
          </label>;
        })}
        {!availableAccounts.length && <p className="empty">No accounts available yet. Connect an account above, then refresh this page to assign it to {brand.name}.</p>}
      </div>
      {missingConnections.length > 0 && <p className="message error" role="status">{missingConnections.length} previously assigned account(s) no longer appear as connected. Saving a new selection will unassign those offline accounts. Current assignments remain untouched until you save.</p>}
      <button className="primary" type="button" disabled={!canAssign || !hasChanges || saving} onClick={save}>{saving ? "Saving account assignments…" : "Save brand account assignments"}</button>
      <p className="wizard-help">Saving changes account assignments only. It does not schedule or publish anything.</p>
    </section>

    <div className="flow-platform-grid" aria-label="Social platforms">
      {FLOW_PROVIDER_TILES.map((provider) => {
        const connected = brandAccounts.some((account) => account.providerId === provider.providerId && account.status === "connected");
        const status = connected ? "connected" : provider.status;
        const Icon = provider.Icon;
        return <article className="flow-platform-tile disabled" key={provider.providerId} data-feature-flag={provider.featureFlag}>
          <span className="flow-platform-icon"><Icon aria-hidden="true" /></span>
          <span className="flow-platform-name">{provider.name}</span>
          <span className={`flow-platform-status ${status}`}>{connected && <i>✓</i>}{FLOW_STATUS_LABELS[status]}</span>
        </article>;
      })}
    </div>
    <aside className="flow-buffer-note"><span className="dot" /><div><strong>Direct platform sign-in is not yet activated</strong><small>The social networks shown as approval pending cannot connect directly until their provider app authorization is configured. The current provider is Buffer.</small></div></aside>
  </section>;
}
