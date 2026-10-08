# Atlasium 7/88 bot clone handoff (2026-10-08)

## Scope and status
- Canonical code: `services/cyrus-runtime` (already used by Cyrus and Malik). **Do not recreate the engine.**
- Eight role configurations now available: **Cyrus, Malik, Clara, Mateo, Kenji, Amara, Nadia, Sloane**.
- **Cyrus and Malik** remain the existing dedicated Railway services. The branch is not deployed to them.
- **Clara, Mateo, Kenji, Amara, Nadia** are the next five clones to provision and test. They are not declared live by this code change.
- **Sloane** is defined in code, but cannot be activated before her distinct Slack app and bot tokens exist.
- Original onboarding bridge, existing legacy swarm, and both current executive services remain unchanged.

## Duplication pattern
Each bot runs **the same** repo and root directory, `/services/cyrus-runtime`. Clone only the Railway service configuration, with:
- A unique service name (`clara-runtime`, `mateo-runtime`, `kenji-runtime`, `amara-runtime`, `nadia-runtime`, and later `sloane-runtime`).
- `BOT_ROLE` set to its lowercase role; `BOT_NAME`, `BOT_TITLE`, `BOT_DEPARTMENT` optional because defaults are in `src/role_profiles.js`.
- Its **own** `SLACK_APP_TOKEN` and `SLACK_BOT_TOKEN`, never another bot's token.
- Existing approved `OPENAI_API_KEY`, `BLAIR_SLACK_USER_ID`, `OPENAI_MODEL` and other shared non-secret runtime settings through secure Railway references.
- Its **own persistent volume** mounted at `/data/<role>`, with `BOT_DATA_DIR=/data/<role>`. Never mount another bot's database.
- `AGENT_PEERS_JSON` configured only with verified reachable private-network bot endpoints for Cyrus and legitimately connected peers.
- Preserve the shared Docker/build path, startup, /health, internal handoff, retry/evidence and SQLite implementation.

## Safe sequence
1. Run `node --test test/*.test.js` inside `services/cyrus-runtime`. Do not deploy a failing commit.
2. Create one isolated service/volume for Clara from this branch and supply her distinct credentials.
3. Disable/retire **only Clara's old socket owner** before enabling the new Clara socket, to prevent duplicate Slack consumers. Do not retire the onboarding bridge or Viktor as collateral.
4. Verify `/health`, correct Slack identity, direct Blair DM, no unauthorized staff DM, event-ID deduplication, persistent memory across restart, evidence gate, one Cyrus handoff, and restart recovery.
5. Repeat steps 2–4 for Mateo, Kenji, Amara and Nadia. Keep `BOT_SOCKET_ENABLED=false` until unique owner and tokens are confirmed.
6. Update Cyrus and specialist private-network peer maps only after each destination passes readiness; test Cyrus -> specialist -> Cyrus loop without creating a handoff loop.
7. Sloane last, after Slack app capacity and distinct tokens are resolved; verify privacy, legal and HR authority boundaries.

## Permissions
- Cyrus remains the Chief of Staff, company-wide controller. Malik remains Head of Revenue.
- Only Malik's runtime exposes the ReeVIQ/Instantly operational tools. The executor also rejects unauthorized calls to these tools from another role.
- Department bots have read-only research and explicitly allowlisted Slack/channel tools, plus persistent plans/follow-ups and verified agent handoffs.
- New roles **do not** gain tools to send prospect messages, spend money, change live infrastructure, or execute legal/employment decisions just by receiving a personality prompt.
- Staff updates and operational delegations must use verified connected handoffs; never claim delivery on mere intent.

## Current provisioning limitation
The Railway connection exposes existing variable **names**, but redacts token values. The existing legacy service has named Slack credentials for the five specialist roles. Do not copy secrets into GitHub or print them in reports. Use securely configured Railway references or separate service secrets. A role with no working Slack identity must remain disconnected rather than borrowing another bot's credentials.

## Release acceptance
Count a clone as live **only** after a unique service has a successful deployed build, healthy socket authenticated for that role, persistent volume, restored work state, and passing direct-DM/handoff/evidence/recovery checks. Code-ready != deployed != operational.
