# EchoFlow Social

EchoFlow Social is the shared, multi-brand social publishing agent powered by Atlasium 7/88 AI.

## Product flow

Select a brand → enter one campaign prompt → generate copy and media → route to that brand's assigned destinations → schedule in EchoFlow → publish directly to the platform APIs → track delivery.

The original permanent public media URLs remain available through `/i/*`, and the manual upload/publish endpoints remain supported as secondary tools.

## Architecture

- One Next/vinext application and one Sites deployment.
- D1 stores workspaces, brands, profiles, channel assignments, campaign indexes, posts, media metadata, drafts, publish jobs, delivery status and audit history.
- R2 stores uploaded/generated images, MP4 files and the complete campaign job records.
- EchoFlow owns its publishing queue, idempotency, retries and delivery history. Meta and LinkedIn publish through their official APIs after the required Atlasium app credentials are installed; TikTok remains approval-gated.
- OpenAI generates campaign copy, images and optional motion media.
- All secrets remain server-side and are never committed.

## Safety

- Every brand-owned record and background job carries an immutable workspace and brand ID.
- Direct platform destinations must be explicitly assigned to one brand.
- Publishing jobs use a persistent brand/campaign/post/destination/schedule idempotency key.
- The legacy Atlasium campaign objects keep their original R2 keys and IDs; the migration only indexes them under the default Atlasium brand and never republishes them.

## Validation

`pnpm test` builds the production worker and runs mocked rendered, scheduling, routing, publishing, motion, migration and isolation tests. Tests do not call live social destinations. Historical Buffer coverage runs only through the explicit `PUBLISHING_MODE=legacy-buffer` compatibility mode and is not the production default.

## Direct publishing secrets

- Meta: `META_ACCESS_TOKEN`, `META_PAGE_ID`, `META_INSTAGRAM_ACCOUNT_ID` and optional account-name / Graph-version variables.
- LinkedIn: `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR_URN` and optional `LINKEDIN_ACCOUNT_NAME` / `LINKEDIN_VERSION`.
- TikTok: `TIKTOK_ACCESS_TOKEN`, `TIKTOK_OPEN_ID` and `TIKTOK_DIRECT_ENABLED=true` only after app review.
- Scheduler: `CRON_SECRET` protects `POST /api/echo/dispatch`; the external scheduler must also pass the Site access bypass header.
- Secrets are server-side bindings. Never place tokens in browser code or commit them to the repository.
