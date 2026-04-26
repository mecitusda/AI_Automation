import { apiFetch } from "./client";

export type WorkflowVariableItem = {
  id: string;
  workflowId: string;
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
  workflowId: string;
  page?: number;
  limit?: number;
  q?: string;
  key?: string;
}): Promise<WorkflowVariableListResponse> {
  const qs = new URLSearchParams({
    workflowId: params.workflowId,
    ...(params.page ? { page: String(params.page) } : {}),
    ...(params.limit ? { limit: String(params.limit) } : {}),
    ...(params.q ? { q: params.q } : {}),
    ...(params.key ? { key: params.key } : {})
  });
  return apiFetch<WorkflowVariableListResponse>(`/workflow-variables?${qs.toString()}`);
}

export function createWorkflowVariable(body: {
  workflowId: string;
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
