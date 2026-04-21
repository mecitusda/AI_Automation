import nodemailer from "nodemailer";
import { promises as dns } from "dns";

/** Basic email format: local@domain.tld */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new Error("Aborted");
  }
}

async function raceWithAbort(promise, signal) {
  if (!signal) return promise;
  throwIfAborted(signal);
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    })
  ]);
}

/** Check if recipient domain can receive email (MX or A record exists) */
async function validateRecipientDomain(email) {
  const emails = String(email).trim().split(/[\s,;]+/).filter(Boolean);
  for (const addr of emails) {
    if (!EMAIL_REGEX.test(addr)) return { ok: false, reason: `Invalid email format: ${addr}` };
    const match = addr.match(/@([^\s@]+)$/);
    const domain = match?.[1];
    if (!domain || domain.length < 4) return { ok: false, reason: `Invalid email format: ${addr}` };

    try {
      const mx = await dns.resolveMx(domain);
      if (Array.isArray(mx) && mx.length > 0) continue;
      const a = await dns.resolve4(domain).catch(() => []);
      if (Array.isArray(a) && a.length > 0) continue;
      return { ok: false, reason: `Domain "${domain}" has no mail servers. Check: ${addr}` };
    } catch (err) {
      if (err?.code === "ENOTFOUND" || err?.code === "ENODATA") {
        return { ok: false, reason: `Domain "${domain}" not found. Email may be wrong (typo?): ${addr}` };
      }
      return { ok: false, reason: err?.message || String(err) };
    }
  }
  return { ok: true };
}

function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  // Port 587 = STARTTLS (secure: false). Port 465 = implicit SSL (secure: true).
  const secureEnv = process.env.SMTP_SECURE;
  const secure = secureEnv !== undefined && secureEnv !== ""
    ? (secureEnv === "true" || secureEnv === "1")
    : port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
}



export default {
  type: "email",
  label: "Email",
  category: "utilities",
  schema: [
    { key: "to", type: "string", label: "To", required: true, placeholder: "user@example.com or {{ loop.item.email }}" },
    { key: "subject", type: "string", label: "Subject", placeholder: "Subject" },
    { key: "body", type: "string", label: "Body", placeholder: "Body (supports {{ variables }})" },
  ],
  output: {
    type: "object",
    properties: {
      sent: { type: "boolean" },
      to: { type: "string" },
      subject: { type: "string" },
      bodyLength: { type: "number" },
    },
  },
  executor: async ({ params, signal }) => {
    throwIfAborted(signal);
    const rawTo = params?.to;
    const to = typeof rawTo === "string"
      ? rawTo.trim()
      : (rawTo && typeof rawTo === "object" && typeof rawTo.email === "string"
        ? rawTo.email.trim()
        : String(rawTo ?? "").trim());
    const subject = String(params?.subject ?? "").trim();
    const body = String(params?.body ?? "");
    if (!to || to === "[object Object]") throw new Error("email step requires params.to as a string or object with .email (e.g. {{ loop.item.email }})");

    const transport = getTransport();
    if (!transport) {
      return {
        success: false,
        output: null,
        meta: {
          errorMessage: "SMTP not configured: set SMTP_HOST, SMTP_USER, SMTP_PASS (or SMTP_PASSWORD) in environment",
        },
      };
    }

    const domainCheck = await validateRecipientDomain(to);
    throwIfAborted(signal);
    if (!domainCheck.ok) {
      return {
        success: false,
        output: null,
        meta: { errorMessage: domainCheck.reason },
      };
    }

    try {
      await raceWithAbort(transport.verify(), signal);
    } catch (err) {
      const msg = err?.message || String(err);
      return {
        success: false,
        output: null,
        meta: {
          errorMessage: msg.includes("Invalid login") || msg.includes("authentication") || msg.includes("Authentication")
            ? "SMTP authentication failed: check SMTP_USER and SMTP_PASS (use App Password for Gmail)"
            : msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT")
              ? `SMTP connection failed: ${msg}`
              : msg,
        },
      };
    }

    const startAt = Date.now();
    try {
      throwIfAborted(signal);
      const from = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@localhost";
      const info = await raceWithAbort(transport.sendMail({
        from,
        to,
        subject: subject || "(no subject)",
        text: body,
        html: body ? body.replace(/\n/g, "<br>") : "",
      }), signal);

      const rejected = info?.rejected;
      if (Array.isArray(rejected) && rejected.length > 0) {
        return {
          success: false,
          output: { sent: false, to, subject, bodyLength: body.length, rejected },
          meta: {
            durationMs: Date.now() - startAt,
            errorMessage: `Email rejected by server for recipient(s): ${rejected.join(", ")}`,
          },
        };
      }

      return {
        success: true,
        output: { sent: true, to, subject, bodyLength: body.length, messageId: info?.messageId },
        meta: { durationMs: Date.now() - startAt },
      };
    } catch (err) {
      const msg = err?.message || String(err);
      return {
        success: false,
        output: null,
        meta: {
          durationMs: Date.now() - startAt,
          errorMessage: msg.includes("Invalid login") || msg.includes("authentication") || msg.includes("Authentication")
            ? "SMTP authentication failed: check SMTP_USER and SMTP_PASS (use App Password for Gmail)"
            : msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT")
              ? `SMTP connection failed: ${msg}`
              : msg,
        },
      };
    }
  },
  validate: (params) => {
    const err = {};
    if (!params?.to || String(params.to).trim() === "") err.to = "To is required";
    return err;
  },
};
