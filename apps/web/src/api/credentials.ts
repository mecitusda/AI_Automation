import { apiFetch } from "./client";

export type CredentialMeta = {
  id: string;
  name: string;
  type: string;
  createdAt?: string;
};

export type CredentialDetail = CredentialMeta & {
  data: Record<string, unknown>;
};

export function fetchCredentials(options?: { type?: string }): Promise<CredentialMeta[]> {
  const query = options?.type ? `?type=${encodeURIComponent(options.type)}` : "";
  return apiFetch<CredentialMeta[]>(`/credentials${query}`);
}

export type CreateCredentialBody = {
  name: string;
  type: string;
  data: Record<string, unknown>;
};

export function createCredential(body: CreateCredentialBody): Promise<CredentialMeta> {
  return apiFetch<CredentialMeta>("/credentials", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type UpdateCredentialBody = {
  name: string;
  type: string;
  data: Record<string, unknown>;
};

export function fetchCredentialById(id: string): Promise<CredentialDetail> {
  return apiFetch<CredentialDetail>(`/credentials/${encodeURIComponent(id)}`);
}

export function updateCredential(id: string, body: UpdateCredentialBody): Promise<CredentialMeta> {
  return apiFetch<CredentialMeta>(`/credentials/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteCredential(id: string): Promise<void> {
  return apiFetch<void>(`/credentials/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
