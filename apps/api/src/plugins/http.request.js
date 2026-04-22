import axios from "axios";
import { XMLBuilder, XMLParser } from "fast-xml-parser";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: false,
});

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

function parseXmlOrThrow(val) {
  if (val == null) return undefined;
  if (typeof val === "string") {
    const t = val.trim();
    if (!t) return undefined;
    xmlParser.parse(t); // validate
    return val;
  }
  if (typeof val === "object") {
    if (Array.isArray(val)) throw new Error("Invalid XML body: array root is not supported");
    const hasSingleRoot = Object.keys(val).length === 1;
    const payload = hasSingleRoot ? val : { root: val };
    return xmlBuilder.build(payload);
  }
  throw new Error("Invalid XML body");
}

function parseRequestBody(val, mode) {
  const bodyMode = String(mode || "json").toLowerCase();
  if (bodyMode === "raw") return val;
  if (bodyMode === "xml") return parseXmlOrThrow(val);
  if (bodyMode === "text") {
    if (val == null) return "";
    return typeof val === "string" ? val : JSON.stringify(val);
  }
  return parseJsonOrThrow(val);
}

function parseResponseData(data, headers, mode) {
  const parseMode = String(mode || "auto").toLowerCase();
  if (parseMode === "raw") return data;
  if (parseMode === "xml") {
    if (data == null) return data;
    if (typeof data !== "string") return data;
    const t = data.trim();
    if (!t) return null;
    return xmlParser.parse(t);
  }
  if (parseMode === "text") {
    if (typeof data === "string") return data;
    try {
      return JSON.stringify(data);
    } catch {
      return String(data ?? "");
    }
  }
  if (parseMode === "json") {
    if (data == null) return data;
    if (typeof data === "object") return data;
    if (typeof data === "string") {
      const t = data.trim();
      if (!t) return null;
      return JSON.parse(data);
    }
    return data;
  }

  // auto
  if (typeof data === "object" || data == null) return data;
  if (typeof data !== "string") return data;
  const contentType = String(headers?.["content-type"] || headers?.["Content-Type"] || "").toLowerCase();
  const trimmed = data.trim();
  const maybeXml = contentType.includes("xml") || trimmed.startsWith("<?xml") || trimmed.startsWith("<");
  if (maybeXml) {
    try {
      return xmlParser.parse(data);
    } catch {
      return data;
    }
  }

  const maybeJson = contentType.includes("application/json") || trimmed.startsWith("{") || trimmed.startsWith("[");
  if (!maybeJson) return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
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
    {
      key: "bodyParseMode",
      type: "select",
      label: "Body Parse",
      default: "json",
      options: [
        { value: "json", label: "JSON" },
        { value: "xml", label: "XML" },
        { value: "text", label: "Text" },
        { value: "raw", label: "Raw" },
      ],
    },
    {
      key: "responseParseMode",
      type: "select",
      label: "Response Parse",
      default: "auto",
      options: [
        { value: "auto", label: "Auto" },
        { value: "json", label: "JSON" },
        { value: "xml", label: "XML" },
        { value: "text", label: "Text" },
        { value: "raw", label: "Raw" },
      ],
    },
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
    const body = method !== "GET" ? parseRequestBody(params.body, params.bodyParseMode) : undefined;
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
    const parsedData = parseResponseData(response.data, responseHeaders, params.responseParseMode);
    const out = {
      status: response.status,
      data: parsedData,
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
