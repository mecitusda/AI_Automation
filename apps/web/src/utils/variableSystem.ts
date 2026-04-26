/**
 * Reusable variable system for the workflow editor.
 * Used by VariableTree, VariableAutocomplete, OutputStructurePreview, and validation.
 */

import type { PluginOutputSchema } from "../api/plugins";

export type VariableTreeNode = {
  name: string;
  path?: string;
  children?: VariableTreeNode[];
};

type StepsInput = { id: string; type?: string }[];
type RunOutputsByStep = Record<string, unknown>;

/**
 * Typed representation of a variable path.
 *
 * Examples:
 * - "trigger.payload"                  -> { kind: "trigger", segments: ["payload"] }
 * - "steps.fetchPost.output.title"     -> { kind: "step", stepId: "fetchPost", segments: ["output", "title"] }
 * - "loop.item"                        -> { kind: "loop", segments: ["item"] }
 * - "loops.outerLoop.item"             -> { kind: "loops", loopStepId: "outerLoop", segments: ["item"] }
 * - "run.id"                           -> { kind: "run",  segments: ["id"] }
 */
export type VariablePathKind = "trigger" | "step" | "loop" | "loops" | "run" | "error";

export type VariablePath = {
  kind: VariablePathKind;
  stepId?: string;
  loopStepId?: string;
  segments: string[];
};

export type VariableValidationContext = {
  steps: { id: string; type: string }[];
  currentStepId: string;
  /**
   * Optional shape information inferred from previous runs.
   * Map of stepId -> output JSON.
   * This is intentionally loose; validation primarily checks structural existence.
   */
  inferredOutputShapes?: Record<string, unknown>;
};

export type VariableValidationResult = {
  ok: boolean;
  error?: string;
};

/**
 * Parse a dot-separated variable expression into a VariablePath.
 * The expression should NOT include the surrounding {{ }}.
 */
export function parseVariablePath(expr: string): VariablePath | null {
  const raw = expr.trim();
  if (!raw) return null;

  const parts = raw.split(".").filter(Boolean);
  if (parts.length === 0) return null;

  // trigger.payload...
  if (parts[0] === "trigger") {
    return {
      kind: "trigger",
      segments: parts.slice(1),
    };
  }

  // loop.item / loop.index
  if (parts[0] === "loop") {
    return {
      kind: "loop",
      segments: parts.slice(1),
    };
  }

  // loops.loopStepId.item / loops.loopStepId.index
  if (parts[0] === "loops" && parts.length >= 2) {
    return {
      kind: "loops",
      loopStepId: parts[1],
      segments: parts.slice(2),
    };
  }

  // run.id ...
  if (parts[0] === "run") {
    return {
      kind: "run",
      segments: parts.slice(1),
    };
  }

  // error.message / error.stepId ...
  if (parts[0] === "error") {
    return {
      kind: "error",
      segments: parts.slice(1),
    };
  }

  // steps.fetchPost.output.title
  if (parts[0] === "steps" && parts.length >= 2) {
    const stepId = parts[1];
    let segments = parts.slice(2);
    // Normalize legacy array index form: steps.fetchPost.0.output.data.body -> steps.fetchPost.output.data.body
    if (segments.length > 0 && /^\d+$/.test(segments[0])) {
      segments = segments.slice(1);
    }
    return {
      kind: "step",
      stepId,
      segments,
    };
  }

  // Fallback: treat as trigger-relative or invalid; return null so callers can decide.
  return null;
}

const VARIABLE_EXPR_REGEX = /\{\{\s*([^}]+?)\s*\}\}/g;

/**
 * Extract all {{ ... }} variable paths from text.
 * @returns Array of trimmed inner path strings (e.g. ["steps.step_0.output", "loop.item.email"])
 */
export function parseVariables(text: string): string[] {
  if (typeof text !== "string") return [];
  const out: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(VARIABLE_EXPR_REGEX.source, "g");
  while ((match = re.exec(text)) !== null) {
    const inner = match[1]?.trim();
    if (inner) out.push(inner);
  }
  return out;
}

