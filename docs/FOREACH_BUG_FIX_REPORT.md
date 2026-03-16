# Foreach Loop Bug Fix Report

**Component:** AI Automation Workflow Engine — Orchestrator & Variable Resolver  
**Date:** March 2026  
**Files modified:** `apps/api/src/engine/orchestrator.js`, `apps/api/src/utils/variableResolver.js`

---

## 1. Executive Summary

The workflow engine’s **foreach** step was not advancing: `loopContext` stayed empty, child steps (e.g. “send email per user”) never ran, and the orchestrator could spin in a dispatch loop. The fix addressed **three root causes**: missing initial `loopContext`, dependency logic that blocked child steps, and **incorrect reading of `loopState`** because it is a Mongoose Map (bracket access does not work). A separate change removed noisy debug logging in the variable resolver.

---

## 2. Bug Symptoms

- **loopContext remained empty** in the run document even after the foreach step had items.
- **Child steps of the foreach never executed** (e.g. send email for each of 10 users).
- **Orchestrator could enter a repeated dispatch loop**, with dependency checks and variable resolution running over and over.
- **Run state in DB:** `loopState.loopUsers` showed `index: 0` and `items: Array(10)`, but `loopContext` was still empty and the foreach step stayed `pending`.

---

## 3. Root Causes and Fixes

### 3.1 LoopContext Not Set on First Iteration

**Cause:** When the foreach step ran for the first time, the code only wrote `loopState` (index and items) to the DB and then re-entered `dispatchReadySteps`. It did **not** set `loopContext` in that same update. So the next pass (and workers) never saw a valid `loopContext` for iteration 0.

**Fix (orchestrator.js):** In the “first iteration” block (when `!loopState`), the single `Run.updateOne` now sets **both** `loopState` and `loopContext`:

- `loopState.<stepId>` = `{ index: 0, items }`
- `loopContext` = `{ loopStepId, index: 0, item: items[0] ?? null }`

So the run always has a valid `loopContext` as soon as the loop is initialized.

---

### 3.2 Dependency Check Blocked Child Steps

**Cause:** For a child step that depends on the foreach step, `depsSatisfied` only treated that dependency as satisfied when `run.loopContext` was set and matched the iteration. If the child was evaluated **before** the foreach in the same pass (e.g. step array order), `loopContext` was still empty and the dependency was never satisfied, so the child never became ready.

**Fix (orchestrator.js):** In `depsSatisfied`, when the dependency is the active foreach step (`activeLoopStepId`):

- Still return `true` if `run.loopContext` matches the requested iteration.
- **Additionally** return `true` if `run.loopState` (via `getLoopState(run, activeLoopStepId)`) exists and its `index` equals the requested iteration, even when `loopContext` is not set yet.

So child steps can become ready based on `loopState` index when `loopContext` is not yet written or not yet visible in the same pass.

**Related fix:** For normal (non-if/foreach) steps, the “active loop step id” passed into `depsSatisfied` is now:

- `run.loopContext?.loopStepId` when inside a loop with context set, or  
- The **parent foreach step id** (`parentLoop.id`) when the step’s iteration is taken from `loopState` (so the foreach-as-dependency rule is used even when `loopContext` is empty).  

This is done by introducing `activeLoopStepIdForDeps` and using `loopStepId = run.loopContext?.loopStepId ?? activeLoopStepIdForDeps ?? null` when calling `depsSatisfied`.

---

### 3.3 loopState Read as Map (Main Blocker)

**Cause:** In the Run schema, `loopState` is defined as `type: Map`. In JavaScript, **Map** values must be read with `.get(key)`; bracket notation `run.loopState?.[stepId]` does **not** read from the Map and always yields `undefined`. So:

- The orchestrator always thought there was **no** loop state.
- It repeatedly took the “first iteration” branch, re-initialized `loopState` and `loopContext`, and returned.
- It **never** reached the branch that uses existing `loopState` to set `loopContext` for the current index and schedule child steps.
- In the DB, `loopState` was correctly written (e.g. `loopUsers` with index and items), but the in-memory `run` never “saw” it, so `loopContext` was never used and the loop never advanced.

**Fix (orchestrator.js):** A Map-safe accessor was added and used everywhere `loopState` is read by key:

```javascript
/** Run.loopState is a Mongoose Map; use .get() or fallback to bracket notation for plain objects. */
function getLoopState(run, stepId) {
  const ls = run?.loopState;
  if (!ls) return undefined;
  if (typeof ls.get === "function") return ls.get(stepId);
  return ls[stepId];
}
```

All previous uses of `run.loopState?.[stepId]` (or equivalent) were replaced with `getLoopState(run, stepId)` in:

- The foreach block (reading loop state for the current foreach step).
- `depsSatisfied` (foreach-as-dependency check).
- Iteration resolution for child steps (parent foreach’s index).
- `isRunDone` (foreach completion check).

This ensures that once `loopState` is persisted, it is read back correctly and the “we already have loop state” path runs, `loopContext` is set per iteration, and child steps are scheduled.

---

### 3.4 Debug Logging (Variable Resolver)

**Cause:** `variableResolver.js` contained a `console.log("Source after root resolution:", source)` inside `resolvePath()`, which runs for every variable resolution (e.g. `{{ steps.fetchUsers }}`, `{{ loop.item }}`). With frequent resolution in the orchestrator and workers, this produced large amounts of repeated log output.

**Fix (variableResolver.js):** The debug log and the related `console.log("unknown")` were removed from `resolvePath()`.

---

## 4. Files and Locations

| File | Change |
|------|--------|
| `apps/api/src/engine/orchestrator.js` | Added `getLoopState(run, stepId)`; set `loopContext` when initializing `loopState`; relaxed `depsSatisfied` for foreach-as-dep and use `getLoopState`; introduced `activeLoopStepIdForDeps` and use it for `loopStepId` in dependency checks; replaced all `run.loopState?.[key]` with `getLoopState(run, key)`; removed temporary debug `console.log` calls. |
| `apps/api/src/utils/variableResolver.js` | Removed `console.log("Source after root resolution:", source)` and `console.log("unknown")` from `resolvePath()`. |

---

## 5. Verification

- **Expected behaviour after fix:**
  - `loopState` is initialized once per foreach step with `index: 0` and `items`.
  - `loopContext` is set at initialization and for each iteration (index, item, loopStepId).
  - Child steps (e.g. send email) are scheduled once per item and run with the correct `loopContext`.
  - Iteration index increments after all children for the current index complete; the foreach step completes when `index >= items.length`.
- **No new linter issues** were reported for the modified files.
- Re-running a workflow that uses a foreach (e.g. fetch users → foreach → send email) should show `loopContext` populated and child steps executing for each item.

---

## 6. Summary

The foreach bug was fixed by: (1) setting **loopContext** when first initializing **loopState**; (2) making **depsSatisfied** and **loopStepId** logic allow child steps to run when **loopState** is at the right index even if **loopContext** is not set yet; and (3) reading **loopState** via a **Map-safe helper** (`getLoopState`) so the orchestrator correctly sees persisted loop state and can set **loopContext** and schedule child steps. Removing variable-resolver debug logs reduced log noise during execution.
