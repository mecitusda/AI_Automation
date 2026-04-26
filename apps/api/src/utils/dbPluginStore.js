import { getPlatformModels } from "./tenantModels.js";

function normalizeContext(context) {
  const userId = context?.userId;
  const workflowId = context?.workflowId;
  return { userId, workflowId };
}

export function assertDataStoreContext(context) {
  const { userId, workflowId } = normalizeContext(context);
  if (!userId || !workflowId) {
    throw new Error("Data store context missing userId/workflowId");
  }
  return { userId, workflowId };
}

export function getWorkflowVariableAccess(context) {
  const scope = assertDataStoreContext(context);
  const { WorkflowVariable } = getPlatformModels();
  const baseQuery = {
    userId: scope.userId,
    workflowId: scope.workflowId
  };
  return { WorkflowVariable, baseQuery, scope };
}
