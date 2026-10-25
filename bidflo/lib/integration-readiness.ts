import { slackDeliveryConfigured } from "./slack-alerts";
import { resolveSubmissionBridge } from "./submission-bridge";

type Environment = Record<string, string | undefined>;

function present(value: string | undefined) {
  return Boolean(value?.trim());
}

function httpsUrl(value: string | undefined) {
  try { return Boolean(value && new URL(value).protocol === "https:"); } catch { return false; }
}

export function integrationReadiness(env: Environment) {
  const aiConfigured = (present(env.AI_API_KEY) || present(env.OPENAI_API_KEY)) && present(env.AI_MODEL) && httpsUrl(env.AI_API_BASE_URL ?? "https://api.openai.com/v1");
  const allowedSenders = (env.UPWORK_ALLOWED_SENDERS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const emailIntakeConfigured = present(env.RESEND_API_KEY) && present(env.RESEND_WEBHOOK_SECRET) && allowedSenders.length > 0;
  const ownerEmailConfigured = present(env.RESEND_API_KEY) && present(env.BIDFLO_OWNER_EMAIL) && present(env.BIDFLO_EMAIL_FROM);
  const authDisabled = env.BIDFLO_AUTH_DISABLED === "true";
  const submission = resolveSubmissionBridge({
    UPWORK_SUBMISSION_BRIDGE_ENABLED: env.UPWORK_SUBMISSION_BRIDGE_ENABLED,
    UPWORK_SUBMISSION_WEBHOOK_URL: env.UPWORK_SUBMISSION_WEBHOOK_URL,
    UPWORK_SUBMISSION_TOKEN: env.UPWORK_SUBMISSION_TOKEN,
  }, authDisabled);

  return {
    database: { ready: present(env.DATABASE_URL), missing: present(env.DATABASE_URL) ? [] : ["DATABASE_URL"] },
    ai: { ready: aiConfigured, missing: aiConfigured ? [] : ["valid AI_API_KEY (or OPENAI_API_KEY), AI_MODEL, and HTTPS AI_API_BASE_URL"] },
    upworkEmailIntake: { ready: emailIntakeConfigured, missing: emailIntakeConfigured ? [] : ["RESEND_API_KEY, RESEND_WEBHOOK_SECRET, and UPWORK_ALLOWED_SENDERS"] },
    ownerEmail: { ready: ownerEmailConfigured, missing: ownerEmailConfigured ? [] : ["RESEND_API_KEY, BIDFLO_OWNER_EMAIL, and BIDFLO_EMAIL_FROM"] },
    slack: { ready: slackDeliveryConfigured(env), missing: slackDeliveryConfigured(env) ? [] : ["Slack bot + destination or private webhook"] },
    upworkSubmission: {
      ready: submission.mode === "enabled",
      mode: submission.mode,
      detail: submission.mode === "error" ? submission.error : submission.mode === "manual" ? submission.reason : "Authorized bridge configured",
    },
    authentication: {
      ready: !authDisabled && present(env.NEON_AUTH_BASE_URL) && present(env.NEON_AUTH_COOKIE_SECRET),
      detail: authDisabled ? "Disabled for the internal test by operator request" : "Enabled",
    },
  };
}