/**
 * Parse a full variable expression like "{{ steps.fetchPost.output.title }}" into VariablePath.
 * Accepts expressions with or without surrounding {{ }}.
 */
export function parseVariableExpression(expr: string): VariablePath | null {
  const trimmed = expr.trim();
  const match = trimmed.match(/^\{\{\s*(.*?)\s*\}\}$/);
  const inner = match ? match[1] : trimmed;
  return parseVariablePath(inner);
}

export type VariableSoftValidationResult = {
  valid: boolean;
  warning?: string;
};

/**
 * Soft validation for variable paths: structure only (allowed roots), never blocks save.
 * Unknown root -> valid: false + warning. Unknown step / self-ref / loop segment -> valid: true + warning.
 */
export function validateVariable(
  path: string,
  context: VariableValidationContext
): VariableSoftValidationResult {
  const parsed = parseVariablePath(path);
  const firstSegment = path.trim().split(".").filter(Boolean)[0];

  if (!parsed) {
    return {
      valid: false,
      warning: firstSegment ? `Unknown variable root: ${firstSegment}` : `Invalid variable syntax: "${path}"`,
    };
  }

  const { steps, currentStepId } = context;
  const stepIds = new Set(steps.map((s) => s.id));

  if (parsed.kind === "step") {
    if (!parsed.stepId) {
      return { valid: true, warning: "Step variable is missing step id (may exist at runtime)." };
    }
    if (!stepIds.has(parsed.stepId)) {
      return { valid: true, warning: `Step "${parsed.stepId}" not found (may exist at runtime)` };
    }
    if (parsed.stepId === currentStepId) {
      return { valid: true, warning: "Step cannot reference its own output (may be valid at runtime)." };
    }
  }

  if (parsed.kind === "loop") {
    const allowed = new Set(["item", "index"]);
    if (parsed.segments.length === 0 || !allowed.has(parsed.segments[0])) {
      return { valid: true, warning: "Loop variables usually use loop.item or loop.index." };
    }
  }

  if (parsed.kind === "loops") {
    const allowed = new Set(["item", "index"]);
    if (!parsed.loopStepId) {
      return { valid: true, warning: "loops variables require a loop step id (loops.<loopStepId>.item)." };
    }
    if (!stepIds.has(parsed.loopStepId)) {
      return { valid: true, warning: `Loop step "${parsed.loopStepId}" not found (may exist at runtime)` };
    }
    if (parsed.segments.length === 0 || !allowed.has(parsed.segments[0])) {
      return { valid: true, warning: "Loop variables usually use loops.<loopStepId>.item or loops.<loopStepId>.index." };
    }
  }

  return { valid: true };
}

/**
 * Serialize a VariablePath back into canonical string form.
 * This hides any iteration/indexing concerns – those are handled at execution time.
 */
export function formatVariablePath(path: VariablePath): string {
  switch (path.kind) {
    case "trigger":
      return ["trigger", ...path.segments].join(".");
    case "loop":
      return ["loop", ...path.segments].join(".");
    case "loops":
      return ["loops", path.loopStepId ?? "", ...path.segments].filter(Boolean).join(".");
    case "run":
      return ["run", ...path.segments].join(".");
    case "step":
      return ["steps", path.stepId ?? "", ...path.segments].filter(Boolean).join(".");
    case "error":
      return ["error", ...path.segments].join(".");
    default:
      // exhaustive
      return path.segments.join(".");
  }
}

/**
 * Validate a variable expression (without surrounding {{ }}) against workflow context.
 * This is intentionally conservative and focuses on structural sanity:
 * - Known root (trigger/steps/loop/run)
 * - Existing step id for step variables
 * - Disallow referencing the current step's own output (common footgun)
 */
