import axios from "axios";
import { normalizeAIOutput } from "../utils/normalizeAIOutput.js";

const DEFAULT_MODEL = process.env.OPENAI_DEFAULT_MODEL || "gpt-4";
const BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const API_KEY = process.env.OPENAI_API_KEY || "";

const MODE_PROMPTS = {
  summarize: "Summarize the following content clearly and concisely.\n\n",
  generate: "Generate content based on the following instructions.\n\n",
  extract: "Extract the requested fields into a strict JSON object or array. Return ONLY valid JSON, no extra text or markdown.\n\n",
};

const LANGUAGE_NAMES = { tr: "Turkish", en: "English", de: "German" };

const FORMAT_INSTRUCTIONS = {
  text: "",
  json: "Return valid JSON only, no other text.\n\n",
  bullet: "Format the response as bullet points.\n\n",
  markdown: "Format the response in Markdown.\n\n",
};

const TONE_INSTRUCTIONS = {
  formal: "Use a formal tone.\n\n",
  casual: "Use a casual tone.\n\n",
  professional: "Use a professional tone.\n\n",
};

function buildUserContent(params) {
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
  const mode = params?.mode || "generate";
  if (mode === "extract") {
    parts.push(FORMAT_INSTRUCTIONS.json);
  } else if (FORMAT_INSTRUCTIONS[format]) {
    parts.push(FORMAT_INSTRUCTIONS[format]);
  }
  const modePrefix = MODE_PROMPTS[mode] || "";
  let prompt = String(params?.prompt ?? "").trim();
  if (modePrefix && !prompt.startsWith(modePrefix)) {
    parts.push(modePrefix);
  }
  parts.push(prompt || "");
  return parts.join("").trim();
}

export default {
  type: "openai",
  label: "OpenAI",
  category: "ai",
  credentials: [{ type: "openai", required: false }],
  schema: [
    {
      key: "mode",
      type: "select",
      label: "Mode",
      default: "generate",
      options: [
        { value: "summarize", label: "Summarize" },
        { value: "generate", label: "Generate" },
        { value: "extract", label: "Extract (JSON)" },
      ],
    },
    { key: "prompt", type: "string", label: "Prompt", required: true, placeholder: "Enter your prompt..." },
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
    { key: "systemPrompt", type: "string", label: "System prompt", placeholder: "Optional system instructions for the model" },
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
    { key: "model", type: "string", label: "Model", default: DEFAULT_MODEL, placeholder: "gpt-4" },
    { key: "temperature", type: "number", label: "Temperature", default: 0.7 },
    { key: "maxTokens", type: "number", label: "Max tokens", default: 1024 },
    { key: "apiKey", type: "string", label: "API Key", placeholder: "Or use credential / OPENAI_API_KEY env" },
  ],
  output: {
    type: "object",
    properties: {
      output: { description: "Model response (text or parsed JSON/array)" },
    },
  },
  executor: async ({ params, previousOutput, signal }) => {
    const mode = params?.mode || "generate";
    const model = params?.model ?? DEFAULT_MODEL;
    const temperature = params?.temperature ?? 0.7;
    const maxTokens = params?.maxTokens ?? 1024;
    const apiKey = params?.apiKey ?? API_KEY;

    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set or credential apiKey not provided");
    }

    const userContent = buildUserContent(params);
    const systemContent = (params?.systemPrompt && String(params.systemPrompt).trim()) || null;
    const messages = [];
    if (systemContent) messages.push({ role: "system", content: systemContent });
    messages.push({ role: "user", content: userContent });

    const url = `${BASE_URL.replace(/\/$/, "")}/chat/completions`;
    const payload = {
      model,
      messages,
      temperature: Math.max(0, Math.min(2, temperature)),
      max_tokens: Math.max(1, Math.min(4096, maxTokens)),
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

    if (response.status !== 200) {
      const errMsg = response.data?.error?.message || response.statusText || `HTTP ${response.status}`;
      throw new Error(`OpenAI API error: ${errMsg}`);
    }

    const choice = response.data?.choices?.[0];
    const text = (choice?.message?.content ?? choice?.text ?? "").trim();
    const usage = response.data?.usage;

    const tokens = usage
      ? {
          prompt: usage.prompt_tokens,
          completion: usage.completion_tokens,
          total: usage.total_tokens,
        }
      : undefined;

    const format = params?.format || "text";
    const strictJson = mode === "extract" || format === "json";

    let output;

    if (strictJson) {
      try {
        const firstBrace = text.indexOf("{");
        const firstBracket = text.indexOf("[");
        let jsonStr = text;
        if (firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)) {
          const end = text.lastIndexOf("}");
          jsonStr = end > firstBrace ? text.slice(firstBrace, end + 1) : text.slice(firstBrace);
        } else if (firstBracket >= 0) {
          const end = text.lastIndexOf("]");
          jsonStr = end > firstBracket ? text.slice(firstBracket, end + 1) : text.slice(firstBracket);
        }
        output = JSON.parse(jsonStr);
        if (!output || typeof output !== "object") {
          throw new Error("Invalid JSON structure");
        }
      } catch (e) {
        console.log("[AI ERROR] Invalid JSON:", text);
        throw new Error(
          mode === "extract"
            ? "Invalid JSON response from AI"
            : "AI did not return valid JSON"
        );
      }
    } else {
      const trimmed = String(text).trim();
      if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        try {
          output = JSON.parse(text);
        } catch {
          output = text;
        }
      } else {
        const arrayMatch = text.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          try {
            output = JSON.parse(arrayMatch[0]);
          } catch {
            output = text;
          }
        }
      }
      output = normalizeAIOutput(output ?? text, { logger: (msg) => console.log(msg) });
    }

    return { success: true, output, meta: tokens ? { tokens } : {} };
  },
  validate: (params) => {
    const err = {};
    if (!params?.prompt || String(params.prompt).trim() === "") err.prompt = "Prompt is required";
    return err;
  },
  summaryTemplate: "{{ model }} {{ prompt }}",
};
