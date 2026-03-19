import { createContext, useContext, useState, useCallback } from "react";
import { fetchStepOutputPreview } from "../api/workflow";

export type StepOutputSnapshot = {
  stepId: string;
  output: unknown;
};

export type WorkflowRunSnapshot = {
  workflowId: string;
  // Last successful/failed run id for this workflow, if known
  runId?: string;
  // Per-step outputs from that run (lazily populated)
  stepOutputs: Record<string, StepOutputSnapshot>;
};

export type RunDataContextValue = {
  getStepOutputSnapshot: (
    workflowId: string,
    stepId: string
  ) => Promise<StepOutputSnapshot | null>;
};

const RunDataContext = createContext<RunDataContextValue | null>(null);

export function RunDataProvider({ children }: { children: React.ReactNode }) {
  const [snapshotsByWorkflow, setSnapshotsByWorkflow] = useState<
    Record<string, WorkflowRunSnapshot>
  >({});

  const getStepOutputSnapshot = useCallback<
    RunDataContextValue["getStepOutputSnapshot"]
  >(
    async (workflowId, stepId) => {
      const existing = snapshotsByWorkflow[workflowId];
      if (existing?.stepOutputs[stepId]) {
        return existing.stepOutputs[stepId];
      }

      try {
        const output = await fetchStepOutputPreview(workflowId, stepId);
        if (output == null) return null;
        const snapshot: StepOutputSnapshot = { stepId, output };
        setSnapshotsByWorkflow((prev) => {
          const wf = prev[workflowId] ?? {
            workflowId,
            stepOutputs: {} as Record<string, StepOutputSnapshot>,
          };
          return {
            ...prev,
            [workflowId]: {
              ...wf,
              stepOutputs: { ...wf.stepOutputs, [stepId]: snapshot },
            },
          };
        });
        return snapshot;
      } catch {
        return null;
      }
    },
    [snapshotsByWorkflow]
  );

  return (
    <RunDataContext.Provider
      value={{
        getStepOutputSnapshot,
      }}
    >
      {children}
    </RunDataContext.Provider>
  );
}

export function useRunData(): RunDataContextValue | null {
  return useContext(RunDataContext);
}

