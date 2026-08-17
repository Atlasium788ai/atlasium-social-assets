"use client";

import { useEffect, useState } from "react";
import { readActiveBrandId, rememberActiveBrandId } from "@/app/components/brand-preference";
import { loadFlowBrands, type FlowBrand } from "../services/flow-brand-service";

type AccessState = "checking" | "granted" | "missing";

const previewBrands: readonly FlowBrand[] = Object.freeze([
  { id: "brand_atlasium_788_ai", name: "Atlasium 7/88 AI", timezone: "America/Toronto" },
  { id: "brand_preview_northstar", name: "Northstar Coffee", timezone: "America/Toronto" },
]);

export function useFlowWorkspace() {
  const [access, setAccess] = useState<AccessState>("checking");
  const [brands, setBrands] = useState<FlowBrand[]>([]);
  const [activeBrandId, setActiveBrandId] = useState("");
  const [flowError, setFlowError] = useState("");
  const [previewMode, setPreviewMode] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const params = new URLSearchParams(location.search);
    const localPreview = location.hostname === "localhost" && params.get("flow-preview") === "channels";
    const hashKey = new URLSearchParams(location.hash.slice(1)).get("key");
    if (hashKey) {
      localStorage.setItem("atlasium-upload-key", hashKey);
      localStorage.setItem("echoflow-access-key", hashKey);
      window.history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
    const accessKey = hashKey || localStorage.getItem("echoflow-access-key") || localStorage.getItem("atlasium-upload-key") || "";
    if (!accessKey && !localPreview) {
      queueMicrotask(() => { if (active) setAccess("missing"); });
      return () => { active = false; controller.abort(); };
    }
    const brandRequest = localPreview ? Promise.resolve([...previewBrands]) : loadFlowBrands(accessKey, controller.signal);
    brandRequest
      .then((loadedBrands) => {
        if (!active) return;
        const remembered = readActiveBrandId();
        const nextBrand = loadedBrands.find((brand) => brand.id === remembered) || loadedBrands[0];
        setPreviewMode(localPreview);
        setBrands(loadedBrands);
        setActiveBrandId(nextBrand?.id || "");
        setAccess("granted");
      })
      .catch((error: Error) => { if (active && error.name !== "AbortError") { setAccess("granted"); setFlowError(error.message); } });
    return () => { active = false; controller.abort(); };
  }, []);

  function selectBrand(brandId: string) {
    if (!brands.some((brand) => brand.id === brandId)) return;
    rememberActiveBrandId(brandId);
    setActiveBrandId(brandId);
  }

  return { access, brands, activeBrand: brands.find((brand) => brand.id === activeBrandId) || null, activeBrandId, selectBrand, flowError, previewMode };
}
