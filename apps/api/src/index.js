import "dotenv/config";
import { applyPublicDnsFromEnv } from "./utils/dnsBootstrap.js";

applyPublicDnsFromEnv();

import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./config/swagger.js";
import { startOrchestrator } from "./engine/orchestrator.js";
import { startWorker } from "./engine/worker.js";
import http from "http";
import { initSocket } from "./socket.js";
import { connectDB } from "./config/db.js";
import { connectRabbit } from "./config/rabbit.js";
import workflowRoutes from "./routes/workflow.routes.js";
import runRoutes from "./routes/run.routes.js";
import triggerRoutes from "./routes/trigger.routes.js";
import { startScheduler } from "./config/scheduler.js";
import metricRoutes from "./routes/metrics.routes.js"
import monitoringRoutes from "./routes/monitoring.routes.js";
import credentialRoutes from "./routes/credential.routes.js";
import templateRoutes from "./routes/template.routes.js";
import pluginRoutes from "./routes/plugin.routes.js";
import userRoutes from "./routes/user.routes.js";
import telegramRoutes from "./routes/telegram.routes.js";
import { seedTemplatesIfEmpty } from "./data/seedTemplates.js";
import authRoutes from "./routes/auth.routes.js";
import { authOptional, requireAdmin, requireAuth } from "./middleware/auth.js";

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: process.env.MAX_PAYLOAD_SIZE || "1mb" }));


await connectRabbit();
await connectDB();
await seedTemplatesIfEmpty();

const httpServer = http.createServer(app);
const io = initSocket(httpServer);


app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use("/auth", authRoutes);
app.use(authOptional);

app.use("/runs", requireAuth, runRoutes);
app.use("/trigger", triggerRoutes);
app.use("/webhook", triggerRoutes);
app.use("/workflows", requireAuth, workflowRoutes);
app.use("/credentials", requireAuth, credentialRoutes);
app.use("/templates", requireAuth, templateRoutes);
app.use("/plugins", pluginRoutes);
app.use("/users", requireAuth, userRoutes);
app.use("/telegram", requireAuth, telegramRoutes);
app.use("/metrics", requireAuth, requireAdmin, metricRoutes);
app.use("/monitoring", requireAuth, requireAdmin, monitoringRoutes);

app.use((err, _req, res, next) => {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({
      error: "Payload too large",
      maxPayload: process.env.MAX_PAYLOAD_SIZE || "1mb"
    });
  }
  return next(err);
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "api", ts: Date.now() });
});

const port = process.env.PORT || 4000;

httpServer.listen(port, async () => {
  console.log(`API running on http://localhost:${port}`);

  await startOrchestrator({ io });
  await startWorker({ io });
  await startScheduler(); 
});