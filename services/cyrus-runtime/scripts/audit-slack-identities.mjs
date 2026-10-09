const roles = {
  clara: { expectedUserId: "U0C1DES05L5" },
  mateo: { expectedUserId: "U0C2GFE1C9W" },
  kenji: { expectedUserId: "U0C2GFPP7AL" },
  amara: { expectedUserId: "U0C16P5BYAK" },
  nadia: { expectedUserId: "U0C1FU0ANRZ" },
  sloane: { expectedUserId: "" },
};

async function slack(method, token) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  return { httpOk: response.ok, ok: Boolean(body.ok), error: body.error || null, userId: body.user_id || null };
}

const results = [];
for (const [role, profile] of Object.entries(roles)) {
  const prefix = role.toUpperCase();
  const botToken = process.env[`${prefix}_SLACK_BOT_TOKEN`]?.trim();
  const appToken = process.env[`${prefix}_SLACK_APP_TOKEN`]?.trim();
  if (!botToken || !appToken) {
    results.push({ role, configured: false, botAuthenticated: false, appAuthenticated: false, expectedUserId: profile.expectedUserId || null });
    continue;
  }
  const [bot, app] = await Promise.all([slack("auth.test", botToken), slack("apps.connections.open", appToken)]);
  results.push({
    role,
    configured: true,
    botAuthenticated: bot.httpOk && bot.ok,
    appAuthenticated: app.httpOk && app.ok,
    userId: bot.userId,
    expectedUserId: profile.expectedUserId || null,
    identityMatches: Boolean(profile.expectedUserId) && bot.userId === profile.expectedUserId,
    botError: bot.error,
    appError: app.error,
  });
}

console.log(JSON.stringify(results, null, 2));
if (results.some((item) => !item.configured || !item.botAuthenticated || !item.appAuthenticated || !item.identityMatches)) process.exitCode = 1;
