import { apiFetch } from "./client";

export type CredentialMeta = {
  id: string;
  name: string;
  type: string;
  createdAt?: string;
};

export function fetchCredentials(): Promise<CredentialMeta[]> {
  return apiFetch<CredentialMeta[]>("/credentials");
}
