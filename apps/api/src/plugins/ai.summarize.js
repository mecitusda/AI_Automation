import axios from "axios";

const BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const API_KEY = process.env.OPENAI_API_KEY || "";
const DEFAULT_MODEL = process.env.OPENAI_DEFAULT_MODEL || "gpt-4o-mini";

const LANGUAGE_NAMES = { tr: "Turkish", en: "English", de: "German" };
const FORMAT_INSTRUCTIONS = {
  text: "",
  json: "Return the summary as valid JSON only (e.g. {\"summary\": \"...\"}).\n\n",
  bullet: "Format the summary as bullet points.\n\n",
  markdown: "Format the summary in Markdown.\n\n",
};
const TONE_INSTRUCTIONS = {
  formal: "Use a formal tone.\n\n",
  casual: "Use a casual tone.\n\n",
  professional: "Use a professional tone.\n\n",
};

/**
 * Downstream steps should use {{ steps.<stepId>.output.summary }} (not {{ steps.<stepId>.output }}).
 */
function toReadableString(value) {
  if (value == null) return "Nothing to summarize";
  if (typeof value === "string") return value.trim() || "Nothing to summarize";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildSummarizePrompt(params, content) {
  const parts = [];
  const language = params?.language || "auto";
  if (language !== "auto" && LANGUAGE_NAMES[language]) {
    parts.push(`Respond in ${LANGUAGE_NAMES[language]}.\n\n`);
  }
  const tone = params?.tone;
  if (tone && TONE_INSTRUCTIONS[tone]) {
    parts.push(TONE_INSTRUCTIONS[tone]);
  }
  const format = params?.format || "text";
  if (FORMAT_INSTRUCTIONS[format]) {
    parts.push(FORMAT_INSTRUCTIONS[format]);
  }
  parts.push("Summarize the following content clearly and concisely.\n\n");
  parts.push(content);
  const maxLen = params?.maxLength;
  if (typeof maxLen === "number" && maxLen > 0) {
    parts.push(`\n\nKeep the summary under ${maxLen} characters.`);
  }
  return parts.join("").trim();
}

export default {
  type: "ai.summarize",
  label: "AI Summarize",
  category: "ai",
  credentials: [{ type: "openai", required: false }],
  schema: [
    { key: "text", type: "string", label: "Text", placeholder: "Leave empty to use previous step output" },
    { key: "maxLength", type: "number", label: "Max length", default: 200 },
    {
      key: "language",
      type: "select",
      label: "Language",
      default: "auto",
      options: [
        { value: "auto", label: "Auto" },
        { value: "tr", label: "Turkish" },
        { value: "en", label: "English" },
        { value: "de", label: "German" },
      ],
    },
    {
      key: "format",
      type: "select",
      label: "Format",
      default: "text",
      options: [
        { value: "text", label: "Text" },
        { value: "json", label: "JSON" },
        { value: "bullet", label: "Bullet points" },
        { value: "markdown", label: "Markdown" },
      ],
    },
    { key: "systemPrompt", type: "string", label: "System prompt", placeholder: "Optional system instructions" },
    {
      key: "tone",
      type: "select",
      label: "Tone",
      default: "professional",
      options: [
        { value: "formal", label: "Formal" },
        { value: "casual", label: "Casual" },
        { value: "professional", label: "Professional" },
      ],
    },
    { key: "model", type: "string", label: "Model", default: DEFAULT_MODEL, placeholder: "gpt-4o-mini" },
    { key: "maxTokens", type: "number", label: "Max tokens", default: 512 },
  ],
  output: {
    type: "object",
    properties: { summary: { type: "string" } },
  },
  executor: async ({ previousOutput, params, signal }) => {
    if (signal?.aborted) throw new Error("Cancelled");

    const rawInput = params?.text != null && String(params.text).trim() !== ""
      ? params.text
      : previousOutput;
    const content = toReadableString(rawInput);
    const userContent = buildSummarizePrompt(params, content);

    const apiKey = params?.apiKey ?? API_KEY;
    if (!apiKey) {
      throw new Error("OpenAI API key required for AI Summarize. Set OPENAI_API_KEY or use an OpenAI credential.");
    }

    const model = params?.model ?? DEFAULT_MODEL;
    const maxTokens = Math.max(1, Math.min(4096, Number(params?.maxTokens) || 512));
    const systemContent = (params?.systemPrompt && String(params.systemPrompt).trim()) || null;
    const messages = [];
    if (systemContent) messages.push({ role: "system", content: systemContent });
    messages.push({ role: "user", content: userContent });

    const url = `${BASE_URL.replace(/\/$/, "")}/chat/completions`;
    const payload = {
      model,
      messages,
      temperature: 0.3,
      max_tokens: maxTokens,
    };

    const response = await axios({
      method: "POST",
      url,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      data: payload,
      signal,
      validateStatus: () => true,
    });

    if (signal?.aborted) throw new Error("Cancelled");

    if (response.status !== 200) {
      const errMsg = response.data?.error?.message || response.statusText || `HTTP ${response.status}`;
      throw new Error(`OpenAI API error: ${errMsg}`);
    }

    const choice = response.data?.choices?.[0];
    const text = (choice?.message?.content ?? choice?.text ?? "").trim();
    if (!text) {
      throw new Error("Empty summary response from model.");
    }

    const usage = response.data?.usage;
    const tokens = usage
      ? { prompt: usage.prompt_tokens, completion: usage.completion_tokens, total: usage.total_tokens }
      : undefined;

    return { success: true, output: { summary: text }, meta: tokens ? { tokens } : {} };
  },
};
