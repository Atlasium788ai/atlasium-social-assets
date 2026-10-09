const roles = {
  clara: { expectedUserId: "U0C1DES05L5", directSlackRequired: true },
  mateo: { expectedUserId: "U0C2GFE1C9W", directSlackRequired: true },
  kenji: { expectedUserId: "U0C2GFPP7AL", directSlackRequired: true },
  amara: { expectedUserId: "U0C16P5BYAK", directSlackRequired: true },
  nadia: { expectedUserId: "U0C1FU0ANRZ", directSlackRequired: true },
  sloane: { expectedUserId: "", directSlackRequired: false },
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
    results.push({
      role,
      mode: profile.directSlackRequired ? "direct-slack" : "cyrus-mediated",
      directSlackRequired: profile.directSlackRequired,
      configured: false,
      botAuthenticated: false,
      appAuthenticated: false,
      expectedUserId: profile.expectedUserId || null,
      acceptable: !profile.directSlackRequired,
    });
    continue;
  }
  const [bot, app] = await Promise.all([slack("auth.test", botToken), slack("apps.connections.open", appToken)]);
  results.push({
    role,
    mode: "direct-slack",
    directSlackRequired: profile.directSlackRequired,
    configured: true,
    botAuthenticated: bot.httpOk && bot.ok,
    appAuthenticated: app.httpOk && app.ok,
    userId: bot.userId,
    expectedUserId: profile.expectedUserId || null,
    identityMatches: Boolean(profile.expectedUserId) && bot.userId === profile.expectedUserId,
    botError: bot.error,
    appError: app.error,
    acceptable: bot.httpOk && bot.ok && app.httpOk && app.ok && Boolean(profile.expectedUserId) && bot.userId === profile.expectedUserId,
  });
}

console.log(JSON.stringify(results, null, 2));
if (results.some((item) => !item.acceptable)) process.exitCode = 1;
