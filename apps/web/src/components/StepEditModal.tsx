import { useState, useEffect, useRef, useMemo } from "react";
import "../styles/StepDetailModal.css";
import { getFormComponent, getNodeType, validateNodeParams } from "../nodes";
import { getVariableTree, getFlattenedPaths, getArrayPathsFromRunOutputs } from "../utils/variableSystem";
import { fetchPlugin, validateParamsFromSchema, type PluginInfo } from "../api/plugins";
import { fetchCredentials, type CredentialMeta } from "../api/credentials";
import VariablesPanel from "./VariablesPanel";
import OutputStructurePreview from "./OutputStructurePreview";
import SchemaForm from "./SchemaForm";
import { useRunData } from "../contexts/RunDataContext";

export type EditableStep = {
  id: string;
  type: string;
  params?: Record<string, unknown>;
  retry?: number;
  timeout?: number;
  dependsOn?: string[];
};

type StepEditModalProps = {
  step: EditableStep | null;
  steps?: { id: string; type?: string }[];
  workflowId?: string;
  pluginCatalog?: PluginInfo[];
  /** Workflow-level validation errors for this step (e.g. from last failed Save). Shown inline with field errors. */
  stepErrorsFromWorkflow?: Record<string, string>;
  /** Workflow-level variable warnings for this step (non-blocking). Shown in yellow. */
  stepWarningsFromWorkflow?: Record<string, string>;
  onClose: () => void;
  onSave: (updated: EditableStep) => void;
};

