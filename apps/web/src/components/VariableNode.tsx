import { useState, memo } from "react";
import type { VariableTreeNode } from "../utils/variableSystem";

export type VariableNodeProps = {
  node: VariableTreeNode;
  depth: number;
  onSelectPath: (path: string) => void;
  /** True when this node is the last child of its parent (for connector line styling). */
  isLast?: boolean;
};

const INDENT_PER_LEVEL = 14;
const ROW_HEIGHT = 24;
const TOGGLE_SIZE = 18;

function VariableNodeInner({ node, depth, onSelectPath, isLast = false }: VariableNodeProps) {
  const [open, setOpen] = useState(false);
  const hasChildren = node.children && node.children.length > 0;
  const isLeaf = !!node.path && !hasChildren;

  const handleToggle = () => {
    if (hasChildren) setOpen((o) => !o);
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleToggle();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (node.path) {
      e.preventDefault(); // Keep focus on form field so insert goes to the right place
      onSelectPath(node.path);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (!node.path) return;
    e.dataTransfer.setData("application/x-variable", node.path);
    e.dataTransfer.effectAllowed = "copy";
  };

  const indentPx = depth * INDENT_PER_LEVEL;

  const paddingLeft = 8 + indentPx;
  const toggleCenterX = paddingLeft + TOGGLE_SIZE / 2;

  return (
    <div
      className={`variable-node ${depth > 0 ? "variable-node--child" : ""} ${hasChildren ? "variable-node--parent" : ""} ${hasChildren && open ? "variable-node--open" : ""} ${isLast ? "variable-node--last" : ""}`}
      style={{
        marginLeft: depth > 0 ? 0 : undefined,
        ["--variable-children-margin" as string]: hasChildren ? `${toggleCenterX}px` : undefined,
      }}
    >
      <div
        className={`variable-node__row ${isLeaf ? "variable-node__row--leaf" : ""} ${depth === 0 ? "variable-node__row--root" : ""}`}
        style={{
          paddingLeft,
          height: ROW_HEIGHT,
          paddingTop: 2,
          paddingBottom: 2,
          paddingRight: 8,
          ["--variable-connector-width" as string]: `${paddingLeft}px`,
        }}
        onClick={!isLeaf && hasChildren ? handleToggle : undefined}
        onMouseDown={isLeaf ? handleMouseDown : hasChildren ? undefined : handleMouseDown}
        draggable={isLeaf}
        onDragStart={isLeaf ? handleDragStart : undefined}
      >
        {hasChildren ? (
          <span
            role="button"
            tabIndex={0}
            className="variable-node__toggle"
            onClick={handleChevronClick}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleToggle(); } }}
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? "−" : "+"}
          </span>
        ) : (
          <span className="variable-node__toggle-spacer" />
        )}
        <span className="variable-node__label">{node.name}</span>
      </div>
      {hasChildren && open && (
        <div className="variable-node__children">
          {node.children!.map((child, index) => (
            <VariableNode
              key={child.name + (child.path ?? "")}
              node={child}
              depth={depth + 1}
              onSelectPath={onSelectPath}
              isLast={index === node.children!.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const VariableNode = memo(VariableNodeInner);
export default VariableNode;
