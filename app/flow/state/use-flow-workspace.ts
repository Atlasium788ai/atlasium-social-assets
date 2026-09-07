"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readActiveBrandId, rememberActiveBrandId } from "@/app/components/brand-preference";
import { loadFlowBrands, loadFlowWorkspace, type FlowBrand, type FlowWorkspaceData } from "../services/flow-brand-service";

type AccessState = "checking" | "granted" | "missing";

const previewBrands: readonly FlowBrand[] = Object.freeze([
  { id: "brand_atlasium_788_ai", name: "Atlasium 7/88 AI", timezone: "America/Toronto" },
  { id: "brand_preview_northstar", name: "Northstar Coffee", timezone: "America/Toronto" },
]);

function previewWorkspace(brand: FlowBrand): FlowWorkspaceData {
  const now = Date.now();
  return {
    brand,
    channels: [{ id: "preview-instagram", brandId: brand.id, providerId: "instagram", providerChannelId: "preview", accountName: brand.name, accountType: "Buffer-managed channel", status: "connected" }],
    jobs: [
      { id: "preview-upcoming", campaignId: "preview", postId: "preview-post", destinationId: "preview#instagram:feed", scheduledTime: new Date(now + 86_400_000).toISOString(), provider: "buffer", providerPostId: "preview-buffer", status: "confirmed", error: "", concept: "Upcoming brand story", service: "instagram", accountName: brand.name, providerStatus: "scheduled", publicUrl: "", deliveryError: "", checkedAt: new Date(now).toISOString(), createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() },
      { id: "preview-sent", campaignId: "preview", postId: "preview-post-2", destinationId: "preview#instagram:story", scheduledTime: new Date(now - 86_400_000).toISOString(), provider: "buffer", providerPostId: "preview-buffer-2", status: "sent", error: "", concept: "Published brand update", service: "instagram", accountName: brand.name, providerStatus: "sent", publicUrl: "https://example.invalid/post", deliveryError: "", checkedAt: new Date(now).toISOString(), createdAt: new Date(now - 86_400_000).toISOString(), updatedAt: new Date(now).toISOString() },
    ],
    reconciliation: { checked: 2, sent: 1, failed: 0, pending: 1 },
  };
}

export function useFlowWorkspace() {
  const [access, setAccess] = useState<AccessState>("checking");
  const [accessKey, setAccessKey] = useState("");
  const [brands, setBrands] = useState<FlowBrand[]>([]);
  const [activeBrandId, setActiveBrandId] = useState("");
  const [data, setData] = useState<FlowWorkspaceData | null>(null);
  const [flowError, setFlowError] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const requestSequence = useRef(0);

  const refresh = useCallback(async (brandId = activeBrandId, key = accessKey, preview = previewMode) => {
    if (!brandId) return;
    const sequence = ++requestSequence.current;
    setRefreshing(true);
    setFlowError("");
    try {
      const brand = brands.find((item) => item.id === brandId) || previewBrands.find((item) => item.id === brandId) || previewBrands[0];
      const loaded = preview ? previewWorkspace(brand) : await loadFlowWorkspace(key, brandId);
      if (sequence === requestSequence.current) setData(loaded);
    } catch (error) {
      if (sequence === requestSequence.current) setFlowError(error instanceof Error ? error.message : "Could not refresh FLOW.");
    } finally {
      if (sequence === requestSequence.current) setRefreshing(false);
    }
  }, [accessKey, activeBrandId, brands, previewMode]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const params = new URLSearchParams(location.search);
    const localPreview = location.hostname === "localhost" && params.has("flow-preview");
    const hashKey = new URLSearchParams(location.hash.slice(1)).get("key");
    if (hashKey) {
      localStorage.setItem("atlasium-upload-key", hashKey);
      localStorage.setItem("echoflow-access-key", hashKey);
      window.history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
    const key = hashKey || localStorage.getItem("echoflow-access-key") || localStorage.getItem("atlasium-upload-key") || "";
    if (!key && !localPreview) {
      queueMicrotask(() => { if (active) setAccess("missing"); });
      return () => { active = false; controller.abort(); };
    }
    const brandRequest = localPreview ? Promise.resolve([...previewBrands]) : loadFlowBrands(key, controller.signal);
    brandRequest
      .then((loadedBrands) => {
        if (!active) return;
        const remembered = readActiveBrandId();
        const nextBrand = loadedBrands.find((brand) => brand.id === remembered) || loadedBrands[0];
        setAccessKey(key);
        setPreviewMode(localPreview);
        setBrands(loadedBrands);
        setActiveBrandId(nextBrand?.id || "");
        setAccess("granted");
        if (nextBrand) {
          const loaded = localPreview ? Promise.resolve(previewWorkspace(nextBrand)) : loadFlowWorkspace(key, nextBrand.id, controller.signal);
          void loaded.then((snapshot) => { if (active) setData(snapshot); }).catch((error: Error) => { if (active && error.name !== "AbortError") setFlowError(error.message); }).finally(() => { if (active) setRefreshing(false); });
        }
      })
      .catch((error: Error) => { if (active && error.name !== "AbortError") { setAccess("granted"); setFlowError(error.message); } });
    return () => { active = false; controller.abort(); };
  }, []);

  function selectBrand(brandId: string) {
    if (!brands.some((brand) => brand.id === brandId) || brandId === activeBrandId) return;
    rememberActiveBrandId(brandId);
    setActiveBrandId(brandId);
    setData(null);
    void refresh(brandId);
  }

  return { access, brands, activeBrand: brands.find((brand) => brand.id === activeBrandId) || null, activeBrandId, selectBrand, data, flowError, previewMode, refreshing, refresh: () => refresh() };
}
