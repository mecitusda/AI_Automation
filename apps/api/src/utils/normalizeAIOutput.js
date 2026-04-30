/**
 * Normalize AI step output for downstream steps (e.g. foreach).
 * - Parses stringified JSON arrays
 * - Converts bullet/number lists to arrays
 * - Trims strings and removes empty array elements
 */

/**
 * @param {unknown} raw - Raw output from AI (string, array, or other)
 * @param {{ logger?: (msg: string) => void }} options - Optional logger for normalization events
 * @returns {unknown} Normalized value (array when converted, or original)
 */
export function normalizeAIOutput(raw, options = {}) {
  const { logger } = options;

  if (Array.isArray(raw)) {
    const normalized = raw
      .map((item) => (typeof item === "string" ? item.trim() : item))
      .filter((item) => item !== "" && item !== undefined && item !== null);
    return normalized;
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return raw;

    // Try JSON parse (array or object)
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const normalized = parsed
          .map((item) => (typeof item === "string" ? item.trim() : item))
          .filter((item) => item !== "" && item !== undefined && item !== null);
        if (logger) logger("[AI NORMALIZE] Converted AI output to array");
        return normalized;
      }
      return parsed;
    } catch {
      // not JSON
    }

    // Try to extract JSON array from string (e.g. "Here is the list:\n[\"a\", \"b\"]")
    const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed)) {
          const normalized = parsed
            .map((item) => (typeof item === "string" ? item.trim() : item))
            .filter((item) => item !== "" && item !== undefined && item !== null);
          if (logger) logger("[AI NORMALIZE] Converted AI output to array");
          return normalized;
        }
      } catch {
        // ignore
      }
    }

    // Bullet or number list: lines like "1. item", "• item", "- item", "* item".
    // Require whitespace after marker so Markdown bold ("**title**") is not treated as a list item.
    const lines = trimmed.split(/\r?\n/);
    const listItemRegex = /^\s*(?:\d+\.\s+|[•\-]\s+|\*\s+)(.+)$/;
    const hasListPattern = lines.some((line) => listItemRegex.test(line.trim()));
    if (hasListPattern) {
      const extracted = [];
      for (const line of lines) {
        const m = line.trim().match(listItemRegex);
        const content = m ? m[1].trim() : line.trim();
        if (content) extracted.push(content);
      }
      if (extracted.length > 0) {
        if (logger) logger("[AI NORMALIZE] Converted AI output to array");
        return extracted;
      }
    }
  }

  return raw;
}
