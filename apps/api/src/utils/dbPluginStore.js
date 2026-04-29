import { getPlatformModels } from "./tenantModels.js";

const VALID_SCOPES = new Set(["workflow", "user"]);

function normalizeContext(context) {
  const userId = context?.userId;
  const workflowId = context?.workflowId;
  return { userId, workflowId };
}

function normalizeCollection(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeScope(value) {
  const scope = String(value ?? "workflow").trim().toLowerCase();
  if (!VALID_SCOPES.has(scope)) {
    throw new Error(`Invalid data store scope: ${value}`);
  }
  return scope;
}

/**
 * Validates that the runtime context carries enough information to access
 * the data store at the requested scope. Workflow-scope writes/reads need
 * both `userId` and `workflowId`; user-scope only needs `userId`.
 */
export function assertDataStoreContext(context, { scope = "workflow" } = {}) {
  const normalizedScope = normalizeScope(scope);
  const { userId, workflowId } = normalizeContext(context);
  if (!userId) {
    throw new Error("Data store context missing userId");
  }
  if (normalizedScope === "workflow" && !workflowId) {
    throw new Error("Data store context missing workflowId for workflow scope");
  }
  return { userId, workflowId, scope: normalizedScope };
}

/**
 * Builds a `WorkflowVariable` model handle plus a base mongo query that
 * already constrains documents to the caller's tenant + scope + collection.
 * Plugins should NEVER read/write `WorkflowVariable` without spreading this
 * `baseQuery` first.
 */
export function getWorkflowVariableAccess(context, options = {}) {
  const scope = assertDataStoreContext(context, { scope: options.scope });
  const collection = normalizeCollection(options.collection);
  const { WorkflowVariable } = getPlatformModels();
  const baseQuery = {
    userId: scope.userId,
    scope: scope.scope,
    collection
  };
  if (scope.scope === "workflow") {
    baseQuery.workflowId = scope.workflowId;
  } else {
    // Explicit null so the unique partial index ({scope:'user'}) matches.
    baseQuery.workflowId = null;
  }
  return {
    WorkflowVariable,
    baseQuery,
    scope: {
      userId: scope.userId,
      workflowId: scope.scope === "workflow" ? scope.workflowId : null,
      scope: scope.scope,
      collection
    }
  };
}

export function detectValueType(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "json";
  }
}
