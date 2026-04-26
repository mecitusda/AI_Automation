import assert from "node:assert/strict";
import { __test__ } from "../apps/api/src/engine/orchestrator.js";

function makeRun() {
  return {
    stepStates: [
      { stepId: "loop_0", iteration: 0, status: "running" },
      { stepId: "fetch_0", iteration: 0, status: "completed" }
    ],
    loopContext: { loopStepId: "loop_0", index: 0 },
    loopState: { loop_0: { index: 0, items: ["a", "b"] } },
    lastError: null
  };
}

function runBarrierVsIterationTest() {
  const workflow = {
    steps: [
      { id: "loop_0", type: "foreach", dependsOn: [], params: { items: "{{ trigger.items }}" } },
      { id: "step_body", type: "http", dependsOn: ["loop_0"], params: { url: "{{ loop.item }}" } },
      { id: "step_after", type: "db.query", dependsOn: ["loop_0"], params: { keyPrefix: "news:" } }
    ]
  };
  const run = makeRun();

  const iterationAllowed = __test__.depsSatisfied(
    run,
    ["loop_0"],
    0,
    "loop_0",
    workflow.steps[1],
    workflow
  );
  assert.equal(iterationAllowed, true, "loop body step should run during active iteration");

  const barrierBlocked = __test__.depsSatisfied(
    run,
    ["loop_0"],
    0,
    null,
    workflow.steps[2],
    workflow
  );
  assert.equal(barrierBlocked, false, "downstream barrier step must wait foreach completion");

  run.stepStates = run.stepStates.map((s) =>
    s.stepId === "loop_0" ? { ...s, status: "completed" } : s
  );
  run.loopContext = null;
  const barrierReady = __test__.depsSatisfied(
    run,
    ["loop_0"],
    0,
    null,
    workflow.steps[2],
    workflow
  );
  assert.equal(barrierReady, true, "barrier step should run after foreach completes");
}

function runIsStepInsideLoopModeTest() {
  const workflow = {
    steps: [
      { id: "loop_0", type: "foreach", dependsOn: [] },
      {
        id: "collector",
        type: "db.query",
        dependsOn: ["loop_0"],
        dependencyModes: { loop_0: "barrier" },
        params: { keyPrefix: "news:" }
      },
      {
        id: "item_step",
        type: "log",
        dependsOn: ["loop_0"],
        dependencyModes: { loop_0: "iteration" },
        params: { message: "{{ loop.item }}" }
      },
      { id: "child_of_item", type: "log", dependsOn: ["item_step"], params: { message: "ok" } }
    ]
  };

  assert.equal(__test__.isStepInsideLoop("collector", "loop_0", workflow), false);
  assert.equal(__test__.isStepInsideLoop("item_step", "loop_0", workflow), true);
  assert.equal(__test__.isStepInsideLoop("child_of_item", "loop_0", workflow), true);
}

function runNestedInferenceTest() {
  const workflow = {
    steps: [
      { id: "loop_outer", type: "foreach", dependsOn: [] },
      {
        id: "loop_inner",
        type: "foreach",
        dependsOn: ["loop_outer"],
        params: { items: "{{ loops.loop_outer.item.items }}" }
      },
      {
        id: "send_item",
        type: "log",
        dependsOn: ["loop_inner"],
        params: { message: "{{ loop.item.title }}" }
      }
    ]
  };
  const modeOuter = __test__.getDependencyMode({
    stepPlain: workflow.steps[1],
    depId: "loop_outer",
    workflow
  });
  const modeInner = __test__.getDependencyMode({
    stepPlain: workflow.steps[2],
    depId: "loop_inner",
    workflow
  });
  assert.equal(modeOuter, "iteration");
  assert.equal(modeInner, "iteration");
}

function run() {
  runBarrierVsIterationTest();
  runIsStepInsideLoopModeTest();
  runNestedInferenceTest();
  console.log("[OK] foreach-downstream-gate-test passed");
}

try {
  run();
  process.exit(0);
} catch (err) {
  console.error("[FAIL] foreach-downstream-gate-test", err?.message || String(err));
  process.exit(1);
}
