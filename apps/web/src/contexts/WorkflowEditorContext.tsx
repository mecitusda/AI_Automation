import { createContext, useContext } from "react";

export type WorkflowEditorContextValue = {
  onEditNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onDuplicateNode: (nodeId: string) => void;
  onToggleDisabled: (nodeId: string) => void;
} | null;

export const WorkflowEditorContext = createContext<WorkflowEditorContextValue>(null);

export function useWorkflowEditor(): WorkflowEditorContextValue {
  return useContext(WorkflowEditorContext);
}
