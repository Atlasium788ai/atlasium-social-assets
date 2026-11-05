# EchoFlow customer workspace foundation (draft)

This change intentionally **does not** give new customers access to the single legacy `workspace_atlasium` publisher. The existing Atlasium campaigns, R2 keys, private upload-key access and connected Buffer channels remain untouched.

## New isolated customer path

1. The existing Atlasium login handoff is extended only for independently verified ReeVIQ **workspace owners** when `ATLASIUM_ECHOFLOW_TENANTS_ENABLED=true`. Team members are not provisioned until a proper shared role and membership model exists.
2. On ticket exchange, customer subjects receive a separate `__Host-atlasium-echo-tenant` signed, Secure, HttpOnly cookie; it is never considered a legacy publishing credential. The original Atlasium owner's session remains on its existing cookie.
3. `GET /api/atlasium/customer/workspace` provisions a deterministic D1 workspace from the verified server-side Atlasium owner UUID and returns only brands with the matching workspace ID. The current user's workspace cannot be selected by a header or query.
4. `POST /api/atlasium/customer/brands` creates at most three draft brands with same-origin POST validation. It never calls Buffer, generates media, or publishes. Channels and publishing are explicitly disabled.
5. The customer portal is `/atlasium/workspace`, separate from `/echo`. A tenant cookie alone is **not accepted** by existing `authorized()` checks on publishing/brand routes.
6. `GET /api/atlasium/customer/workspace` checks EchoFlow entitlements from the existing ReeVIQ server with a backend-only shared secret. If disabled, missing, expired, or unreachable: no paid privileges.

## Billing

ReeVIQ adds `AtlasiumToolEntitlement` and `AtlasiumToolUsage` via a migration. All grants start absent; **single sign-in never turns on billing or grants free credits**. Its dedicated server-only endpoint reports `subscribed`, `creditsRemaining` and `canPublish`, with no inferred CRM plan inclusion.

A separate idempotent, atomic usage debit service is created for future paid publishing actions. It is not called by the draft setup interface. Credits should be provisioned only by verified payments or explicitly approved admin adjustments. Commercial pricing and the credit cost per post/media job remain to be defined before publishing is enabled.

## Release blockers

- [ ] Verify real production origins, deployment environment secrets and cross-domain browser flow.
- [ ] Run database migrations and staging snapshot/backup, then verify no existing Atlasium records move.
- [ ] Complete all remaining tenant-scoped D1/R2 queries and social-channel credential mapping, with zero shared upload keys between tenants.
- [ ] Tie each paid generation/publishing action to idempotent credit reservation, settlement, and refund-on-failure. Until then, **all customer publishing is blocked** even if they have an active paid entitlement.
- [ ] Add safe team memberships, rate limits, account revocation, audit events, subscription checkout and webhook grant fulfillment.
- [ ] Test customer A / customer B isolation under concurrent operations and malicious workspace headers.
- [ ] Only then enable `ATLASIUM_ECHOFLOW_TENANTS_ENABLED` for a pilot, without deploying automatically.

`CoreIQ` appears only in legacy paths or repositories; the customer product is **ReeVIQ**.
