import type { NodeTypeDef } from "./types";
import ParamsFallbackForm from "./forms/ParamsFallbackForm";
import HttpNodeForm from "./forms/HttpNodeForm";
import OpenAINodeForm from "./forms/OpenAINodeForm";
import ForeachNodeForm from "./forms/ForeachNodeForm";
import LogNodeForm from "./forms/LogNodeForm";
import AiSummarizeNodeForm from "./forms/AiSummarizeNodeForm";
import IfNodeForm from "./forms/IfNodeForm";
import DelayNodeForm from "./forms/DelayNodeForm";
import EmailNodeForm from "./forms/EmailNodeForm";
import SlackNodeForm from "./forms/SlackNodeForm";

function defaultSummary(params: Record<string, unknown>, parts: string[]): string {
  const out: string[] = [];
  for (const key of parts) {
    const v = params?.[key];
    if (v !== undefined && v !== null && v !== "") {
      out.push(String(v).slice(0, 40));
    }
  }
  return out.join(" · ") || "—";
}

const registry: Record<string, NodeTypeDef> = {
  http: {
    type: "http",
    label: "HTTP Request",
    icon: "🌐",
    description: "Make an HTTP request to external APIs.",
    category: "data",
    formComponent: HttpNodeForm,
    fieldHelp: {
      url: "Full URL to request. Use {{ variable.path }} for dynamic values.",
      method: "HTTP method.",
      body: "Request body (JSON). Variables are resolved before sending.",
    },
    validateParams: (p) => {
      const err: Record<string, string> = {};
      if (!p?.url || String(p.url).trim() === "") err.url = "URL is required";
      return err;
    },
    getSummary: (p) => {
      const method = (p?.method as string) || "GET";
      const url = (p?.url as string) || "";
      return `${method} ${url.slice(0, 50)}${url.length > 50 ? "…" : ""}`;
    },
  },
  openai: {
    type: "openai",
    label: "OpenAI",
    icon: "🤖",
    description: "Calls OpenAI API to generate text, analyze data, or produce structured output.",
    category: "ai",
    formComponent: OpenAINodeForm,
    examplePrompt: "Summarize the following:\n\nTitle: {{ fetchPost.output.title }}\n\nBody: {{ fetchPost.output.body }}",
    fieldHelp: {
      prompt: "Instructions sent to the AI model. Use {{ variable.path }} to reference previous step outputs.",
      temperature: "Controls randomness (0 = deterministic, 2 = very random).",
      maxTokens: "Maximum length of the generated response.",
      output_format: "Text, JSON, or array structure for the model output.",
      model: "OpenAI model to use (e.g. gpt-4, gpt-4o-mini).",
    },
    validateParams: (p) => {
      const err: Record<string, string> = {};
      if (!p?.prompt || String(p.prompt).trim() === "") err.prompt = "Prompt is required";
      return err;
    },
    getSummary: (p) => {
      const model = (p?.model as string) || "gpt-4";
      const prompt = (p?.prompt as string) || "";
      return `Model: ${model}. ${prompt.slice(0, 30)}${prompt.length > 30 ? "…" : ""}`;
    },
  },
  ai: {
    type: "ai",
    label: "OpenAI",
    icon: "🤖",
    description: "Calls OpenAI API to generate text, analyze data, or produce structured output.",
    category: "ai",
    formComponent: OpenAINodeForm,
    examplePrompt: "Summarize the following:\n\nTitle: {{ fetchPost.output.title }}\n\nBody: {{ fetchPost.output.body }}",
    fieldHelp: {
      prompt: "Instructions sent to the AI model. Use {{ variable.path }} to reference previous step outputs.",
      temperature: "Controls randomness (0 = deterministic, 2 = very random).",
      maxTokens: "Maximum length of the generated response.",
      output_format: "Text, JSON, or array structure for the model output.",
      model: "OpenAI model to use (e.g. gpt-4, gpt-4o-mini).",
    },
    validateParams: (p) => {
      const err: Record<string, string> = {};
      if (!p?.prompt || String(p.prompt).trim() === "") err.prompt = "Prompt is required";
      return err;
    },
    getSummary: (p) => {
      const model = (p?.model as string) || "gpt-4";
      const prompt = (p?.prompt as string) || "";
      return `Model: ${model}. ${prompt.slice(0, 30)}${prompt.length > 30 ? "…" : ""}`;
    },
  },
  log: {
    type: "log",
    label: "Log",
    icon: "📋",
    description: "Log a message to the console (variables resolved before execution).",
    category: "utilities",
    formComponent: LogNodeForm,
    getSummary: (p) => (p?.message as string) ? String(p.message).slice(0, 50) : "—",
  },
  delay: {
    type: "delay",
    label: "Delay",
    icon: "⏱",
    description: "Wait for a specified time before continuing.",
    category: "control",
    formComponent: DelayNodeForm,
    getSummary: (p) => {
      const ms = p?.ms ?? 0;
      return ms ? `${ms} ms` : "—";
    },
  },
  foreach: {
    type: "foreach",
    label: "Foreach",
    icon: "🔄",
    description: "Iterate over an array and run steps for each item.",
    category: "control",
    formComponent: ForeachNodeForm,
    fieldHelp: {
      items: "Variable path that resolves to an array (e.g. {{ trigger.items }} or {{ steps.fetch.output.data }}).",
      itemVariableName: "Name used for the current item in child steps (e.g. loop.item).",
    },
    validateParams: (p) => {
      const err: Record<string, string> = {};
      if (!p?.items || String(p.items).trim() === "") err.items = "Items path is required";
      return err;
    },
    getSummary: (p) => (p?.items as string) ? String(p.items).slice(0, 40) : "—",
  },
  if: {
    type: "if",
    label: "IF",
    icon: "◇",
    description: "Conditional branch based on an expression.",
    category: "control",
    formComponent: IfNodeForm,
    fieldHelp: {
      condition: "Expression or variable that evaluates to truthy/falsy (e.g. {{ trigger.flag }}).",
    },
    validateParams: (p) => {
      const err: Record<string, string> = {};
      if (!p?.condition || String(p.condition).trim() === "") err.condition = "Condition is required";
      return err;
    },
    getSummary: (p) => (p?.condition as string) ? String(p.condition).slice(0, 35) : "—",
  },
  email: {
    type: "email",
    label: "Email",
    icon: "✉",
    description: "Send an email.",
    category: "utilities",
    formComponent: EmailNodeForm,
    validateParams: (p) => {
      const err: Record<string, string> = {};
      if (!p?.to || String(p.to).trim() === "") err.to = "To is required";
      return err;
    },
    getSummary: (p) => (p?.to as string) ? String(p.to).slice(0, 40) : "—",
  },
  slack: {
    type: "slack",
    label: "Slack",
    icon: "💬",
    description: "Send a message to a Slack channel.",
    category: "utilities",
    formComponent: SlackNodeForm,
    validateParams: (p) => {
      const err: Record<string, string> = {};
      if (!p?.channel || String(p.channel).trim() === "") err.channel = "Channel is required";
      return err;
    },
    getSummary: (p) => (p?.channel as string) ? `#${String(p.channel)}` : "—",
  },
  "ai.summarize": {
    type: "ai.summarize",
    label: "AI Summarize",
    icon: "📝",
    description: "Summarize text or previous step output.",
    category: "ai",
    formComponent: AiSummarizeNodeForm,
    examplePrompt: "Summarize the following:\n\n{{ previousStep.output }}",
    fieldHelp: {
      text: "Text to summarize. Leave empty to use the previous step output.",
      maxLength: "Maximum length of the summary.",
    },
    getSummary: (p) => (p?.text as string) ? String(p.text).slice(0, 40) : "Summarize previous output",
  },
};

export function getNodeType(type: string): NodeTypeDef | undefined {
  return registry[type];
}

export function getNodeTypesByCategory(): Record<string, NodeTypeDef[]> {
  const byCategory: Record<string, NodeTypeDef[]> = {
    ai: [],
    data: [],
    control: [],
    utilities: [],
  };
  for (const def of Object.values(registry)) {
    byCategory[def.category].push(def);
  }
  return byCategory;
}

export function getFormComponent(type: string): NodeTypeDef["formComponent"] {
  return registry[type]?.formComponent ?? ParamsFallbackForm;
}

export function getNodeSummary(type: string, params: Record<string, unknown>): string {
  const def = registry[type];
  if (def?.getSummary) return def.getSummary(params ?? {});
  return defaultSummary(params ?? {}, ["message", "prompt", "url", "text"]);
}

export function validateNodeParams(type: string, params: Record<string, unknown>): Record<string, string> {
  const def = registry[type];
  if (def?.validateParams) return def.validateParams(params ?? {});
  return {};
}

export { registry as nodeRegistry };
export type { NodeTypeDef };
