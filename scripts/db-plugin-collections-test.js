import "./load-root-env.js";
import mongoose from "mongoose";
import { connectDB } from "../apps/api/src/config/db.js";
import dbSet from "../apps/api/src/plugins/db.set.js";
import dbGet from "../apps/api/src/plugins/db.get.js";
import dbQuery from "../apps/api/src/plugins/db.query.js";
import dbDelete from "../apps/api/src/plugins/db.delete.js";
import { getPlatformModels } from "../apps/api/src/utils/tenantModels.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

async function ensureTestScope() {
  const { User, Workflow } = getPlatformModels();
  let user = await User.findOne({ email: "datastore-collections-test@local.dev" });
  if (!user) {
    user = await User.create({
      email: "datastore-collections-test@local.dev",
      passwordHash: "dev-no-auth",
      name: "Datastore Collections Test",
      role: "admin"
    });
  }
  let workflow = await Workflow.findOne({ name: "Datastore Collections Workflow", userId: user._id });
  if (!workflow) {
    workflow = await Workflow.create({
      userId: user._id,
      name: "Datastore Collections Workflow",
      enabled: true,
      trigger: { type: "manual" },
      steps: [],
      maxParallel: 5,
      currentVersion: 1,
      versions: [{ version: 1, steps: [], maxParallel: 5, createdAt: new Date() }]
    });
  }
  let workflow2 = await Workflow.findOne({ name: "Datastore Collections Workflow #2", userId: user._id });
  if (!workflow2) {
    workflow2 = await Workflow.create({
      userId: user._id,
      name: "Datastore Collections Workflow #2",
      enabled: true,
      trigger: { type: "manual" },
      steps: [],
      maxParallel: 5,
      currentVersion: 1,
      versions: [{ version: 1, steps: [], maxParallel: 5, createdAt: new Date() }]
    });
  }
  return { user, workflow, workflow2 };
}

async function cleanup({ user }) {
  const { WorkflowVariable } = getPlatformModels();
  await WorkflowVariable.deleteMany({ userId: user._id });
}

