export type FlowPlatformId = "facebook" | "instagram" | "linkedin" | "tiktok" | "youtube" | "x" | "threads" | "pinterest" | "google_business" | "bluesky" | "snapchat";
export type FlowConnectionStatus = "connect" | "connected" | "approval_pending" | "coming_soon" | "reconnect" | "needs_attention" | "unavailable";
export type FlowAuthorizationOutcome = "success" | "cancelled" | "expired" | "permissions_rejected";

export type FlowProviderAuthorization = {
  providerId: FlowPlatformId;
  authorizationEnabled: boolean;
  featureFlag: string;
  scopes: readonly string[];
  pkce: "required" | "when_supported";
};

export type FlowConnectedAccount = {
  id: string;
  brandId: string;
  providerId: FlowPlatformId;
  accountName: string;
  handle?: string;
  accountType: string;
  status: "connected" | "reconnect" | "needs_attention";
};

export type FlowAuthorizationTransaction = {
  brandId: string;
  providerId: FlowPlatformId;
  state: string;
  codeVerifier: string;
  expiresAt: number;
  mode: "connect" | "reconnect";
};

export interface FlowProviderAdapter {
  begin(input: { brandId: string; state: string; codeChallenge: string; scopes: readonly string[]; mode: "connect" | "reconnect" }): Promise<{ authorizationUrl: string }>;
  complete(input: { brandId: string; code: string; codeVerifier: string; scopes: readonly string[] }): Promise<{ account: FlowConnectedAccount; grantedScopes: readonly string[] }>;
  refresh(account: FlowConnectedAccount): Promise<FlowConnectedAccount>;
  revoke(account: FlowConnectedAccount): Promise<void>;
}

export interface FlowAuthorizationStore {
  save(transaction: FlowAuthorizationTransaction): Promise<void>;
  take(state: string): Promise<FlowAuthorizationTransaction | null>;
}

export class FlowConnectionError extends Error {
  constructor(public readonly code: "brand_forbidden" | "provider_unavailable" | "invalid_state" | "confirmation_required") {
    super(code);
  }
}

function base64Url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

export class FlowConnectionCoordinator {
  constructor(private readonly dependencies: {
    providers: Readonly<Record<string, FlowProviderAuthorization>>;
    adapters: Readonly<Partial<Record<FlowPlatformId, FlowProviderAdapter>>>;
    store: FlowAuthorizationStore;
    authorizeBrand: (brandId: string) => Promise<boolean>;
    randomValue: () => string;
    now: () => number;
  }) {}

  private async requireBrand(brandId: string) {
    if (!await this.dependencies.authorizeBrand(brandId)) throw new FlowConnectionError("brand_forbidden");
  }

  async begin(input: { brandId: string; providerId: FlowPlatformId; mode?: "connect" | "reconnect" }) {
    await this.requireBrand(input.brandId);
    const provider = this.dependencies.providers[input.providerId];
    const adapter = this.dependencies.adapters[input.providerId];
    if (!provider?.authorizationEnabled || !adapter) throw new FlowConnectionError("provider_unavailable");
    const state = this.dependencies.randomValue();
    const codeVerifier = this.dependencies.randomValue();
    const codeChallenge = await sha256(codeVerifier);
    await this.dependencies.store.save({ brandId: input.brandId, providerId: input.providerId, state, codeVerifier, expiresAt: this.dependencies.now() + 10 * 60_000, mode: input.mode || "connect" });
    const authorization = await adapter.begin({ brandId: input.brandId, state, codeChallenge, scopes: provider.scopes, mode: input.mode || "connect" });
    return { authorizationUrl: authorization.authorizationUrl, state };
  }

  async complete(input: { brandId: string; providerId: FlowPlatformId; state: string; code?: string; error?: "access_denied" | "permissions_rejected" }) : Promise<{ outcome: FlowAuthorizationOutcome; account?: FlowConnectedAccount }> {
    await this.requireBrand(input.brandId);
    const transaction = await this.dependencies.store.take(input.state);
    if (!transaction || transaction.brandId !== input.brandId || transaction.providerId !== input.providerId) throw new FlowConnectionError("invalid_state");
    if (transaction.expiresAt <= this.dependencies.now()) return { outcome: "expired" };
    if (input.error === "access_denied") return { outcome: "cancelled" };
    if (input.error === "permissions_rejected" || !input.code) return { outcome: "permissions_rejected" };
    const provider = this.dependencies.providers[input.providerId];
    const adapter = this.dependencies.adapters[input.providerId];
    if (!provider?.authorizationEnabled || !adapter) throw new FlowConnectionError("provider_unavailable");
    const result = await adapter.complete({ brandId: input.brandId, code: input.code, codeVerifier: transaction.codeVerifier, scopes: provider.scopes });
    if (provider.scopes.some((scope) => !result.grantedScopes.includes(scope))) return { outcome: "permissions_rejected" };
    if (result.account.brandId !== input.brandId || result.account.providerId !== input.providerId) throw new FlowConnectionError("invalid_state");
    return { outcome: "success", account: result.account };
  }

  async reconnect(account: FlowConnectedAccount) {
    return this.begin({ brandId: account.brandId, providerId: account.providerId, mode: "reconnect" });
  }

  async disconnect(account: FlowConnectedAccount, confirmed: boolean) {
    await this.requireBrand(account.brandId);
    if (!confirmed) throw new FlowConnectionError("confirmation_required");
    const adapter = this.dependencies.adapters[account.providerId];
    if (!adapter) throw new FlowConnectionError("provider_unavailable");
    await adapter.revoke(account);
    return { disconnected: true as const, accountId: account.id, brandId: account.brandId };
  }
}
