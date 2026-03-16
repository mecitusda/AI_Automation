import { apiFetch } from "./client";

export type PluginSchemaField = {
  key: string;
  type: "string" | "number" | "boolean" | "select" | "json" | "code" | "variable";
  label: string;
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  options?: { value: string; label: string }[];
};

export type PluginOutputSchema = {
  type?: string;
  properties?: Record<string, unknown>;
  items?: unknown;
};

export type PluginHandleDef = { id: string };

export type PluginHandles = {
  inputs?: PluginHandleDef[];
  outputs?: PluginHandleDef[];
  errorOutput?: boolean;
};

export type PluginCredentialRequirement = {
  type: string;
  required?: boolean;
};

export type PluginInfo = {
  type: string;
  label: string;
  category: string;
  schema?: PluginSchemaField[];
  output?: PluginOutputSchema | null;
  credentials?: PluginCredentialRequirement[];
  handles?: PluginHandles;
  /** Optional template for node preview, e.g. "{{ method }} {{ url }}". Keys are param keys. */
  summaryTemplate?: string | null;
};

export function fetchPlugins(): Promise<PluginInfo[]> {
  return apiFetch<PluginInfo[]>("/plugins");
}

export function fetchPlugin(type: string): Promise<PluginInfo> {
  return apiFetch<PluginInfo>(`/plugins/${encodeURIComponent(type)}`);
}

/**
 * Resolve a summary template string with params.
 * Replaces {{ key }} with params[key]; truncates long values.
 */
export function resolveSummaryTemplate(
  template: string | null | undefined,
  params: Record<string, unknown>
): string {
  if (!template || typeof template !== "string") return "";
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const v = params?.[key];
    if (v === undefined || v === null) return "";
    const s = String(v);
    return s.length > 40 ? s.slice(0, 37) + "…" : s;
  }).trim() || "";
}

/** Client-side validation from plugin schema (required fields). */
export function validateParamsFromSchema(
  schema: PluginSchemaField[] | undefined,
  params: Record<string, unknown>
): Record<string, string> {
  const err: Record<string, string> = {};
  if (!schema) return err;
  for (const field of schema) {
    if (!field.required) continue;
    const v = params?.[field.key];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      err[field.key] = `${field.label} is required`;
    }
  }
  return err;
}
