import { resolveVariables } from "./variableResolver.js";

/* ---------------- VALUE PARSER ---------------- */

function stripQuotes(s) {
  const t = String(s).trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
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

  try {
    if (t.startsWith("[") || t.startsWith("{")) {
      return JSON.parse(t);
    }
  } catch {}

  return stripQuotes(t);
}

/* ---------------- FUNCTIONS ---------------- */

function evalFunction(expr) {

  const fnMatch = expr.match(/^(\w+)\((.*)\)$/);
  if (!fnMatch) return expr;

  const fn = fnMatch[1];
  const arg = parseValue(fnMatch[2]);

  switch (fn) {

    case "len":
      if (Array.isArray(arg) || typeof arg === "string") {
        return arg.length;
      }
      return 0;

    case "lower":
      return String(arg).toLowerCase();

    case "upper":
      return String(arg).toUpperCase();

    case "now":
      return Date.now();

    case "str":
      return String(arg);

    case "num":
      return Number(arg);

    default:
      return expr;
  }
}

/* ---------------- OPERATORS ---------------- */

function contains(a, b) {
  if (typeof a === "string") return a.includes(b);
  if (Array.isArray(a)) return a.includes(b);
  return false;
}

function startsWith(a, b) {
  if (typeof a === "string") return a.startsWith(b);
  return false;
}

function endsWith(a, b) {
  if (typeof a === "string") return a.endsWith(b);
  return false;
}

function inOperator(a, b) {
  if (Array.isArray(b)) return b.includes(a);
  return false;
}

/* ---------------- SINGLE CONDITION ---------------- */

function evalSingle(expr) {

  const s = expr.trim();

  if (s.startsWith("!")) {
    const inner = s.slice(1).trim();
    return !Boolean(parseValue(inner));
  }

  const m = s.match(
    /^(.*?)(==|!=|>=|<=|>|<|contains|startsWith|endsWith|in)(.*)$/
  );

  if (!m) {
    return Boolean(parseValue(s));
  }

  let left = evalFunction(m[1].trim());
  let right = evalFunction(m[3].trim());

  left = parseValue(left);
  right = parseValue(right);

  const op = m[2];

  switch (op) {

    case "==":
      return left == right;

    case "!=":
      return left != right;

    case ">":
      return Number(left) > Number(right);

    case "<":
      return Number(left) < Number(right);

    case ">=":
      return Number(left) >= Number(right);

    case "<=":
      return Number(left) <= Number(right);

    case "contains":
      return contains(left, right);

    case "startsWith":
      return startsWith(left, right);

    case "endsWith":
      return endsWith(left, right);

    case "in":
      return inOperator(left, right);

    default:
      return false;
  }
}

/* ---------------- MAIN ENGINE ---------------- */

export function evalCondition(conditionExpr, context) {

  const resolved = resolveVariables(conditionExpr, context);
  const expr = String(resolved).trim();

  /* OR */

  const orParts = expr.split(/\s*\|\|\s*/);
  if (orParts.length > 1) {
    return orParts.some(part => evalCondition(part, context));
  }

  /* AND */

  const andParts = expr.split(/\s*&&\s*/);
  if (andParts.length > 1) {
    return andParts.every(part => evalCondition(part, context));
  }

  /* SINGLE */

  return evalSingle(expr);
}