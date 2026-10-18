# EchoFlow Social

EchoFlow Social is Atlasium's multi-brand, first-party social-content workspace, including ECHO (content), FLOW (operations) and AMPLIFY (advertising drafts).

## First-party publishing

- EchoFlow does **not** send new posts through Buffer or another social scheduling intermediary.
- New immediate image publications use the platform Graph API directly for **Facebook Pages** and **Instagram professional accounts**. Social-app permissions and account access must be approved and configured before a live post is possible.
- Multi-brand settings, campaign and media histories remain in D1 and R2. Existing historical publishing records are preserved, but legacy provider accounts are not active publishing destinations.
- Connections are provisioned from the Cloudflare **secret** `DIRECT_SOCIAL_CONNECTIONS`. Each entry has: `id`, `brandId`, `service` (`facebook` or `instagram`), `accountId`, `displayName` and `accessToken`. Never commit credentials to the repo or send them to a client.
- Only **Post now** for an ordinary image feed post is supported by the direct adapter at this stage. Instagram Stories, Reels, video, LinkedIn, TikTok, X and **native future-date scheduling** require separate approved integrations and a first-party scheduler. They cannot be represented as live.
- Native Meta photo publishing requires a publicly reachable HTTPS image URL. Instagram uses the media-container + publication sequence after it reports `FINISHED`.
- Platform API publishing is only initiated on an explicitly submitted publishing action. Dry-run testing must use mocked platform endpoints.

## Safety

- All direct connections are bound to immutable brand IDs; unrelated brands cannot select or publish to each other's accounts.
- No client-visible API contains the platform access token.
- Failed or pending publication is never claimed as a successful send.
- Historical campaigns, images, drafts and delivery records are not deleted or republished when migrating away from a legacy provider.

## Validation

Run `pnpm test` to compile the Cloudflare/vinext application and validate offline workflows. Legacy intermediary test fixtures will be retired and replaced with mocked first-party API tests; a green test suite does not establish an authorized live social connection.
