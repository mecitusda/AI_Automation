import assert from "node:assert/strict";
import { resolveVariables } from "../apps/api/src/utils/variableResolver.js";

function runTwoLevelTest() {
  const context = {
    steps: {},
    run: { _id: "run-1" },
    trigger: {},
    env: {},
    loop: { loopStepId: "inner_loop", index: 1, item: { name: "Ali" } },
    loops: {
      outer_loop: { loopStepId: "outer_loop", index: 0, item: { groupName: "Team-A" } },
      inner_loop: { loopStepId: "inner_loop", index: 1, item: { name: "Ali" } }
    }
  };

  assert.equal(resolveVariables("{{ loops.outer_loop.item.groupName }}", context), "Team-A");
  assert.equal(resolveVariables("{{ loops.inner_loop.item.name }}", context), "Ali");
  assert.equal(resolveVariables("{{ loops.outer_loop.index }}", context), 0);
  assert.equal(resolveVariables("{{ loops.inner_loop.index }}", context), 1);
  assert.equal(resolveVariables("{{ loop.item.name }}", context), "Ali");
  assert.equal(resolveVariables("{{ loop.index }}", context), 1);
}

function runThreeLevelTest() {
  const context = {
    steps: {},
    run: { _id: "run-2" },
    trigger: {},
    env: {},
    loop: { loopStepId: "inner_loop", index: 2, item: { product: "P3" } },
    loops: {
      root_loop: { loopStepId: "root_loop", index: 4, item: { country: "TR" } },
      middle_loop: { loopStepId: "middle_loop", index: 1, item: { city: "Istanbul" } },
      inner_loop: { loopStepId: "inner_loop", index: 2, item: { product: "P3" } }
    }
  };

  const merged = resolveVariables(
    "x{{ loops.root_loop.item.country }}-{{ loops.middle_loop.item.city }}-{{ loop.item.product }}",
    context
  );
  assert.equal(merged, "xTR-Istanbul-P3");
}

function runParallelSafetyTest() {
  const base = {
    steps: {},
    run: { _id: "run-3" },
    trigger: {},
    env: {},
    loops: {
      outer_loop: { loopStepId: "outer_loop", index: 0, item: { batch: "B1" } }
    }
  };

  const ctxA = {
    ...base,
    loop: { loopStepId: "inner_loop", index: 0, item: { row: "R1" } },
    loops: {
      ...base.loops,
      inner_loop: { loopStepId: "inner_loop", index: 0, item: { row: "R1" } }
    }
  };
  const ctxB = {
    ...base,
    loop: { loopStepId: "inner_loop", index: 1, item: { row: "R2" } },
    loops: {
      ...base.loops,
      inner_loop: { loopStepId: "inner_loop", index: 1, item: { row: "R2" } }
    }
  };

  assert.equal(resolveVariables("x{{ loops.outer_loop.item.batch }}:{{ loops.inner_loop.item.row }}", ctxA), "xB1:R1");
  assert.equal(resolveVariables("x{{ loops.outer_loop.item.batch }}:{{ loops.inner_loop.item.row }}", ctxB), "xB1:R2");
  assert.equal(resolveVariables("{{ loops.unknown_loop.item.any }}", ctxA), undefined);
}

function run() {
  runTwoLevelTest();
  runThreeLevelTest();
  runParallelSafetyTest();
  console.log("[OK] nested-loop-context-test passed");
}

run();
