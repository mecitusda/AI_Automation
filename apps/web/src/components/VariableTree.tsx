import VariableNode from "./VariableNode";
import type { VariableTreeNode } from "../utils/variableSystem";

export type VariableTreeProps = {
  tree: VariableTreeNode[];
  onSelectPath: (path: string) => void;
  className?: string;
  /** When true, do not show the default "Variables (click to insert)" label (e.g. when used under a panel title). */
  hideLabel?: boolean;
};

export default function VariableTree({
  tree,
  onSelectPath,
  className,
  hideLabel,
}: VariableTreeProps) {
  return (
    <div
      className={className ? `variable-tree ${className}` : "variable-tree"}
      style={{ marginTop: hideLabel ? 0 : 8 }}
    >
      {!hideLabel && (
        <strong className="variable-tree__label-header" style={{ display: "block", marginBottom: 6, fontSize: 12, color: "#9ca3af" }}>
          Variables (click to insert)
        </strong>
      )}
      <div className="variable-tree__list" style={{ listStyle: "none", margin: 0, padding: hideLabel ? "4px 0" : "6px 4px" }}>
        {tree.map((root) => (
          <VariableNode
            key={root.name}
            node={root}
            depth={0}
            onSelectPath={onSelectPath}
          />
        ))}
      </div>
    </div>
  );
}
