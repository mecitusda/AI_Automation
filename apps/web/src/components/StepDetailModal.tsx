import type { WorkflowDetail } from "../api/workflow";
import "../styles/StepDetailModal.css"
type StepDetailModalProps = {
  step: WorkflowDetail["steps"][0] | null;
  onClose: () => void;
};

export default function StepDetailModal({ step, onClose }: StepDetailModalProps) {
  if (!step) return null;

  return (
    <div className="modalOverlay">
      <div className="modalCard" onClick={e => e.stopPropagation()}>
        <button type="button" className="modalCloseButton" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2>{step.id}</h2>

        <div className="modalSection">
          <strong>Type:</strong> {step.type}
        </div>

        <div className="modalSection">
          <strong>Retry:</strong> {step.retry ?? 0}
        </div>

        <div className="modalSection">
          <strong>Timeout:</strong> {step.timeout ?? 0} ms
        </div>

        <div className="modalSection">
          <strong>Depends On:</strong>{" "}
          {step.dependsOn?.length ? step.dependsOn.join(", ") : "None"}
        </div>

        <div className="modalSection">
          <strong>Params:</strong>
          <pre>{JSON.stringify(step.params ?? {}, null, 2)}</pre>
        </div>

      </div>
    </div>
  );
}