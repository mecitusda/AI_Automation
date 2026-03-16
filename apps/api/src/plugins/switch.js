export default {
  type: "switch",
  label: "Switch",
  category: "control",
  schema: [
    {
      key: "value",
      type: "string",
      label: "Value (variable or expression)",
      required: true,
      placeholder: "{{ trigger.action }}",
    },
    {
      key: "cases",
      type: "json",
      label: "Cases",
      placeholder: '[{"value": "a", "branch": "case_a"}, {"value": "b", "branch": "case_b"}]',
    },
    {
      key: "defaultBranch",
      type: "string",
      label: "Default branch",
      placeholder: "default",
    },
  ],
  output: {
    type: "object",
    properties: {
      branch: { type: "string" },
      matchedCase: { type: "number" },
      value: {},
    },
  },
  handles: {
    inputs: [{ id: "default" }],
    outputs: [{ id: "default" }, { id: "case_0" }, { id: "case_1" }],
  },
  executor: async ({ params, previousOutput }) => {
    const raw = params?.value;
    const cases = Array.isArray(params?.cases) ? params.cases : [];
    const defaultBranch = params?.defaultBranch ?? "default";

    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const caseVal = c?.value;
      if (raw === caseVal || (typeof raw === "string" && String(caseVal) === raw)) {
        return {
          success: true,
          output: { branch: c?.branch ?? `case_${i}`, matchedCase: i, value: raw },
        };
      }
    }
    return {
      success: true,
      output: { branch: defaultBranch, matchedCase: -1, value: raw },
    };
  },
};
