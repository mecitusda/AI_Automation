import axios from "axios";

function parseMaybeJson(val, fallback) {
  if (val == null) return fallback;
  if (typeof val === "object" && !Array.isArray(val)) return val;
  if (typeof val !== "string") return fallback;
  const t = val.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function parseJsonOrThrow(val) {
  if (val == null) return undefined;
  if (typeof val === "object" && !Array.isArray(val)) return val;
  if (typeof val !== "string") return undefined;
  const t = val.trim();
  if (!t) return undefined;
  if (t[0] !== "{" && t[0] !== "[") return undefined;
  try {
    return JSON.parse(val);
  } catch {
    throw new Error("Invalid JSON in HTTP Request body");
  }
}

function headersToPlainObject(headers) {
  if (headers == null) return {};
  if (typeof headers === "object" && headers.constructor?.name === "AxiosHeaders") {
    return { ...headers };
  }
  if (typeof headers === "object" && !Array.isArray(headers)) return headers;
  return {};
}

/** Short snippet for logs/errors (avoid huge HTML/JSON bodies). */
function summarizeResponseBody(data, max = 1200) {
  if (data == null || data === "") return "";
  if (typeof data === "string") {
    const t = data.trim();
    return t.length > max ? `${t.slice(0, max)}…` : t;
  }
  try {
    const s = JSON.stringify(data);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    const t = String(data);
    return t.length > max ? `${t.slice(0, max)}…` : t;
  }
}

export default {
  type: "http",
  label: "HTTP Request",
  category: "data",
  schema: [
    { key: "url", type: "string", label: "URL", required: true, placeholder: "https://api.example.com/posts" },
    {
      key: "method",
      type: "select",
      label: "Method",
      default: "GET",
      options: [
        { value: "GET", label: "GET" },
        { value: "POST", label: "POST" },
        { value: "PUT", label: "PUT" },
        { value: "PATCH", label: "PATCH" },
        { value: "DELETE", label: "DELETE" },
      ],
    },
    { key: "headers", type: "json", label: "Headers", placeholder: '{"Content-Type": "application/json"}' },
    { key: "query", type: "json", label: "Query params", placeholder: "{}" },
    { key: "body", type: "json", label: "Body", placeholder: "{}" },
  ],
  output: {
    type: "object",
    properties: {
      status: { type: "number" },
      data: {},
      headers: {},
    },
  },
  executor: async ({ params, signal }) => {
    if (!params?.url) {
      throw new Error("URL is required");
    }
    const method = (params.method || "GET").toUpperCase();
    const headers = parseMaybeJson(params.headers, {});
    const query = parseMaybeJson(params.query, {});
    const body = method !== "GET" ? parseJsonOrThrow(params.body) : undefined;
    const url = String(params.url).trim();

    const startAt = Date.now();
    let response;
    try {
      response = await axios({
        url,
        method,
        data: body,
        headers: headers && typeof headers === "object" ? headers : {},
        params: query && Object.keys(query).length > 0 ? query : undefined,
        signal,
        validateStatus: () => true,
      });
    } catch (err) {
      const durationMs = Date.now() - startAt;
      const code = err?.code ? String(err.code) : "";
      const msg = err?.message || String(err);
      const errorMessage = `HTTP request failed${code ? ` (${code})` : ""}: ${msg}`;
      throw new Error(errorMessage);
    }
    const durationMs = Date.now() - startAt;

    const responseHeaders = headersToPlainObject(response.headers);
    const out = {
      status: response.status,
      data: response.data,
      headers: responseHeaders,
    };

    if (response.status >= 400) {
      const snippet = summarizeResponseBody(response.data);
      const errorMessage =
        `HTTP ${response.status} ${method} ${url}` + (snippet ? ` — ${snippet}` : "");
      return {
        success: false,
        output: out,
        meta: { durationMs, status: response.status, errorMessage },
      };
    }
    return {
      success: true,
      output: out,
      meta: { durationMs, status: response.status },
    };
  },
  validate: (params) => {
    const err = {};
    if (!params?.url || String(params.url).trim() === "") err.url = "URL is required";
    return err;
  },
  summaryTemplate: "{{ method }} {{ url }}",
};
