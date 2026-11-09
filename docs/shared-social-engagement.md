# EchoFlow / FLOW | Shared Social Engagement Engine

**Status: isolated draft feature only. No deployment, live inbox access, auto-commenting, social DMs or new cost.**

## Architecture decision
The engagement engine is an EchoFlow capability. It belongs to the existing multi-brand **FLOW** section, not to the Built to Own news site or a new microservice.

```
EchoFlow / FLOW > Engagement
  ├─ Select brand (existing EchoFlow brand context)
  ├─ Research relevant third-party discussions (authorized sources only)
  ├─ Review useful public comment suggestions
  ├─ Own-brand inbox: comments and opted-in messages (future provider integration)
  ├─ Review, approve, deliver only when separately enabled and authorized
  └─ Log provider receipts, outcomes and moderation (future)
  
Consumers: Built to Own / Atlasium 7/88 AI / future approved brands
```

All records carry `workspace_id` and `brand_id`. The old one-brand Built to Own Python engagement modules are **prototype inputs only** and must not be deployed as standalone posting systems. Future Built to Own articles, its seven-day content pilot and its own social accounts can feed EchoFlow, using that brand's unique scope.

## Implemented (prototype)
- D1 migration `0003_shared_engagement.sql` and Drizzle schema: brand-isolated engagement draft store with per-brand idempotency.
- FLOW navigation tab `/flow/engagement`; uses the existing active-brand selector.
- `GET /api/flow/engagement`: list review drafts scoped to an explicitly selected, authorized brand.
- `POST /api/flow/engagement`: accept one manually curated, public social-post URL plus context and a proposed useful comment. It does not accept DM targets or contact lists; social URL hostnames are allowlisted.
- `PATCH /api/flow/engagement`: mark draft approved_not_sent or rejected. **Approval never sends or schedules a message**.
- Existing workspace auth applies to every route; cross-brand draft review and access are denied.
- Tests include unauthorized requests, brand selection, cross-brand isolation, duplicate sources, invalid domains, promotional copy and non-sending state.

## Not implemented
- Reading actual competitor social posts/comments through provider APIs.
- Listening to inbound messages or replies from any social provider.
- Posting comments or replying to DMs, including automatic sending.
- Brand-native OAuth scopes for social inbox and a trusted signed webhook receiver.
- Consent and opt-outs for messaging, safe rate limits, privacy retention/deletion and reply windows.
- Source-grounded AI draft generation, contextual moderation, attribution and performance analytics.

No "scan live", "DM sent", or "growth achieved" claim is justified yet.

## Delivery requirements
For the next milestone, create provider adapters that prove:
1. The account is connected and assigned to the **same** EchoFlow brand.
2. The correct provider scopes, commercial permissions and platform terms allow the exact action.
3. Webhook origin and signature are verified before accepting inbox messages.
4. Incoming conversations are classified; prohibited or stale DMs are not processed.
5. Raw private data are retained minimally; opt-outs and deletion requests are honored.
6. Staff review approves the exact proposed response and destination.
7. A dedicated sender performs one idempotent allowed action with durable receipt, error handling and per-brand audit.
8. Each provider passes a real, supervised test before enabling any automation.

Third-party engagement should remain manual-approved; automated bulk replies or cold DMs to people just because they commented on someone else's page are not acceptable.

## Build & tests
EchoFlow uses Cloudflare D1/R2, Next/vinext and its existing `pnpm test` CI. The SQL migration must be applied to an **isolated test database first**, then checked against production deployment configuration before merging; it is not applied by simply committing the file.

This PR does not modify production credentials, domains, existing social channel assignments, Buffer schedules, or Atlasium data.

## Inbound inbox bridge: implementation details (review-only)

A **separate inbound comments + DMs review queue** now appears in FLOW > Engagement. It is scoped to the selected brand and cannot access other brands. The incoming workflow records only the message category, a brand-neutral suggested reply, a pseudonymous HMAC identity and the timestamp. Raw message bodies and personal actor IDs are not stored. No outbound messaging endpoint exists.

The inbox bridge is disabled by default. It has three **server-side** configuration fields:

- `ENGAGEMENT_INBOX_ENABLED=true` explicitly enables trusted internal event intake. Keep false in production until a platform adapter passes an end-to-end audit.
- `ENGAGEMENT_INGEST_SECRET`: a dedicated, random 32+ character key for the trusted internal bridge HMAC; do not commit or share it.
- `ENGAGEMENT_ID_SECRET`: a separate, random 32+ character HMAC key for pseudonymizing platform actor/event identifiers; do not reuse Atlasium contact data or leak this into the browser.

`POST /api/flow/engagement/inbound` takes signed normalized JSON records via `X-EchoFlow-Timestamp` (Unix seconds) and `X-EchoFlow-Signature: sha256=<HMAC-SHA256 hexadecimal digest>` signing the exact string `timestamp + "." + raw_request_body`. Timestamp tolerance is five minutes, body size cap 8 KB, and all events deduplicate across retries. This internal HMAC **does not replace native provider webhook verification**; a provider adapter must first validate Meta/Google/other platform signatures and connect account permissions before relaying.

Required body fields: `brandId, platform, providerAccountId, providerEventId, providerActorId, kind, receivedAt, incomingText, origin="verified_provider_bridge", onOwnBrandAccount=true`. Accepted kinds depend on the platform's intended inbox support. The event is accepted **only** if `engagement_inbox_accounts` includes that platform account ID in `read_enabled` state assigned to the **same brand**. An OAuth/provider adapter is responsible for writing that record after verifying account ownership. There is deliberately no browser control to mark arbitrary accounts as verified.

- Replay, invalid signatures, unknown accounts, different-brand accounts and scraped third-party comments are rejected.
- Inbound DMs older than 24 hours are recorded as **suppressed**, not made replyable; this is a conservative internal safety window, not a claim about each provider's actual latest policy.
- "STOP", "Please stop messaging me" and related opt-outs permanently suppress further draft replies to the actor within the brand/platform scope. Suppression cannot be overridden by approving an old draft.
- The engine limits one brand to 500 intake events per rolling 24 hours. This is a safety cap; provider quota limits and app reviews still apply.
- All reply suggestions require review. `PATCH /api/flow/engagement/inbox` sets `approved_not_sent` or `rejected` but never transmits.
- `GET /api/flow/engagement/inbox` shows brand-scoped categories, draft suggestions and states. It intentionally hides raw provider IDs and private message content.

**Outstanding for production:**
1. Build and verify each provider's actual OAuth, webhook permission scopes and signature authentication.
2. Link each provider's owned account to its EchoFlow brand, using verified account IDs; no Atlasium account may be silently assigned to Built to Own.
3. Establish appropriate data retention/deletion and key rotation policies before holding real inbox events.
4. Add channel-specific consent and messaging windows, an approved sending adapter, suppression checks at actual send time, immutable receipts and error handling.
5. Run supervised own-account tests. No automatic cold DMs, bulk third-party replies or inferred consent from follows/likes.
6. Apply D1 migration `0004_engagement_inbox.sql` to test storage and validate migrations before any production change.

No live providers have been connected and no real social messages have been sent or ingested.
