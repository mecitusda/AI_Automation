import "./load-root-env.js";
import axios from "axios";

const API_URL = process.env.API_URL || "http://localhost:4000";

function client(token) {
  return axios.create({
    baseURL: API_URL,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

async function registerOrLogin(email, password) {
  try {
    const r = await axios.post(`${API_URL}/auth/register`, { email, password, name: email.split("@")[0] });
    return r.data.accessToken;
  } catch {
    const r = await axios.post(`${API_URL}/auth/login`, { email, password });
    return r.data.accessToken;
  }
}

async function run() {
  console.log("[TEST] auth-ownership-test");

  const tokenA = await registerOrLogin("owner.a@test.dev", "Secret123!");
  const tokenB = await registerOrLogin("owner.b@test.dev", "Secret123!");

  const apiA = client(tokenA);
  const apiB = client(tokenB);

  const wfRes = await apiA.post("/workflows", {
    name: "Owned Workflow A",
    trigger: { type: "manual" },
    steps: [{ id: "log_0", type: "log", params: { message: "owner-a" }, dependsOn: [] }],
    maxParallel: 2,
  });
  const workflowId = wfRes.data?._id || wfRes.data?.id;
  if (!workflowId) throw new Error("workflow create failed");

  const credRes = await apiA.post("/credentials", {
    name: "A Secret",
    type: "openai",
    data: { apiKey: "x-test" },
  });
  const credentialId = credRes.data?.id;
  if (!credentialId) throw new Error("credential create failed");

  let blockedWorkflow = false;
  try {
    await apiB.get(`/workflows/${workflowId}`);
  } catch (err) {
    const status = err?.response?.status;
    blockedWorkflow = status === 404 || status === 403;
  }
  if (!blockedWorkflow) throw new Error("Cross-user workflow access was not blocked");

  let blockedCredential = false;
  try {
    await apiB.get(`/credentials/${credentialId}`);
  } catch (err) {
    const status = err?.response?.status;
    blockedCredential = status === 404 || status === 403;
  }
  if (!blockedCredential) throw new Error("Cross-user credential access was not blocked");

  const myWorkflowsA = await apiA.get("/workflows");
  const myWorkflowsB = await apiB.get("/workflows");
  const aHas = (myWorkflowsA.data || []).some((w) => w.id === workflowId);
  const bHas = (myWorkflowsB.data || []).some((w) => w.id === workflowId);
  if (!aHas || bHas) throw new Error("Workflow ownership listing isolation failed");

  console.log("[OK] auth ownership and isolation checks passed");
}

run().catch((err) => {
  console.error("[FAIL]", err?.response?.data || err?.message || String(err));
  process.exit(1);
});
