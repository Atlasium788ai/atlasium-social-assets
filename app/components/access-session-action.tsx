"use client";

import { useEffect, useState } from "react";

export function AccessSessionAction() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setAvailable(true));
  }, []);
  if (!available) return null;
  return <div className="access-session-links">
    <a className="access-session-action" href="/EchoFlow-Assistant-Quick-Guide.pdf" target="_blank" rel="noreferrer">Quick guide</a>
    <button type="button" className="access-session-action" onClick={async () => {
      localStorage.removeItem("echoflow-access-key");
      localStorage.removeItem("atlasium-upload-key");
      localStorage.removeItem("echoflow-active-brand");
      for (const key of Object.keys(localStorage)) if (key.startsWith("echoflow-active-campaign:")) localStorage.removeItem(key);
      // Clear the host-only Atlasium session before leaving the existing platform session.
      try { await fetch("/auth/atlasium/logout", { method: "POST", cache: "no-store" }); } catch { /* The existing signout still works if the optional bridge is disabled. */ }
      window.location.assign("/signout-with-chatgpt?return_to=%2Fecho");
    }}>Sign out</button>
  </div>;
}
