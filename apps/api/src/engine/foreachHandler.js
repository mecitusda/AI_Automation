import { resolveVariables } from "../utils/variableResolver.js";

/** Run.loopState can be a Mongoose Map; use .get() or fallback to bracket notation. */
function getLoopState(run, stepId) {
  const ls = run?.loopState;
  if (!ls) return undefined;
  if (typeof ls.get === "function") return ls.get(stepId);
  return ls[stepId];
}

export async function handleForeachStep({
  step,
  run,
  stepIndex,
  context
}) {

  const items = resolveVariables(step.items, context);

  if (!Array.isArray(items)) {
    console.log("items", items);
    throw new Error("foreach items must be array");
  }

  const state = getLoopState(run, step.id) ?? {
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