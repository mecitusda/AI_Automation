import axios from "axios";

const BASE = "https://api.telegram.org";

function buildUrl(botToken, method) {
  return `${BASE}/bot${botToken}/${method}`;
}

export async function callTelegramBotApi({ botToken, method, payload, signal }) {
  const url = buildUrl(botToken, method);
  const response = await axios.post(url, payload ?? {}, {
    signal,
    validateStatus: () => true
  });
  const data = response?.data;
  if (!data || data.ok !== true) {
    const desc = data?.description || `HTTP ${response.status}`;
    const errorCode = data?.error_code;
    const text = errorCode ? `Telegram API ${errorCode}: ${desc}` : `Telegram API error: ${desc}`;
    return {
      success: false,
      output: { status: response.status, data },
      meta: { status: response.status, errorMessage: text }
    };
  }
  return {
    success: true,
    output: data.result,
    meta: { status: response.status }
  };
}
