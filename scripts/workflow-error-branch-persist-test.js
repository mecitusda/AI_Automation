/**
 * Verifies workflow steps persist `errorFrom` over API (PUT + GET).
 * Requires API running (e.g. npm run api) and .env with JWT secrets.
 */
import "./load-root-env.js";
import axios from "axios";

const API_URL = process.env.API_URL || "http://localhost:4000";

async function registerOrLogin(email, password) {
  try {
    const r = await axios.post(`${API_URL}/auth/register`, {
      email,
      password,
      name: email.split("@")[0],
    });
    return r.data.accessToken;
  } catch {
    const r = await axios.post(`${API_URL}/auth/login`, { email, password });
    return r.data.accessToken;
  }
}

async function run() {
  console.log("[TEST] workflow-error-branch-persist-test");

  const token = await registerOrLogin("error-branch-persist@test.dev", "Secret123!");
  const api = axios.create({
    baseURL: API_URL,
    headers: { Authorization: `Bearer ${token}` },
  });

  const steps = [
    {
      id: "step_0",
      type: "http",
      dependsOn: [],
      params: { url: "https://httpbin.org/status/404", method: "GET" },
      retry: 0,
      timeout: 0,
    },
    {
      id: "step_1",
      type: "log",
      dependsOn: ["step_0"],
      params: { message: "success path" },
      retry: 0,
      timeout: 0,
    },
    {
      id: "step_2",
      type: "log",
      dependsOn: ["step_0"],
      errorFrom: "step_0",
      params: { message: "error path" },
      retry: 0,
      timeout: 0,
    },
  ];

  const createRes = await api.post("/workflows", {
    name: `Error branch persist ${Date.now()}`,
    trigger: { type: "manual" },
    steps,
    maxParallel: 3,
  });

  const workflowId = createRes.data?._id || createRes.data?.id;
  if (!workflowId) throw new Error("workflow create failed");

  let detail = await api.get(`/workflows/${workflowId}`);
  let s2 = detail.data?.steps?.find((s) => s.id === "step_2");
  if (s2?.errorFrom !== "step_0") {
    throw new Error(`Expected step_2.errorFrom after create, got ${JSON.stringify(s2)}`);
  }

  const updatedSteps = detail.data.steps.map((s) =>
    s.id === "step_1" ? { ...s, params: { message: "success path v2" } } : s
  );
  await api.put(`/workflows/${workflowId}`, {
    steps: updatedSteps,
    maxParallel: detail.data.maxParallel ?? 3,
  });

  detail = await api.get(`/workflows/${workflowId}`);
  s2 = detail.data?.steps?.find((s) => s.id === "step_2");
  if (s2?.errorFrom !== "step_0") {
    throw new Error(`Expected step_2.errorFrom after PUT, got ${JSON.stringify(s2)}`);
  }

  console.log("[OK] errorFrom persisted on create and after PUT");
}

run().catch((err) => {
  console.error(err.response?.data || err.message || err);
  process.exit(1);
});
