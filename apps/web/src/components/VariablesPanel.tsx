import VariableTree from "./VariableTree";
import type { VariableTreeNode } from "../utils/variableSystem";

export type VariablesPanelProps = {
  tree: VariableTreeNode[];
  onSelectPath: (path: string) => void;
  className?: string;
  /** Optional hint below the tree (e.g. run hint). */
  hint?: React.ReactNode;
  /** Optional content after the tree (e.g. OutputStructurePreview). */
  children?: React.ReactNode;
};

export default function VariablesPanel({
  tree,
  onSelectPath,
  className,
  hint,
  children,
}: VariablesPanelProps) {
  return (
    <div className={className ? `variables-panel ${className}` : "variables-panel"}>
      <header className="variables-panel__header">
        <h3 className="variables-panel__title">Variables</h3>
        <p className="variables-panel__hint">Click a path to insert into the focused field.</p>
      </header>
      <div className="variables-panel__scroll">
        <VariableTree tree={tree} onSelectPath={onSelectPath} hideLabel />
        {hint != null && <div className="variables-panel__footer">{hint}</div>}
        {children}
      </div>
    </div>
  );
}
