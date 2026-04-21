function baseLog(level, event, payload = {}) {
  const line = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...payload,
  };
  const text = JSON.stringify(line);
  if (level === "error") {
    console.error(text);
    return;
  }
  if (level === "warn") {
    console.warn(text);
    return;
  }
  console.log(text);
}

export function logInfo(event, payload) {
  baseLog("info", event, payload);
}

export function logWarn(event, payload) {
  baseLog("warn", event, payload);
}

export function logError(event, payload) {
  baseLog("error", event, payload);
}
