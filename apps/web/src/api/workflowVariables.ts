import { apiFetch } from "./client";

export type DataStoreScope = "workflow" | "user";
export type DataStoreScopeFilter = DataStoreScope | "all";

export type WorkflowVariableItem = {
  id: string;
  workflowId: string | null;
  scope: DataStoreScope;
  collection: string;
  key: string;
  value: unknown;
  valueType: string | null;
  isSecret: boolean;
  description: string;
  tags: string[];
  updatedAt: string;
  createdAt: string;
};

export type WorkflowVariableListResponse = {
  items: WorkflowVariableItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function listWorkflowVariables(params: {
  workflowId?: string;
  scope?: DataStoreScopeFilter;
  collection?: string;
  page?: number;
  limit?: number;
  q?: string;
  key?: string;
}): Promise<WorkflowVariableListResponse> {
  const qs = new URLSearchParams();
  if (params.workflowId) qs.set("workflowId", params.workflowId);
  if (params.scope) qs.set("scope", params.scope);
  if (params.collection !== undefined) qs.set("collection", params.collection);
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.q) qs.set("q", params.q);
  if (params.key) qs.set("key", params.key);
  return apiFetch<WorkflowVariableListResponse>(`/workflow-variables?${qs.toString()}`);
}

export function listWorkflowVariableCollections(params: {
  scope: DataStoreScope;
  workflowId?: string;
}): Promise<{ collections: string[] }> {
  const qs = new URLSearchParams();
  qs.set("scope", params.scope);
  if (params.workflowId) qs.set("workflowId", params.workflowId);
  return apiFetch<{ collections: string[] }>(`/workflow-variables/collections?${qs.toString()}`);
}

export function createWorkflowVariable(body: {
  workflowId?: string;
  scope: DataStoreScope;
  collection?: string;
  key: string;
  value: unknown;
  valueType?: string;
  isSecret?: boolean;
  description?: string;
  tags?: string[];
}): Promise<{ id: string }> {
  return apiFetch<{ id: string }>("/workflow-variables", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function getWorkflowVariable(id: string): Promise<WorkflowVariableItem> {
  return apiFetch<WorkflowVariableItem>(`/workflow-variables/${id}`);
}

export function updateWorkflowVariable(
  id: string,
  body: Partial<Pick<WorkflowVariableItem, "value" | "valueType" | "isSecret" | "description" | "tags">>
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/workflow-variables/${id}`, {
    method: "PUT",
    body: JSON.stringify(body)
  });
}

export function deleteWorkflowVariable(id: string): Promise<void> {
  return apiFetch<void>(`/workflow-variables/${id}`, { method: "DELETE" });
}
