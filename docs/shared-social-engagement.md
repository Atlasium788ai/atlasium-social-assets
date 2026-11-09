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
- Editors can revise the suggested reply through `PUT /api/flow/engagement/inbox` before approving it. Edits must be brand-scoped, non-promotional and free of unreviewed links; revisions and approvals still never send.
- `GET /api/flow/engagement/inbox` shows brand-scoped categories, draft suggestions and states. It intentionally hides raw provider IDs and private message content.

**Outstanding for production:**
1. Build and verify each provider's actual OAuth, webhook permission scopes and signature authentication.
2. Link each provider's owned account to its EchoFlow brand, using verified account IDs; no Atlasium account may be silently assigned to Built to Own.
3. Establish appropriate data retention/deletion and key rotation policies before holding real inbox events.
4. Add channel-specific consent and messaging windows, an approved sending adapter, suppression checks at actual send time, immutable receipts and error handling.
5. Run supervised own-account tests. No automatic cold DMs, bulk third-party replies or inferred consent from follows/likes.
6. Apply D1 migration `0004_engagement_inbox.sql` to test storage and validate migrations before any production change.

No live providers have been connected and no real social messages have been sent or ingested.

## Build-vs-buy decision (owner direction, November 2026)

**Build the engagement system as an owned feature of EchoFlow. No Manychat or external automation subscription.** Reuse our existing Cloudflare Worker, D1, R2, Next/vinext and Drizzle stack. Study or adapt permissively licensed open-source implementation patterns only when they reduce actual code and maintenance. Keep legal license notices. Do not clone another company's proprietary source, branding or API workarounds.

Potential reusable component reference: Chatwoot's self-hosted FOSS code has an MIT license, but the full Chatwoot server is heavyweight and should **not** be deployed unless a proven missing inbox capability warrants it. n8n's self-hosted community edition has commercial embedding and white-label restrictions; do **not** make it a customer-facing EchoFlow engine without appropriate license review. Avoid adding a new database, hosting service, dashboard, paid tier or dependency merely to integrate social messages.

**Lean completion order:** (1) authorized own-brand comments and DMs via official provider adapters, (2) prompt-safe reply generation and human approval, (3) opt-in keyword resource responses on networks where supported, (4) curated, manually approved public engagement on other pages, (5) source-attributed analytics showing reach, replies, profile visits where available, traffic and qualified conversations. Each provider is optional; leave unsupported actions disabled and visible rather than pretending full platform coverage.

The commercial goal is traffic, useful discussion, qualified interest and sales conversations. The system should minimize operator time and maintain editorial integrity, consent, brand segregation and platform compliance.

## Next-phase implementation: on-demand AI and Meta adapter

**AI suggested comments, review-only**
- FLOW > Engagement now has **Suggest reply with AI**. Provide a URL and a short description of a real public conversation; AI suggests one specific, non-promotional comment, grounded solely in the supplied context.
- This is a **user-triggered** feature. AI does not scan the linked URL or read comments behind the scenes. It cannot invent personal experiences, quote unseen material or claim to have examined the full thread.
- An ephemeral suggestion fills the editable draft field; press **Save for review** to retain it. Nothing is posted automatically.
- It reuses the existing server-side `OPENAI_API_KEY` / `OPENAI_TEXT_MODEL`. This does not create a new subscription but **API generation may have usage costs**. A 20-successful-suggestions-per-rolling-day limit is enforced per brand using existing audit logs. The limit is a basic usage guard, not a concurrency-safe budget guarantee.
- `POST /api/flow/engagement/suggest` requires workspace auth and an explicit brand; it validates the selected social domain and public-only context. It does not retain the public conversation or generate a new send target.

**Meta native webhook adapter, disabled by default**
- The initial read-only adapter accepts Meta Facebook Page comments/Messenger text messages and Instagram comments/DM text messages **only after Meta app verification, required app permissions, and trusted account-to-brand assignment**.
- Endpoint: `GET|POST /api/flow/engagement/meta-webhook`. GET serves Meta's token-based challenge. POST verifies `X-Hub-Signature-256` over the **exact raw body** using configured app secret(s); it supports known event shapes only.
- Enable only after provider authorization: `ECHOFLOW_META_WEBHOOK_ENABLED=true`, `META_VERIFY_TOKEN` (private), `META_APP_SECRET` and/or `INSTAGRAM_APP_SECRET`, plus the internal signed bridge secrets `ENGAGEMENT_INGEST_SECRET`, `ENGAGEMENT_ID_SECRET` and `ENGAGEMENT_INBOX_ENABLED=true`.
- A verified signed payload is **not enough** to enter the inbox. Each event's provider account ID must be mapped to an active `engagement_inbox_accounts` record, owned by the same EchoFlow brand, with `status='read_enabled'`. That verified account-linking workflow **does not yet exist**; it requires authorized provider OAuth/account verification. Never enable accounts from untrusted webhook content.
- The adapter ignores unsupported changes and own-page echo messages; known events are deduplicated and opt-out checked by the internal inbox. Raw message text is not persisted in the review DB.
- No provider reply sending, unsolicited DM, bulk automation, app setup, account connection or production deployment exists. The test harness uses fake credentials and fake events only.
- The code currently accepts at most 100 normalized events per request and no attachments or template messages. Expand and queue event processing as necessary before production. Confirm actual payload shapes, Meta permissions, delivery semantics and platform pricing at account connection time.

**No supplier software was copied.** EchoFlow uses its own existing runtime, database and AI service. The Meta adapter follows a documented webhook signature protocol; the Chatwoot reference is architecture background rather than an imported dependency.
