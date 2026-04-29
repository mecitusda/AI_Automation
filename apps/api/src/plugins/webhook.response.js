export default {
  type: "webhook.response",
  label: "Webhook Response",
  category: "utilities",
  schema: [
    { key: "statusCode", type: "number", label: "Status Code", default: 200 },
    { key: "body", type: "textarea", label: "Body", placeholder: "{\"ok\": true}" },
    { key: "headers", type: "json", label: "Headers", default: {} },
  ],
  output: {
    type: "object",
    properties: {
      statusCode: { type: "number" },
      body: { type: "any" },
      headers: { type: "object" },
    },
  },
  executor: async ({ params }) => {
    const rawStatus = Number(params?.statusCode ?? 200);
    const statusCode = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : 200;
    const headers = params?.headers && typeof params.headers === "object" && !Array.isArray(params.headers)
      ? params.headers
      : {};
    const rawBody = params?.body ?? { ok: true };
    let body = rawBody;
    if (typeof rawBody === "string") {
      const trimmed = rawBody.trim();
      if (trimmed) {
        try {
          body = JSON.parse(trimmed);
        } catch {
          body = rawBody;
        }
      }
    }
    return {
      success: true,
      output: { statusCode, headers, body },
      meta: { response: true },
    };
  },
  summaryTemplate: "{{ statusCode }}",
};