async function run() {
  await connectDB();
  const { user, workflow, workflow2 } = await ensureTestScope();
  await cleanup({ user });

  const ctx1 = { userId: user._id.toString(), workflowId: workflow._id.toString() };
  const ctx2 = { userId: user._id.toString(), workflowId: workflow2._id.toString() };
  const userScopeCtx = { userId: user._id.toString(), workflowId: workflow._id.toString() };

  // 1) writeMode = insertOnly (success then fail)
  const insRes1 = await dbSet.executor({
    params: {
      key: "k1",
      value: { v: 1 },
      collection: "test",
      writeMode: "insertOnly"
    },
    context: ctx1
  });
  assert(insRes1.success && insRes1.output.created, "insertOnly should create on first call");

  const insRes2 = await dbSet.executor({
    params: {
      key: "k1",
      value: { v: 2 },
      collection: "test",
      writeMode: "insertOnly"
    },
    context: ctx1
  });
  assert(insRes2.success === false, "insertOnly should fail on duplicate");

  // 2) writeMode = updateOnly (fail then success)
  const updRes1 = await dbSet.executor({
    params: {
      key: "missing-key",
      value: { v: 9 },
      collection: "test",
      writeMode: "updateOnly"
    },
    context: ctx1
  });
  assert(updRes1.success === false, "updateOnly should fail when key is absent");

  const updRes2 = await dbSet.executor({
    params: {
      key: "k1",
      value: { v: 99 },
      collection: "test",
      writeMode: "updateOnly"
    },
    context: ctx1
  });
  assert(updRes2.success && updRes2.output.updated, "updateOnly should update existing key");
  const getAfterUpd = await dbGet.executor({
    params: { key: "k1", collection: "test" },
    context: ctx1
  });
  assert(getAfterUpd.output.value?.v === 99, "updateOnly value should reflect the update");

  // 3) writeMode = skipIfExists
  const skipRes1 = await dbSet.executor({
    params: {
      key: "k2",
      value: { v: 1 },
      collection: "test",
      writeMode: "skipIfExists"
    },
    context: ctx1
  });
  assert(skipRes1.success && skipRes1.output.created, "skipIfExists creates first time");
  const skipRes2 = await dbSet.executor({
    params: {
      key: "k2",
      value: { v: 999 },
      collection: "test",
      writeMode: "skipIfExists"
    },
    context: ctx1
  });
  assert(skipRes2.success && skipRes2.output.skipped, "skipIfExists skips on duplicate");
  const skipGet = await dbGet.executor({
    params: { key: "k2", collection: "test" },
    context: ctx1
  });
  assert(skipGet.output.value?.v === 1, "skipIfExists must not overwrite existing value");

  // 4) append + matchOn (haber dedup scenario)
  const news1 = { url: "https://example.com/news/1", title: "First story" };
  const news2 = { url: "https://example.com/news/2", title: "Second story" };
  const news1Dup = { url: "https://example.com/news/1", title: "First story (dup)" };

  const ap1 = await dbSet.executor({
    params: {
      key: "feed",
      value: news1,
      collection: "news",
      writeMode: "append",
      matchOn: "url"
    },
    context: ctx1
  });
  assert(ap1.success && ap1.output.appendedCount === 1 && ap1.output.created, "first append creates array with one item");

  const ap2 = await dbSet.executor({
    params: {
      key: "feed",
      value: news2,
      collection: "news",
      writeMode: "append",
      matchOn: "url"
    },
    context: ctx1
  });
  assert(ap2.output.appendedCount === 1 && ap2.output.deduped === false, "second distinct append succeeds");

  const ap3 = await dbSet.executor({
    params: {
      key: "feed",
      value: news1Dup,
      collection: "news",
      writeMode: "append",
      matchOn: "url"
    },
    context: ctx1
  });
  assert(ap3.output.appendedCount === 0 && ap3.output.deduped === true, "duplicate append should be deduped");

  const feedGet = await dbGet.executor({
    params: { key: "feed", collection: "news" },
    context: ctx1
  });
  assert(Array.isArray(feedGet.output.value) && feedGet.output.value.length === 2, "feed must have exactly two items after dedup");

  // 5) scope = user (shared across workflows)
  await dbSet.executor({
    params: {
      key: "shared",
      value: { hello: "world" },
      scope: "user",
      collection: "shared",
      writeMode: "upsert"
    },
    context: userScopeCtx
  });
  const sharedFromW1 = await dbGet.executor({
    params: { key: "shared", scope: "user", collection: "shared" },
    context: ctx1
  });
  const sharedFromW2 = await dbGet.executor({
    params: { key: "shared", scope: "user", collection: "shared" },
    context: ctx2
  });
  assert(sharedFromW1.output.found && sharedFromW1.output.value?.hello === "world", "user scope readable from workflow A");
  assert(sharedFromW2.output.found && sharedFromW2.output.value?.hello === "world", "user scope readable from workflow B");

  // 6) Workflow scope isolation: ctx2 should NOT see ctx1's k1
  const isoMiss = await dbGet.executor({
    params: { key: "k1", collection: "test" },
    context: ctx2
  });
  assert(isoMiss.output.found === false, "workflow scope must isolate keys between workflows");

  // 7) db.query valueFilter (regex)
  const queryRes = await dbQuery.executor({
    params: {
      collection: "news",
      valueFilter: { url: { $regex: "news/2" } },
      limit: 10
    },
    context: ctx1
  });
  // valueFilter targets value.url. The feed entry stores an array, but mongo
  // matches array elements by path — so feed should match if it contains an
  // item with url containing news/2.
  assert(queryRes.output.count >= 1, "valueFilter regex should match feed array entry");

  // 8) collection isolation
  await dbSet.executor({
    params: { key: "k1", value: { v: 100 }, collection: "other", writeMode: "upsert" },
    context: ctx1
  });
  const otherGet = await dbGet.executor({
    params: { key: "k1", collection: "other" },
    context: ctx1
  });
  const testGet = await dbGet.executor({
    params: { key: "k1", collection: "test" },
    context: ctx1
  });
  assert(otherGet.output.value?.v === 100, "collection 'other' should hold its own k1");
  assert(testGet.output.value?.v === 99, "collection 'test' should still hold k1=99");

  // 9) db.delete byCollection
  const delByCol = await dbDelete.executor({
    params: { collection: "test", mode: "byCollection" },
    context: ctx1
  });
  assert(delByCol.output.deletedCount >= 2, "byCollection delete should remove all keys from the collection");
  const afterDel = await dbGet.executor({
    params: { key: "k1", collection: "test" },
    context: ctx1
  });
  assert(afterDel.output.found === false, "keys in deleted collection must not be retrievable");

  // 10) db.delete byKeyPrefix
  await dbSet.executor({
    params: { key: "news.2024.a", value: { v: 1 }, collection: "news", writeMode: "upsert" },
    context: ctx1
  });
  await dbSet.executor({
    params: { key: "news.2024.b", value: { v: 2 }, collection: "news", writeMode: "upsert" },
    context: ctx1
  });
  await dbSet.executor({
    params: { key: "news.2025.a", value: { v: 3 }, collection: "news", writeMode: "upsert" },
    context: ctx1
  });
  const delByPrefix = await dbDelete.executor({
    params: { collection: "news", mode: "byKeyPrefix", keyPrefix: "news.2024." },
    context: ctx1
  });
  assert(delByPrefix.output.deletedCount === 2, "byKeyPrefix should delete only matching prefix keys");

  await cleanup({ user });
  console.log("[OK] db-plugin-collections-test passed");
  await mongoose.connection.close();
}

run().catch(async (err) => {
  console.error("[FAIL] db-plugin-collections-test", err?.message || err);
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});
