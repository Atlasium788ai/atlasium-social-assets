"use client";

import { useState } from "react";
import { getFlowProvider } from "../providers/provider-catalog";
import type { FlowConnectedAccount } from "../services/flow-connection-service";

export function FlowConnectedAccountCard({ account, onReconnect, onDisconnect }: { account: FlowConnectedAccount; onReconnect: (account: FlowConnectedAccount) => void; onDisconnect: (account: FlowConnectedAccount) => void }) {
  const [confirming, setConfirming] = useState(false);
  const provider = getFlowProvider(account.providerId);
  if (!provider) return null;
  const Icon = provider.Icon;
  return <article className="flow-connected-card">
    <div className="flow-connected-mark"><Icon aria-hidden="true" /></div>
    <div className="flow-connected-copy"><span>{provider.name}</span><h3>{account.accountName}</h3>{account.handle && <p>{account.handle}</p>}<small>{account.accountType}</small></div>
    <div className="flow-connected-status"><span>✓</span>Connected</div>
    <div className="flow-connected-actions"><button type="button" onClick={() => onReconnect(account)}>Reconnect</button><button type="button" onClick={() => setConfirming(true)}>Disconnect</button></div>
    {confirming && <div className="flow-confirm" role="alertdialog" aria-label={`Disconnect ${account.accountName}`}>
      <p>Disconnect {account.accountName}?</p>
      <div><button type="button" onClick={() => setConfirming(false)}>Cancel</button><button type="button" className="danger-action" onClick={() => { setConfirming(false); onDisconnect(account); }}>Disconnect</button></div>
    </div>}
  </article>;
}