export function validateVariablePath(
  expr: string,
  context: VariableValidationContext
): VariableValidationResult {
  const parsed = parseVariablePath(expr);
  if (!parsed) {
    return { ok: false, error: `Invalid variable syntax: "${expr}"` };
  }

  const { steps, currentStepId } = context;
  const stepIds = new Set(steps.map((s) => s.id));

  if (parsed.kind === "step") {
    if (!parsed.stepId) {
      return { ok: false, error: "Step variable is missing step id." };
    }
    if (!stepIds.has(parsed.stepId)) {
      return { ok: false, error: `Unknown step "${parsed.stepId}" in variable "${expr}".` };
    }
    if (parsed.stepId === currentStepId) {
      return {
        ok: false,
        error: `Step "${parsed.stepId}" cannot reference its own output in "${expr}".`,
      };
    }
  }

  if (parsed.kind === "loop") {
    const allowedLoopSegments = new Set(["item", "index"]);
    if (parsed.segments.length === 0 || !allowedLoopSegments.has(parsed.segments[0])) {
      return {
        ok: false,
        error: `Loop variables must start with "item" or "index" (got "${expr}").`,
      };
    }
  }

  if (parsed.kind === "loops") {
    const allowedLoopSegments = new Set(["item", "index"]);
    if (!parsed.loopStepId) {
      return { ok: false, error: `Loop variables must include loop step id (got "${expr}").` };
    }
    const loopStep = context.steps.find((s) => s.id === parsed.loopStepId);
    if (!loopStep) {
      return { ok: false, error: `Unknown loop step "${parsed.loopStepId}" in variable "${expr}".` };
    }
    if (loopStep.type !== "foreach") {
      return { ok: false, error: `Step "${parsed.loopStepId}" is not a foreach loop in "${expr}".` };
    }
    if (parsed.segments.length === 0 || !allowedLoopSegments.has(parsed.segments[0])) {
      return {
        ok: false,
        error: `Loop variables must start with "item" or "index" (got "${expr}").`,
      };
    }
  }

  // For now we don't deeply validate nested keys; that requires full output shape knowledge.
  return { ok: true };
}

/**
 * Run'da saklanan step çıktısı executor'ın döndürdüğü tam nesnedir: { success, output }.
 * Ağaçta steps.X.output.output hiç görünmemeli; runtime'da da tek .output kullanılıyor.
 * İç içe { success, output } varsa tekrarlı unwrap yapıyoruz.
 */
function getStepOutputPayload(raw: unknown): unknown {
  let current: unknown = raw;
  for (;;) {
    if (current == null || typeof current !== "object" || Array.isArray(current)) return current;
    const o = current as Record<string, unknown>;
    if ("output" in o && typeof o.success === "boolean") {
      current = o.output;
      continue;
    }
    return current;
  }
}

/**
 * Ağaçta .output.output hiç olmasın diye: objede sadece "output" (ve isteğe bağlı "success")
 * varsa içeriğini tekrarlı olarak dışarı al. Böylece wrapper olan objeler açılır,
 * ama { data, output } gibi gerçek payload'lar olduğu gibi kalır.
 */
function flattenOutputKey(payload: unknown): unknown {
  let current: unknown = payload;
  for (;;) {
    if (current == null || typeof current !== "object" || Array.isArray(current)) return current;
    const o = current as Record<string, unknown>;
    const keys = Object.keys(o);
    const looksLikeWrapper = keys.length === 1 && "output" in o ||
      (keys.length === 2 && "output" in o && "success" in o);
    if (looksLikeWrapper) {
      current = o.output;
      continue;
    }
    return current;
  }
}

/** step output ağacında .output.output hiç görünmesin diye "output" anahtarını atlayabiliriz */
function objectToTreeNodes(
  obj: Record<string, unknown>,
  basePath: string,
  options?: { skipOutputKey?: boolean }
): VariableTreeNode[] {
  const skipOutputKey = options?.skipOutputKey ?? false;
  return Object.entries(obj)
    .filter(([key]) => !(skipOutputKey && key === "output"))
    .map(([key, value]) => {
      const path = `${basePath}.${key}`;
      if (
        value != null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype
      ) {
        const children = objectToTreeNodes(value as Record<string, unknown>, path, options);
        return {
          name: key,
          path,
          children: children.length ? children : undefined,
        };
      }
      return { name: key, path };
    });
}

/**
 * Build variable tree nodes from a plugin output schema (when no run output exists).
 */
