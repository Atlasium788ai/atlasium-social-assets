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
