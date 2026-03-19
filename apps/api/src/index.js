import "dotenv/config";
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
import { seedTemplatesIfEmpty } from "./data/seedTemplates.js";

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());


await connectRabbit();
await connectDB();
await seedTemplatesIfEmpty();

const httpServer = http.createServer(app);
const io = initSocket(httpServer);


app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use("/runs", runRoutes);
app.use("/trigger", triggerRoutes);
app.use("/webhook", triggerRoutes);
app.use("/workflows", workflowRoutes);
app.use("/credentials", credentialRoutes);
app.use("/templates", templateRoutes);
app.use("/plugins", pluginRoutes);
app.use("/users", userRoutes);
app.use("/metrics", metricRoutes);
app.use("/monitoring", monitoringRoutes);

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