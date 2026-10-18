import type { FlowPlatformId, FlowProviderAdapter } from "../services/flow-connection-service";

export type FlowProviderAdapterRegistry = Readonly<Partial<Record<FlowPlatformId, FlowProviderAdapter>>>;

export function createFlowProviderAdapterRegistry(adapters: Partial<Record<FlowPlatformId, FlowProviderAdapter>> = {}): FlowProviderAdapterRegistry {
  return Object.freeze({ ...adapters });
}

// Direct server-side adapters live in the worker. Browser OAuth adapters remain empty
// until Atlasium installs the official app credentials and callback URLs.
export const flowProviderAdapters = createFlowProviderAdapterRegistry();
