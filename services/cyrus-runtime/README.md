# Atlasium executive bot runtime

The production runtime first proven by Cyrus and reused by Malik. Cyrus and
Malik keep their existing Railway services. Clara, Mateo, Kenji, Amara, Nadia
and Sloane can run inside Cyrus's existing service and volume while retaining
separate SQLite databases, identities, prompts, permissions, tasks, evidence,
follow-ups and memory. No additional Railway service or volume is required.

## Guarantees in this build

- Direct messages are accepted only from `BLAIR_SLACK_USER_ID`.
- Slack delivery deduplication uses `event_id`, never message text.
- Tasks, steps, evidence, decisions, work plans, follow-ups and reply outbox live in SQLite and recover after restart.
- A task cannot be marked complete without evidence when it is an action request.
- Planned work must be evidence-complete before its parent objective can complete.
- Failed steps are retained and the agent can try a safe alternative.
- Retryable tool failures are retried once and both attempts are recorded.
- Automatic follow-ups persist through restarts and produce distinct deduplicated Slack replies.
- Private Railway handoffs are idempotent and only accept configured peer roles.
- In-process handoffs use the same evidence contract and force every
  department-to-department objective through Cyrus.
- Each bot can read only explicitly allowlisted HTTPS origins and non-DM Slack channels.
- Non-revenue roles receive no outbound-campaign tools. No role receives a
  general staff-messaging, spending, deletion, or production-deployment tool.
- `/health` reports SQLite state, Slack authentication and live socket status.
- `EXPECTED_SLACK_BOT_USER_ID` stops a service before Socket Mode starts if the
  supplied token belongs to the wrong bot.

## Supported role profiles

The same runtime accepts these `BOT_ROLE` values: `cyrus`, `malik`, `clara`,
`mateo`, `kenji`, `amara`, `nadia`, and `sloane`. Clara is explicitly the new
Command88 Clara and is forbidden from claiming the Viktor Clara identity or
history. Malik alone receives the revenue execution tools. The other department
roles receive the shared memory, planning, research, evidence, recovery,
follow-up, Slack-read, and verified handoff framework.

Set `SHARED_BOT_ROLES=clara,mateo,kenji,amara,nadia,sloane` on Cyrus to enable
the shared organization. Each role stores data below
`SHARED_BOT_DATA_DIR/<role>/<role>.sqlite`. Existing role-specific Slack tokens
can be supplied with `ROLE_SLACK_APP_TOKEN`, `ROLE_SLACK_BOT_TOKEN`, and
`ROLE_EXPECTED_SLACK_BOT_USER_ID`. Without those tokens, the executive remains
fully addressable through Cyrus and does not open a separate Slack socket.

`CYRUS_AUTONOMY_ENABLED` and `PROACTIVE_MONITORING_ENABLED` default to false.
This prevents background model calls during the zero-spend build. Enable them
only at final launch after an explicit operating budget is approved.

## Local test

```bash
node --test test/*.test.js
node scripts/preflight-shared.mjs
```

Run the opt-in live-model role gate only when API credit is available:

```bash
OPENAI_API_KEY=... node scripts/evaluate-roles.mjs
```

It evaluates the six duplicated department roles against their actual system
prompts. Each must use the health tool, refuse to impersonate another
department, deliver the cross-department objective to Cyrus, verify both pieces
of evidence, and only then complete.

## Final Railway activation

1. Keep the existing Cyrus service and `/data/cyrus` volume.
2. Configure `SHARED_BOT_ROLES` and `SHARED_BOT_DATA_DIR=/data/cyrus/executives`.
3. Reuse the five already-valid Command88 Slack identities where direct DMs are
   desired. Sloane can remain Cyrus-mediated without a new Slack app.
4. Keep Malik's existing private Railway peer URL in `AGENT_PEERS_JSON`.
5. Run the zero-network preflight and offline suite before deployment.
6. At final activation, deploy once, verify `/health` reports all six shared
   executives, restart once, then run live Cyrus-to-role, role-to-Cyrus, memory,
   failure-recovery and direct-Slack tests.

Cyrus lists Malik in `AGENT_PEERS_JSON`; the six in-process executives are
registered automatically. Their databases remain separate. Cross-department
communication is recorded as durable handoff tasks through Cyrus.

The recovered shared runtime and its Cyrus-socket handoff build are kept in
`../legacy-swarm-runtime`.

## Research support

All dedicated executive runtimes built from this template inherit the read-only `ask_chatgpt` tool. It can use OpenAI web search for current factual, technical, product, vendor, documentation, and troubleshooting questions and returns source URLs. Agents should use research before escalating general-knowledge questions to Blair. Public research never authorizes side effects, spending, prospect contact, legal commitments, or changes to live systems.
