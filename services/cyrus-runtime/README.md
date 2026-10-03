# Cyrus runtime

Isolated Chief of Staff runtime for Blair. It is the only service that should
hold Cyrus's Slack Socket Mode connection after cutover.

## Guarantees in this build

- Direct messages are accepted only from `BLAIR_SLACK_USER_ID`.
- Slack delivery deduplication uses `event_id`, never message text.
- Tasks, steps, evidence and decisions live in SQLite and recover after restart.
- A task cannot be marked complete without evidence when it is an action request.
- Failed steps are retained and the agent can try a safe alternative.
- Retryable tool failures are retried once and both attempts are recorded.
- Cyrus can read only explicitly allowlisted HTTPS origins and non-DM Slack channels.
- There is no tool for outbound campaigns, staff messages, spending, deletion or production deployment.
- `/health` reports SQLite state, Slack authentication and live socket status.

## Local test

```bash
node --test test/*.test.js
```

## Railway prerequisites

1. Create a new isolated service. Do not replace `atlasium-swarm-live`, the onboarding alert bridge, or any older bot service.
2. Attach a persistent volume at `/data/cyrus`.
3. Reuse only Cyrus's existing Slack app/bot tokens and set the listed environment variables.
4. Confirm the shared runtime no longer opens Cyrus's socket before enabling Socket Mode here.
5. Deploy and pass `/health`, direct-DM, tool/evidence, failure-recovery, duplicate-event and restart-memory tests.

The recovered shared runtime and its Cyrus-socket handoff build are kept in
`../legacy-swarm-runtime`.