export default function StepEditModal({ step, steps = [], workflowId, pluginCatalog = [], stepErrorsFromWorkflow, stepWarningsFromWorkflow, onClose, onSave }: StepEditModalProps) {
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [retry, setRetry] = useState(0);
  const [timeoutMs, setTimeoutMs] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [runOutputsByStep, setRunOutputsByStep] = useState<Record<string, unknown> | null>(null);
  const [pluginMeta, setPluginMeta] = useState<PluginInfo | null>(null);
  const [credentialsList, setCredentialsList] = useState<CredentialMeta[]>([]);
  const insertHandlerRef = useRef<((path: string) => void) | null>(null);
  const runData = useRunData();
  
  useEffect(() => {
    if (!step) return;
    setParams(step.params ?? {});
    setRetry(step.retry ?? 0);
    setTimeoutMs(step.timeout ?? 0);
    setErrors({});
    setRunOutputsByStep(null);
    setPluginMeta(null);
  }, [step]);

  useEffect(() => {
    if (!step?.type) return;
    if (typeof step.type !== "string") return;
    let cancelled = false;
    fetchPlugin(step.type)
      .then((info) => { if (!cancelled) setPluginMeta(info); })
      .catch(() => { if (!cancelled) setPluginMeta(null); });
    return () => { cancelled = true; };
  }, [step?.type]);

  useEffect(() => {
    if (!pluginMeta?.credentials?.length) {
      setCredentialsList([]);
      return;
    }
    let cancelled = false;
    fetchCredentials()
      .then((list) => { if (!cancelled) setCredentialsList(list); })
      .catch(() => { if (!cancelled) setCredentialsList([]); });
    return () => { cancelled = true; };
  }, [pluginMeta?.credentials?.length]);

  // Fetch latest run output snapshot for upstream steps when modal opens (so variable tree and foreach suggestions use real structure).
  useEffect(() => {
    if (!step || !workflowId || !runData || steps.length === 0) {
      setRunOutputsByStep(null);
      return;
    }
    const upstreamStepIds = steps.map((s) => s.id).filter((id) => id !== step.id);
    if (upstreamStepIds.length === 0) {
      setRunOutputsByStep(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        upstreamStepIds.map(async (stepId) => {
          const snapshot = await runData.getStepOutputSnapshot(workflowId, stepId);
          return snapshot ? [stepId, snapshot.output] as const : null;
        })
      );
      if (cancelled) return;
      const byStep: Record<string, unknown> = {};
      for (const row of results) {
        if (row) byStep[row[0]] = row[1];
      }
      setRunOutputsByStep(Object.keys(byStep).length > 0 ? byStep : null);
    })();
    return () => { cancelled = true; };
  }, [step?.id, workflowId, runData, steps]);

  if (!step) return null;

  const nodeType = getNodeType(step.type);
  const description = nodeType?.description ?? pluginMeta?.label ?? "";
  const useSchemaForm = Boolean(pluginMeta?.schema && pluginMeta.schema.length > 0);
  const FormComponent = getFormComponent(step.type);

  const credentialRequired = Boolean(pluginMeta?.credentials?.some((c) => c.required));
  const credentialType = pluginMeta?.credentials?.[0]?.type;
  const matchingCredentials = credentialType
    ? credentialsList.filter((c) => c.type === credentialType)
    : [];

  const effectiveErrors = useMemo(
    () => ({ ...(stepErrorsFromWorkflow ?? {}), ...errors }),
    [stepErrorsFromWorkflow, errors]
  );
  const effectiveWarnings = stepWarningsFromWorkflow ?? {};

  const handleSave = () => {
    const errs = useSchemaForm
      ? validateParamsFromSchema(pluginMeta?.schema, params)
      : validateNodeParams(step.type, params);

    // Extra safety for HTTP nodes: when method != GET, body must be valid JSON.
    // Some forms may store invalid JSON as a string; block Save in that case.
    if (step.type === "http") {
      const method = String(params?.method ?? "GET").toUpperCase();
      if (method !== "GET" && typeof params?.body === "string") {
        const t = params.body.trim();
        if (t) {
          try {
            JSON.parse(t);
          } catch {
            (errs as Record<string, string>).body = "Body must be valid JSON";
          }
        }
      }
    }
    if (credentialRequired && (params.credentialId == null || String(params.credentialId).trim() === "")) {
      errs.credentialId = "Credential is required";
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    onSave({
      ...step,
      params,
      retry,
      timeout: timeoutMs,
    });
    onClose();
  };

  const outputSchemaByStep =
    pluginCatalog.length > 0 && steps.some((s) => "type" in s)
      ? Object.fromEntries(
          steps
            .filter((s) => s.id !== step.id && "type" in s && s.type)
            .map((s) => {
              const plugin = pluginCatalog.find((p) => p.type === (s as { type: string }).type);
              return [s.id, plugin?.output ?? null] as const;
            })
        )
      : undefined;
  const variableTree = getVariableTree(
    steps,
    step.id,
    runOutputsByStep ?? undefined,
    outputSchemaByStep
  );
  const hasUpstreamSteps = steps.filter((s) => s.id !== step.id).length > 0;
  const insertVariableIntoTarget = (target: EventTarget | null, path: string) => {
    const token = `{{ ${path} }}`;
    const el = target as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el) return false;
    if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return false;
    const start = (el.selectionStart ?? el.value.length);
    const end = (el.selectionEnd ?? start);
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    const value = `${before}${token}${after}`;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    if (setter) setter.call(el, value);
    else (el as any).value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    const next = start + token.length;
    try {
      el.focus();
      el.setSelectionRange(next, next);
    } catch {
      // no-op
    }
    return true;
  };
  const handleVariableDrop = (e: React.DragEvent) => {
    const path = e.dataTransfer.getData("application/x-variable");
    if (!path) return;
    e.preventDefault();
    const handledByForm = Boolean(insertHandlerRef.current);
    if (handledByForm) {
      insertHandlerRef.current?.(path);
      return;
    }
    insertVariableIntoTarget(e.target, path);
  };

  return (
    <div className="modalOverlay">
      <div className="modalCard modalCard--stepEdit" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modalCloseButton" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="stepEditModal__layout">
          <div
            className="stepEditModal__editor"
            onDragOver={(e) => {
              const hasVar = e.dataTransfer.types.includes("application/x-variable");
              if (hasVar) e.preventDefault();
            }}
            onDrop={handleVariableDrop}
          >
            <h2>Edit step: {step.id}</h2>
          <div className="modalSection" style={{ marginTop: -8 }}>
              <strong>Type:</strong> {step.type}
              {description && (
                <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "#9ca3af", fontWeight: "normal" }}>
                  {description}
                </p>
              )}
            </div>

            <div className="modalSection">
              <strong>Retry:</strong>{" "}
              <input
                type="number"
                min={0}
                value={retry}
                onChange={(e) => setRetry(Number(e.target.value))}
              />
            </div>

            <div className="modalSection">
              <strong>Timeout (ms):</strong>{" "}
              <input
                type="number"
                min={0}
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(Number(e.target.value))}
              />
            </div>

            <div className="modalSection">
              <strong>Depends On:</strong> {step.dependsOn?.length ? step.dependsOn.join(", ") : "None"} (edit by connecting nodes)
            </div>

            {pluginMeta?.credentials?.length ? (
              <div className="modalSection">
                <strong>Credential{credentialRequired ? " *" : ""}</strong>
                <select
                  value={String(params?.credentialId ?? "")}
                  onChange={(e) => setParams({ ...params, credentialId: e.target.value || undefined })}
                  style={{ marginTop: 4, padding: "6px 8px", minWidth: 200 }}
                >
                  <option value="">None</option>
                  {matchingCredentials.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {effectiveErrors.credentialId && (
                  <p style={{ color: "#f87171", fontSize: 12, marginTop: 4 }}>{effectiveErrors.credentialId}</p>
                )}
              </div>
            ) : null}

            <div className="modalSection">
              <strong>Parameters</strong>
              {useSchemaForm ? (
                <SchemaForm
                  schema={pluginMeta!.schema!}
                  params={params}
                  onChange={setParams}
                  errors={effectiveErrors}
                  warnings={effectiveWarnings}
                  registerInsertHandler={(fn) => { insertHandlerRef.current = fn; }}
                  availablePaths={getFlattenedPaths(variableTree)}
                  availableVariableTree={variableTree}
                />
              ) : (
                <>
                  <FormComponent
                    stepId={step.id}
                    stepType={step.type}
                    params={params}
                    onChange={setParams}
                    errors={effectiveErrors}
                    registerInsertHandler={(fn) => { insertHandlerRef.current = fn; }}
                    availablePaths={getFlattenedPaths(variableTree)}
                    availableVariableTree={variableTree}
                    suggestedArrayPaths={runOutputsByStep ? getArrayPathsFromRunOutputs(runOutputsByStep) : undefined}
                    examplePrompt={nodeType?.examplePrompt}
                    fieldHelp={nodeType?.fieldHelp}
                    showInsertVariableButton={false}
                    availableTargetSteps={steps.filter((s) => s.id !== step.id).map((s) => {
                      return {
                        id: s.id,
                        label: `${s.id} (${(s as { type?: string }).type ?? "step"})`,
                      };
                    })}
                  />
                  {Object.keys(effectiveWarnings).length > 0 && (
                    <div style={{ marginTop: 12, padding: 8, background: "rgba(234,179,8,0.1)", borderRadius: 6, fontSize: 12 }}>
                      <div style={{ color: "#eab308", fontWeight: 600, marginBottom: 4 }}>Variable warnings</div>
                      <ul style={{ margin: 0, paddingLeft: 18, color: "#ca8a04" }}>
                        {Object.entries(effectiveWarnings).map(([key, msg]) => (
                          <li key={key}><strong>{key}:</strong> {msg}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={handleSave}>Save</button>
              <button onClick={onClose}>Cancel</button>
            </div>
          </div>

          <aside className="stepEditModal__variablePanel">
            <VariablesPanel
              tree={variableTree}
              onSelectPath={(path) => insertHandlerRef.current?.(path)}
              hint={
                !runOutputsByStep && hasUpstreamSteps ? (
                  <p className="stepEditModal__variablePanelRunHint">
                    Run the workflow once to see output fields (e.g. body, data) for each step.
                  </p>
                ) : undefined
              }
            >
              {workflowId && hasUpstreamSteps && (
                <div className="stepEditModal__outputPreview">
                  <OutputStructurePreview
                    workflowId={workflowId}
                    stepId={step.id}
                    steps={steps}
                    onInsertPath={(path) => insertHandlerRef.current?.(path)}
                  />
                </div>
              )}
            </VariablesPanel>
          </aside>
        </div>
      </div>
    </div>
  );
}
