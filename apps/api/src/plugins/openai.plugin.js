import axios from "axios";
import { normalizeAIOutput } from "../utils/normalizeAIOutput.js";

const DEFAULT_MODEL = process.env.OPENAI_DEFAULT_MODEL || "gpt-4";
const BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const API_KEY = process.env.OPENAI_API_KEY || "";

export default {
  type: "openai",
  label: "OpenAI",
  category: "ai",
  credentials: [{ type: "openai", required: false }],
  schema: [
    { key: "prompt", type: "string", label: "Prompt", required: true, placeholder: "Enter your prompt..." },
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
    const prompt = params?.prompt ?? "";
    const model = params?.model ?? DEFAULT_MODEL;
    const temperature = params?.temperature ?? 0.7;
    const maxTokens = params?.maxTokens ?? 1024;
    const apiKey = params?.apiKey ?? API_KEY;

    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set or credential apiKey not provided");
    }

    const url = `${BASE_URL.replace(/\/$/, "")}/chat/completions`;
    const payload = {
      model,
      messages: [{ role: "user", content: prompt }],
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
    const text = choice?.message?.content ?? choice?.text ?? "";
    let output = text;
    const trimmed = String(text).trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        output = JSON.parse(text);
      } catch {
        // leave as string
      }
    } else {
      const arrayMatch = text.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try {
          output = JSON.parse(arrayMatch[0]);
        } catch {
          // leave as string
        }
      }
    }
    output = normalizeAIOutput(output, { logger: (msg) => console.log(msg) });

    return { success: true, output };
  },
  validate: (params) => {
    const err = {};
    if (!params?.prompt || String(params.prompt).trim() === "") err.prompt = "Prompt is required";
    return err;
  },
  summaryTemplate: "{{ model }} {{ prompt }}",
};
