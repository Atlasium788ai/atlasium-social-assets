export const ACTIVE_BRAND_KEY = "echoflow-active-brand";
export const LEGACY_FLOW_BRAND_KEY = "echoflow-flow-active-brand";

export function readActiveBrandId() {
  return localStorage.getItem(ACTIVE_BRAND_KEY) || localStorage.getItem(LEGACY_FLOW_BRAND_KEY) || "";
}

export function rememberActiveBrandId(brandId: string) {
  localStorage.setItem(ACTIVE_BRAND_KEY, brandId);
  localStorage.setItem(LEGACY_FLOW_BRAND_KEY, brandId);
}
