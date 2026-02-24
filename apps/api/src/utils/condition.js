// utils/condition.js
import { resolveVariables } from "./variableResolver.js";

function stripQuotes(s) {
  const t = String(s).trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseValue(v) {
  const t = String(v).trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (t === "undefined") return undefined;
  if (!Number.isNaN(Number(t)) && t !== "") return Number(t);
  return stripQuotes(t);
}

/**
 * Supported:
 *  - a == b, a != b, a > b, a >= b, a < b, a <= b
 *  - truthy:  {{step1.output.ok}}
 *  - !truthy: !{{step1.output.ok}}
 */
export function evalCondition(conditionExpr, outputsMap) {
  const resolved = resolveVariables(conditionExpr, outputsMap);

  // handle simple negation
  const s = String(resolved).trim();
  if (s.startsWith("!")) {
    const inner = s.slice(1).trim();
    return !Boolean(parseValue(inner));
  }

  // binary operators
  const m = s.match(/^(.*?)(==|!=|>=|<=|>|<)(.*)$/);
  if (!m) {
    // truthy fallback
    return Boolean(parseValue(s));
  }

  const left = parseValue(m[1]);
  const op = m[2];
  const right = parseValue(m[3]);

  switch (op) {
    case "==": return left == right; // intentional loose for string/number convenience
    case "!=": return left != right;
    case ">=": return Number(left) >= Number(right);
    case "<=": return Number(left) <= Number(right);
    case ">": return Number(left) > Number(right);
    case "<": return Number(left) < Number(right);
    default: return false;
  }
}