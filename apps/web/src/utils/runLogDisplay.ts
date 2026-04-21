/**
 * Avoid duplicating the same text: orchestrator often sets `message` to
 * `[STEP FAIL] id: ${err}` and `error` to the same `err`, which would render twice.
 */
export function shouldShowSeparateLogError(
  message: string | undefined,
  error: string | undefined
): boolean {
  const err = error?.trim();
  if (!err) return false;
  const msg = message ?? "";
  if (err === msg) return false;
  if (msg.includes(err)) return false;
  return true;
}
