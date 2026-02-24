import "dotenv/config";
import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./config/swagger.js";
import { startOrchestrator } from "./orchestrator.js";
import { startWorker } from "./worker.js";
import http from "http";
import { initSocket } from "./socket.js";
import { connectDB } from "./config/db.js";
import { connectRabbit } from "./config/rabbit.js";
import workflowRoutes from "./routes/workflow.routes.js";
import runRoutes from "./routes/run.routes.js";
import { startScheduler } from "./config/scheduler.js";

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());


await connectRabbit();
await connectDB();

const httpServer = http.createServer(app);
const io = initSocket(httpServer);


app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use("/runs", runRoutes);
app.use("/workflows", workflowRoutes);

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