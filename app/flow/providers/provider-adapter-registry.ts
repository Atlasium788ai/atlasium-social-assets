import type { FlowPlatformId, FlowProviderAdapter } from "../services/flow-connection-service";

export type FlowProviderAdapterRegistry = Readonly<Partial<Record<FlowPlatformId, FlowProviderAdapter>>>;

export function createFlowProviderAdapterRegistry(adapters: Partial<Record<FlowPlatformId, FlowProviderAdapter>> = {}): FlowProviderAdapterRegistry {
  return Object.freeze({ ...adapters });
}

// Official adapters are registered here only after approval and server credentials exist.
export const flowProviderAdapters = createFlowProviderAdapterRegistry();
