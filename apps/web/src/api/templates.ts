import { apiFetch } from "./client";

export type TemplateSummary = {
  id: string;
  name: string;
  description: string;
  category: string;
  createdAt: string;
};

export type TemplateDetail = TemplateSummary & {
  workflow: Record<string, unknown>;
};

export function fetchTemplates(): Promise<TemplateSummary[]> {
  return apiFetch<TemplateSummary[]>("/templates");
}

export function fetchTemplate(id: string): Promise<TemplateDetail> {
  return apiFetch<TemplateDetail>(`/templates/${id}`);
}

export function installTemplate(
  id: string,
  options?: { name?: string }
): Promise<{ id: string; name: string; message: string }> {
  return apiFetch<{ id: string; name: string; message: string }>(
    `/templates/install/${id}`,
    {
      method: "POST",
      body: JSON.stringify(options ?? {}),
    }
  );
}
