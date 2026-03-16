export type StepState = {
  stepId: string
  retryCount: number
  status: "pending" | "running" | "retrying" | "completed" | "failed" | "skipped" | "cancelled"
  iteration?: number
  durationMs?: number
}

export type RunLog = {
  stepId: string
  message: string
  createdAt: string
}

export type Run = {
  _id: string
  workflowId: string
  status: "queued" | "running" | "completed" | "failed"
  currentStepIndex: number
  durationMs?: number
  stepStates: StepState[]
  logs: RunLog[]
  createdAt: string
  finishedAt?: string
}