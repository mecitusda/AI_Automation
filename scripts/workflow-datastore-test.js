import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../apps/api/src/config/db.js";
import dbSet from "../apps/api/src/plugins/db.set.js";
import dbGet from "../apps/api/src/plugins/db.get.js";
import dbQuery from "../apps/api/src/plugins/db.query.js";
import dbDelete from "../apps/api/src/plugins/db.delete.js";
import { getPlatformModels } from "../apps/api/src/utils/tenantModels.js";

async function ensureTestScope() {
  const { User, Workflow } = getPlatformModels();
  let user = await User.findOne({ email: "datastore-test@local.dev" });
  if (!user) {
    user = await User.create({
      email: "datastore-test@local.dev",
      passwordHash: "dev-no-auth",
      name: "Datastore Test",
      role: "admin"
    });
  }
  let workflow = await Workflow.findOne({ name: "Datastore Test Workflow", userId: user._id });
  if (!workflow) {
    workflow = await Workflow.create({
      userId: user._id,
      name: "Datastore Test Workflow",
      enabled: true,
      trigger: { type: "manual" },
      steps: [],
      maxParallel: 5,
      currentVersion: 1,
      versions: [{ version: 1, steps: [], maxParallel: 5, createdAt: new Date() }]
    });
  }
  return { user, workflow };
}

async function run() {
  await connectDB();
  const { user, workflow } = await ensureTestScope();
  const context = {
    userId: user._id.toString(),
    workflowId: workflow._id.toString()
  };

  const key = `test.key.${Date.now()}`;

  await dbSet.executor({
    params: { key, value: { status: "ok", count: 1 }, tags: "qa,test" },
    context
  });
  const getResult = await dbGet.executor({
    params: { key },
    context
  });
  if (!getResult?.output?.found) throw new Error("db.get failed after db.set");

  const queryResult = await dbQuery.executor({
    params: { keyPrefix: "test.key.", limit: 10 },
    context
  });
  if ((queryResult?.output?.count ?? 0) < 1) throw new Error("db.query returned empty");

  const delResult = await dbDelete.executor({
    params: { key },
    context
  });
  if ((delResult?.output?.deletedCount ?? 0) !== 1) throw new Error("db.delete did not delete");

  console.log("[OK] workflow-datastore-test passed");
  await mongoose.connection.close();
}

run().catch(async (err) => {
  console.error("[FAIL] workflow-datastore-test", err?.message || err);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