export function buildTreeFromOutputSchema(
  stepId: string,
  outputSchema: PluginOutputSchema | null | undefined
): VariableTreeNode[] {
  const basePath = `steps.${stepId}.output`;
  if (!outputSchema) return [{ name: "output", path: basePath }];

  function schemaToChildren(schema: PluginOutputSchema, path: string, skipOutputKey = false): VariableTreeNode[] {
    if (schema.properties && typeof schema.properties === "object") {
      return Object.entries(schema.properties)
        .filter(([key]) => !(skipOutputKey && key === "output"))
        .map(([key, prop]) => {
          const childPath = path ? `${path}.${key}` : key;
          const childSchema = prop && typeof prop === "object" && "type" in prop ? (prop as PluginOutputSchema) : null;
          const children = childSchema ? schemaToChildren(childSchema, childPath, skipOutputKey) : undefined;
          return { name: key, path: `${basePath}.${childPath}`, children };
        });
    }
    if (schema.items && typeof schema.items === "object") {
      const itemSchema = schema.items as PluginOutputSchema;
      const children = schemaToChildren(itemSchema, "item");
      return [{ name: "item", path: `${basePath}.item`, children: children.length ? children : undefined }];
    }
    return [];
  }

  const children = schemaToChildren(outputSchema, "", true);
  return [{ name: "output", path: basePath, children: children.length ? children : undefined }];
}

/**
 * Build the variable tree for the editor.
 * When runOutputsByStep is missing for a step, uses outputSchemaByStep (from plugin catalog) if provided.
 */
export function getVariableTree(
  steps: StepsInput,
  currentStepId: string,
  runOutputsByStep?: RunOutputsByStep,
  outputSchemaByStep?: Record<string, PluginOutputSchema | null | undefined>
): VariableTreeNode[] {
  const roots: VariableTreeNode[] = [];

  roots.push({
    name: "trigger",
    children: [
      { name: "body", path: "trigger.body" },
      { name: "query", path: "trigger.query" },
      { name: "payload", path: "trigger.payload" },
    ],
  });

  const stepIds = steps.map((s) => s.id).filter((id) => id !== currentStepId);
  if (stepIds.length > 0) {
    const stepChildren: VariableTreeNode[] = stepIds.map((stepId) => {
      const raw = runOutputsByStep?.[stepId];
      let output = getStepOutputPayload(raw);
      output = flattenOutputKey(output);
      if (output != null && typeof output === "object" && !Array.isArray(output)) {
        const outputChildren = objectToTreeNodes(
          output as Record<string, unknown>,
          `steps.${stepId}.output`,
          { skipOutputKey: true }
        );
        return {
          name: stepId,
          children: [{ name: "output", children: outputChildren, path: `steps.${stepId}.output` }],
        };
      }
      const schema = outputSchemaByStep?.[stepId];
      if (schema != null) {
        const outputNodes = buildTreeFromOutputSchema(stepId, schema);
        return { name: stepId, children: outputNodes };
      }
      return {
        name: stepId,
        children: [{ name: "output", path: `steps.${stepId}.output` }],
      };
    });
    roots.push({ name: "steps", children: stepChildren });
  }

  roots.push({
    name: "loop",
    children: [
      { name: "item", path: "loop.item" },
      { name: "index", path: "loop.index" },
    ],
  });

  const foreachStepIds = steps.filter((s) => s.type === "foreach").map((s) => s.id);
  if (foreachStepIds.length > 0) {
    roots.push({
      name: "loops",
      children: foreachStepIds.map((loopStepId) => ({
        name: loopStepId,
        children: [
          { name: "item", path: `loops.${loopStepId}.item` },
          { name: "index", path: `loops.${loopStepId}.index` },
        ],
      })),
    });
  }

  roots.push({
    name: "run",
    children: [{ name: "id", path: "run.id" }],
  });

  roots.push({
    name: "error",
    children: [
      { name: "message", path: "error.message" },
      { name: "stepId", path: "error.stepId" },
      { name: "iteration", path: "error.iteration" },
    ],
  });

  return roots;
}

