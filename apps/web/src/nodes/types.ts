import type { ComponentType } from "react";
import type { VariableTreeNode } from "../utils/variableSystem";

export type NodeCategory = "ai" | "data" | "control" | "utilities";

export type NodeFormProps = {
  stepId: string;
  stepType: string;
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
  errors: Record<string, string>;
  onInsertVariable?: (path: string) => void;
  registerInsertHandler?: (handler: ((path: string) => void) | null) => void;
  /** Flattened variable paths for autocomplete */
  availablePaths?: string[];
  /** Tree for Insert variable popover */
  availableVariableTree?: VariableTreeNode[];
  /** Paths that are known to resolve to arrays (from run output snapshot). Used by ForeachNodeForm. */
  suggestedArrayPaths?: string[];
  /** Example prompt for AI nodes (Insert example button) */
  examplePrompt?: string;
  /** Field-level help text for tooltips */
  fieldHelp?: Record<string, string>;
  disabled?: boolean;
  /** When false, hide the "Insert variable" popover button (e.g. when using a side panel for variables). Default true. */
  showInsertVariableButton?: boolean;
  /** For IF step form: list of other steps that can be selected as branch targets (Then go to / Else go to). */
  availableTargetSteps?: { id: string; label?: string }[];
};

export type NodeTypeDef = {
  type: string;
  label: string;
  icon: string;
  description: string;
  category: NodeCategory;
  formComponent: ComponentType<NodeFormProps>;
  validateParams?: (params: Record<string, unknown>) => Record<string, string>;
  getSummary?: (params: Record<string, unknown>) => string;
  examplePrompt?: string;
  /** Help text per field (e.g. { prompt: "...", temperature: "..." }) */
  fieldHelp?: Record<string, string>;
};

export const NODE_CATEGORIES: Record<NodeCategory, string> = {
  ai: "AI",
  data: "Data",
  control: "Control",
  utilities: "Utilities",
};
