/**
 * Compute structural diff between two workflow version snapshots.
 * Returns added step ids, removed step ids, and changed steps (by step id and field).
 */

function stepSignature(step) {
  return {
    id: step.id,
    type: step.type,
    dependsOn: (step.dependsOn || []).slice().sort(),
    retry: step.retry ?? 0,
    timeout: step.timeout ?? 0,
    paramsKeys: Object.keys(step.params || {}).sort()
  };
}

function stepEqual(a, b) {
  const sa = stepSignature(a);
  const sb = stepSignature(b);
  return (
    sa.id === sb.id &&
    sa.type === sb.type &&
    JSON.stringify(sa.dependsOn) === JSON.stringify(sb.dependsOn) &&
    sa.retry === sb.retry &&
    sa.timeout === sb.timeout &&
    JSON.stringify(sa.paramsKeys) === JSON.stringify(sb.paramsKeys)
  );
}

export function workflowVersionDiff(fromSteps, toSteps) {
  const fromMap = new Map((fromSteps || []).map((s) => [s.id, s]));
  const toMap = new Map((toSteps || []).map((s) => [s.id, s]));

  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, toStep] of toMap) {
    if (!fromMap.has(id)) {
      added.push(id);
    } else {
      const fromStep = fromMap.get(id);
      if (!stepEqual(fromStep, toStep)) {
        const changes = [];
        if (fromStep.type !== toStep.type) changes.push({ field: "type", old: fromStep.type, new: toStep.type });
        if (
          JSON.stringify((fromStep.dependsOn || []).slice().sort()) !==
          JSON.stringify((toStep.dependsOn || []).slice().sort())
        ) {
          changes.push({
            field: "dependsOn",
            old: fromStep.dependsOn,
            new: toStep.dependsOn
          });
        }
        if ((fromStep.retry ?? 0) !== (toStep.retry ?? 0)) {
          changes.push({ field: "retry", old: fromStep.retry ?? 0, new: toStep.retry ?? 0 });
        }
        if ((fromStep.timeout ?? 0) !== (toStep.timeout ?? 0)) {
          changes.push({ field: "timeout", old: fromStep.timeout ?? 0, new: toStep.timeout ?? 0 });
        }
        if (JSON.stringify(fromStep.params || {}) !== JSON.stringify(toStep.params || {})) {
          changes.push({ field: "params", old: fromStep.params, new: toStep.params });
        }
        if (changes.length) changed.push({ stepId: id, changes });
      }
    }
  }
  for (const id of fromMap.keys()) {
    if (!toMap.has(id)) removed.push(id);
  }

  return { added, removed, changed };
}
