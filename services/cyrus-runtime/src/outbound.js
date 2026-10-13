import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : "";
}

export function emailFingerprint(value) {
  const email = normalizeEmail(value);
  return email ? createHash("sha256").update(email).digest("hex") : "";
}

export function createUnsubscribeToken(emailValue, secret) {
  const fingerprint = emailFingerprint(emailValue);
  if (!fingerprint || !secret) throw new Error("unsubscribe_token_configuration_missing");
  const signature = createHmac("sha256", secret).update(fingerprint).digest("base64url");
  return `${fingerprint}.${signature}`;
}

export function verifyUnsubscribeToken(tokenValue, secret) {
  const [fingerprint, supplied, extra] = String(tokenValue || "").split(".");
  if (!/^[a-f0-9]{64}$/.test(fingerprint || "") || !supplied || extra || !secret) return null;
  const expected = createHmac("sha256", secret).update(fingerprint).digest();
  let actual;
  try { actual = Buffer.from(supplied, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return fingerprint;
}

function parseJwtClaims(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) throw new Error("Microsoft identity returned an invalid access token");
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); }
  catch { throw new Error("Microsoft identity returned unreadable token claims"); }
}

function graphConfig(config) {
  return {
    tenantId: String(config.microsoftGraphTenantId || "").trim(),
    clientId: String(config.microsoftGraphClientId || "").trim(),
    clientSecret: String(config.microsoftGraphClientSecret || "").trim(),
    sender: normalizeEmail(config.microsoftGraphSender),
  };
}

function mimeBase64(value) {
  return Buffer.from(String(value), "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
}

function configurationGaps(config) {
  const value = graphConfig(config);
  return Object.entries(value).filter(([, item]) => !item).map(([name]) => name);
}

async function readError(response) {
  const body = await response.json().catch(() => ({}));
  return String(body?.error_description || body?.error?.message || body?.error || `HTTP ${response.status}`).slice(0, 240);
}

export function createMicrosoftGraphTransport({ config, fetchImpl = fetch }) {
  let cachedToken = null;
  let cachedUntil = 0;

  async function accessToken({ force = false } = {}) {
    const gaps = configurationGaps(config);
    if (gaps.length) throw new Error(`Microsoft Graph configuration missing: ${gaps.join(", ")}`);
    if (!force && cachedToken && Date.now() < cachedUntil) return cachedToken;
    const graph = graphConfig(config);
    const response = await fetchImpl(
      `https://login.microsoftonline.com/${encodeURIComponent(graph.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          client_id: graph.clientId,
          client_secret: graph.clientSecret,
          grant_type: "client_credentials",
          scope: "https://graph.microsoft.com/.default",
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error(`Microsoft identity rejected the bot credential (${response.status}): ${await readError(response)}`);
    const body = await response.json();
    const claims = parseJwtClaims(body.access_token);
    if (String(claims.tid || "").toLowerCase() !== graph.tenantId.toLowerCase()) {
      throw new Error("Microsoft identity token tenant does not match the configured tenant");
    }
    const roles = Array.isArray(claims.roles) ? claims.roles : [];
    if (!roles.includes("Mail.Send")) throw new Error("Microsoft Graph application lacks the Mail.Send application role");
    cachedToken = body.access_token;
    cachedUntil = Date.now() + Math.max(60, Number(body.expires_in || 3600) - 120) * 1000;
    return cachedToken;
  }

  async function preflight() {
    if (config.outboundEmailProvider !== "microsoft_graph") {
      throw new Error("Microsoft Graph is not the configured outbound provider");
    }
    const token = await accessToken({ force: true });
    const claims = parseJwtClaims(token);
    return {
      provider: "microsoft_graph",
      tenantMatched: true,
      mailSendAuthorized: true,
      sender: graphConfig(config).sender,
      sendEnabled: Boolean(config.outboundSendEnabled),
      dailyCap: Number(config.outboundDailyCap || 5),
      tokenExpiresAt: claims.exp ? new Date(Number(claims.exp) * 1000).toISOString() : null,
    };
  }

  async function send({ to, subject, text, html, idempotencyKey, unsubscribeUrl, physicalAddress }) {
    if (!config.outboundSendEnabled) throw new Error("Outbound email sending is disabled pending Blair's approved pilot");
    const recipient = normalizeEmail(to);
    if (!recipient) throw new Error("A valid recipient email is required");
    if (!String(subject || "").trim() || !String(text || "").trim()) throw new Error("Subject and plain-text body are required");
    if (!String(unsubscribeUrl || "").startsWith("https://")) throw new Error("A valid HTTPS unsubscribe URL is required");
    if (!String(physicalAddress || "").trim()) throw new Error("A physical mailing address is required");
    const token = await accessToken();
    const sender = graphConfig(config).sender;
    const footerText = `\n\nAtlasium 7/88 | ${physicalAddress}\nUnsubscribe: ${unsubscribeUrl}`;
    const footerHtml = `<p style="font-size:12px;line-height:18px;color:#666666">Atlasium 7/88 | ${escapeHtml(physicalAddress)}<br><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a></p>`;
    const safeSubject = String(subject).replace(/[\r\n]+/g, " ").trim().slice(0, 200);
    const boundary = `command88-${String(idempotencyKey || "message").replace(/[^a-zA-Z0-9]/g, "").slice(0, 40)}`;
    const textContent = `${String(text)}${footerText}`;
    const htmlContent = html
      ? `${String(html)}${footerHtml}`
      : `<div>${escapeHtml(String(text)).replaceAll("\n", "<br>")}</div>${footerHtml}`;
    const mime = [
      `From: Atlasium 7/88 <${sender}>`,
      `To: ${recipient}`,
      `Subject: =?UTF-8?B?${Buffer.from(safeSubject, "utf8").toString("base64")}?=`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      `Message-ID: <command88.${String(idempotencyKey).slice(0, 48)}@atlasium788.ca>`,
      `X-Command88-Idempotency-Key: ${idempotencyKey}`,
      `List-Unsubscribe: <${unsubscribeUrl}>`,
      "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      mimeBase64(textContent),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      mimeBase64(htmlContent),
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const response = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "text/plain", accept: "application/json" },
      body: Buffer.from(mime, "utf8").toString("base64"),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status !== 202) {
      throw new Error(`Microsoft Graph send was not accepted (${response.status}): ${await readError(response)}`);
    }
    return {
      accepted: true,
      provider: "microsoft_graph",
      requestId: response.headers.get("request-id") || response.headers.get("client-request-id") || null,
      status: 202,
    };
  }

  return { preflight, send, configurationGaps: () => configurationGaps(config) };
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
