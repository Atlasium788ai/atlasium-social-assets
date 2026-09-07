"use client";

import { useEffect, useState } from "react";

export function AccessSessionAction() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setAvailable(Boolean(localStorage.getItem("echoflow-access-key") || localStorage.getItem("atlasium-upload-key"))));
  }, []);
  if (!available) return null;
  return <button type="button" className="access-session-action" onClick={() => {
    localStorage.removeItem("echoflow-access-key");
    localStorage.removeItem("atlasium-upload-key");
    localStorage.removeItem("echoflow-active-brand");
    for (const key of Object.keys(localStorage)) if (key.startsWith("echoflow-active-campaign:")) localStorage.removeItem(key);
    window.location.assign("/echo");
  }}>Clear access on this device</button>;
}