/**
 * Find the node at the given path prefix by walking the tree.
 * Path segments are node names, e.g. "steps", "steps.fetchPost", "steps.fetchPost.output".
 * Returns the children of the node at that path, or the roots if path is empty.
 */
export function getChildrenAtPath(tree: VariableTreeNode[], pathPrefix: string): VariableTreeNode[] {
  const segments = pathPrefix.trim().split(".").filter(Boolean);
  if (segments.length === 0) return tree;

  let current: VariableTreeNode[] = tree;
  for (const seg of segments) {
    const node = current.find((n) => n.name === seg);
    if (!node) return [];
    if (!node.children?.length) return [];
    current = node.children;
  }
  return current;
}

/**
 * Flatten tree to sorted list of all paths (for autocomplete).
 */
export function getFlattenedPaths(tree: VariableTreeNode[]): string[] {
  const paths: string[] = [];
  function walk(nodes: VariableTreeNode[]) {
    for (const node of nodes) {
      if (node.path) paths.push(node.path);
      if (node.children?.length) walk(node.children);
    }
  }
  walk(tree);
  return paths.sort();
}

/**
 * Build tree and flattened paths.
 */
export function getAvailableVariables(
  steps: StepsInput,
  currentStepId: string,
  runOutputsByStep?: RunOutputsByStep,
  outputSchemaByStep?: Record<string, PluginOutputSchema | null | undefined>
): { tree: VariableTreeNode[]; paths: string[] } {
  const tree = getVariableTree(steps, currentStepId, runOutputsByStep, outputSchemaByStep);
  const paths = getFlattenedPaths(tree);
  return { tree, paths };
}

/**
 * Human-readable label for a variable path.
 */
export function resolveVariablePath(path: string): string {
  return path.replace(/^steps\./, "").replace(/\.output\.?/, " -> ");
}

/**
 * Build tree from a step's output object for the JSON viewer.
 * Unwraps executor shape ve içteki "output" anahtarını düzleştirir; steps.X.output.output hiç görünmez.
 */
export function buildOutputTree(stepId: string, output: unknown): VariableTreeNode[] {
  const basePath = `steps.${stepId}.output`;
  let payload = getStepOutputPayload(output);
  payload = flattenOutputKey(payload);
  if (payload == null) return [];
  if (typeof payload !== "object" || Array.isArray(payload)) {
    return [{ name: "output", path: basePath }];
  }
  const children = objectToTreeNodes(payload as Record<string, unknown>, basePath, { skipOutputKey: true });
  return [{ name: "output", path: basePath, children: children.length ? children : undefined }];
}

/**
 * Walk an object and collect paths whose runtime value is an array.
 * Used for foreach "items" suggestions when run output snapshot is available.
 */
function collectArrayPaths(obj: unknown, basePath: string): string[] {
  const paths: string[] = [];
  if (Array.isArray(obj)) {
    paths.push(basePath);
    return paths;
  }
  if (obj == null || typeof obj !== "object" || Object.getPrototypeOf(obj) !== Object.prototype) {
    return paths;
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = basePath ? `${basePath}.${key}` : key;
    if (Array.isArray(value)) {
      paths.push(path);
    } else if (value != null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      paths.push(...collectArrayPaths(value, path));
    }
  }
  return paths;
}

/**
 * From run output snapshot (per-step outputs), collect variable paths that resolved to arrays.
 * Used by ForeachNodeForm to show "Suggested array sources" when editing items path.
 */
export function getArrayPathsFromRunOutputs(runOutputsByStep: RunOutputsByStep): string[] {
  const paths: string[] = [];
  for (const [stepId, raw] of Object.entries(runOutputsByStep)) {
    if (raw == null) continue;
    let output = getStepOutputPayload(raw);
    output = flattenOutputKey(output);
    const basePath = `steps.${stepId}.output`;
    if (Array.isArray(output)) {
      paths.push(basePath);
    } else if (output != null && typeof output === "object" && Object.getPrototypeOf(output) === Object.prototype) {
      paths.push(...collectArrayPaths(output, basePath));
    }
  }
  return paths.sort();
}
