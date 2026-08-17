"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readActiveBrandId, rememberActiveBrandId } from "@/app/components/brand-preference";
import { loadAmplifyWorkspace } from "../services/amplify-ad-service";
import type { AmplifyBrand, AmplifyWorkspaceData } from "../types";

type AccessState = "checking" | "granted" | "missing";

const previewBrands: AmplifyBrand[] = [
  { id: "brand_atlasium_788_ai", name: "Atlasium 7/88 AI", timezone: "America/Toronto", industry: "AI revenue systems", location: "Toronto, Ontario", mainOffers: "Revenue systems and automation", targetAudience: "Business owners", primaryCta: "Start a conversation" },
  { id: "brand_preview_northstar", name: "Northstar Coffee", timezone: "America/Toronto", industry: "Hospitality", location: "Toronto, Ontario", mainOffers: "Specialty coffee", targetAudience: "Local coffee customers", primaryCta: "Visit the café" },
];

function previewWorkspace(brandId: string): AmplifyWorkspaceData {
  const activeBrand = previewBrands.find((brand) => brand.id === brandId) || previewBrands[0];
  return {
    brands: previewBrands,
    activeBrand,
    creativeSources: [
      { id: `preview_echo_${activeBrand.id}`, brandId: activeBrand.id, sourceType: "echo_asset", label: `${activeBrand.name} approved ECHO creative`, mediaType: "image", url: "/echoflow-social.png", detail: "MOCK PREVIEW source · original remains unchanged" },
      { id: `preview_flow_${activeBrand.id}`, brandId: activeBrand.id, sourceType: "flow_post", label: `${activeBrand.name} FLOW post`, mediaType: "post", url: "/echoflow-social.png", detail: "MOCK PREVIEW organic post", originalId: `preview_post_${activeBrand.id}` },
    ],
    drafts: [],
    featureFlags: { interfaceEnabled: true, dryRunEnabled: true, liveSubmissionEnabled: false },
  };
}

export function useAmplifyWorkspace() {
  const [access, setAccess] = useState<AccessState>("checking");
  const [accessKey, setAccessKey] = useState("");
  const [workspace, setWorkspace] = useState<AmplifyWorkspaceData | null>(null);
  const [activeBrandId, setActiveBrandId] = useState("");
  const [loadingBrand, setLoadingBrand] = useState(false);
  const [error, setError] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const requestSequence = useRef(0);

  const loadBrand = useCallback(async (brandId: string, key = accessKey, preview = previewMode) => {
    const sequence = ++requestSequence.current;
    setLoadingBrand(true);
    setError("");
    setWorkspace((current) => current ? { ...current, activeBrand: current.brands.find((brand) => brand.id === brandId) || current.activeBrand, creativeSources: [], drafts: [] } : null);
    try {
      const data = preview ? previewWorkspace(brandId) : await loadAmplifyWorkspace(key, brandId);
      if (sequence !== requestSequence.current) return;
      setWorkspace(data);
      setActiveBrandId(data.activeBrand.id);
      rememberActiveBrandId(data.activeBrand.id);
    } catch (caught) {
      if (sequence === requestSequence.current) setError(caught instanceof Error ? caught.message : "Could not load this brand.");
    } finally {
      if (sequence === requestSequence.current) setLoadingBrand(false);
    }
  }, [accessKey, previewMode]);

  useEffect(() => {
    const hashKey = new URLSearchParams(location.hash.slice(1)).get("key");
    if (hashKey) {
      localStorage.setItem("atlasium-upload-key", hashKey);
      localStorage.setItem("echoflow-access-key", hashKey);
      window.history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
    const key = hashKey || localStorage.getItem("echoflow-access-key") || localStorage.getItem("atlasium-upload-key") || "";
    const preview = location.hostname === "localhost" && new URLSearchParams(location.search).has("amplify-preview");
    if (!key && !preview) { queueMicrotask(() => setAccess("missing")); return; }
    const remembered = readActiveBrandId() || previewBrands[0].id;
    queueMicrotask(() => { setAccessKey(key); setPreviewMode(preview); setAccess("granted"); void loadBrand(remembered, key, preview); });
    // Initial authorization and brand load run once after hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectBrand(brandId: string) {
    if (!workspace?.brands.some((brand) => brand.id === brandId) || brandId === activeBrandId) return;
    rememberActiveBrandId(brandId);
    setActiveBrandId(brandId);
    void loadBrand(brandId);
  }

  function mergeDraft(draft: AmplifyWorkspaceData["drafts"][number]) {
    setWorkspace((current) => current ? { ...current, drafts: [draft, ...current.drafts.filter((item) => item.id !== draft.id)] } : current);
  }

  function addCreative(source: AmplifyWorkspaceData["creativeSources"][number]) {
    if (source.brandId !== activeBrandId) return;
    setWorkspace((current) => current ? { ...current, creativeSources: [source, ...current.creativeSources.filter((item) => item.id !== source.id)] } : current);
  }

  return { access, accessKey, workspace, activeBrandId, activeBrand: workspace?.activeBrand || null, loadingBrand, error, previewMode, selectBrand, mergeDraft, addCreative, reload: () => activeBrandId && loadBrand(activeBrandId) };
}
