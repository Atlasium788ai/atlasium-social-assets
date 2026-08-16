# EchoFlow Social

EchoFlow Social is the shared, multi-brand social publishing agent powered by Atlasium 7/88 AI.

## Product flow

Select a brand → enter one campaign prompt → generate copy and media → route to that brand's assigned destinations → schedule → publish through Buffer → track delivery.

The original permanent public media URLs remain available through `/i/*`, and the manual upload/publish endpoints remain supported as secondary tools.

## Architecture

- One Next/vinext application and one Sites deployment.
- D1 stores workspaces, brands, profiles, channel assignments, campaign indexes, posts, media metadata, drafts, publish jobs, delivery status and audit history.
- R2 stores uploaded/generated images, MP4 files and the complete campaign job records.
- Buffer is the active publishing provider. Disabled direct Meta, LinkedIn and TikTok feature flags are marked `APPROVAL PENDING`.
- OpenAI generates campaign copy, images and optional motion media.
- All secrets remain server-side and are never committed.

## Safety

- Every brand-owned record and background job carries an immutable workspace and brand ID.
- Buffer destinations must be explicitly assigned to one brand.
- Publishing jobs use a persistent brand/campaign/post/destination/schedule idempotency key.
- The legacy Atlasium campaign objects keep their original R2 keys and IDs; the migration only indexes them under the default Atlasium brand and never republishes them.

## Validation

`pnpm test` builds the production worker and runs mocked rendered, scheduling, routing, publishing, motion, migration and isolation tests. Tests do not call live Buffer or social destinations.
