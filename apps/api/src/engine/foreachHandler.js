import { resolveVariables } from "../utils/variableResolver.js";

export async function handleForeachStep({
  step,
  run,
  stepIndex,
  context
}) {

  const items = resolveVariables(step.items, context);

  if (!Array.isArray(items)) {
    throw new Error("foreach items must be array");
  }

  const state = run.loopState?.[step.id] ?? {
    index: 0,
    items
  };

  if (state.index >= items.length) {
    return {
      done: true
    };
  }

  const item = items[state.index];

  return {
    done: false,
    item,
    index: state.index
  };
}