import nodemailer from "nodemailer";

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
  executor: async ({ params }) => {
    const rawTo = params?.to;
    const to = typeof rawTo === "string"
      ? rawTo.trim()
      : (rawTo && typeof rawTo === "object" && typeof rawTo.email === "string"
        ? rawTo.email.trim()
        : String(rawTo ?? "").trim());
    const subject = String(params?.subject ?? "").trim();
    const body = String(params?.body ?? "");
    if (!to || to === "[object Object]") throw new Error("email step requires params.to as a string or object with .email (e.g. {{ loop.item.email }})");
    console.log("to", to);
    const transport = getTransport();
    if (transport) {
      const from = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@localhost";
      const info = await transport.sendMail({
        from,
        to,
        subject: subject || "(no subject)",
        text: body,
        html: body ? body.replace(/\n/g, "<br>") : ""
      });
      return {
        success: true,
        output: { sent: true, to, subject, bodyLength: body.length, messageId: info.messageId },
      };
    }

    return {
      success: true,
      output: { sent: true, to, subject, bodyLength: body.length },
    };
  },
  validate: (params) => {
    const err = {};
    if (!params?.to || String(params.to).trim() === "") err.to = "To is required";
    return err;
  },
};
