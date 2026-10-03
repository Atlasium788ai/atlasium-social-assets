# Recovered shared runtime

`runtime.recovered.mjs` is the exact source downloaded from the active
`atlasium-swarm-runtime` Railway container on 2026-10-03. Its SHA-256 is:

`3839354d979f1e8f69f41e08087a1974e6de9a6fc2ab1da4a11326dae829dca6`

`runtime.without-cyrus.mjs` is the cutover build. It keeps the existing six
department Slack sockets but deliberately does not open Cyrus's Socket Mode
connection. Health ignores the intentionally absent Cyrus socket while still
requiring all six remaining sockets. Set `PROACTIVE_MONITORING_ENABLED=false`
for this build because the legacy proactive loop is Cyrus-specific.

Do not deploy the recovered file as the isolated Cyrus runtime. The isolated,
SQLite-backed service lives in `../cyrus-runtime`.
