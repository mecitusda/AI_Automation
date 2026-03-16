# Architecture Diagrams

This project uses [draw.io](https://app.diagrams.net) (diagrams.net) for architecture documentation. The diagram files live in `docs/` and should be opened in a draw.io–compatible viewer (e.g. [app.diagrams.net](https://app.diagrams.net) or the Draw.io Integration extension in VS Code/Cursor).

---

## Diagram Files

| File | Purpose |
|------|--------|
| **docs/api.drawio** | Backend architecture (API, engine, plugins, execution flow, storage) |
| **docs/web.drawio** | Frontend architecture (React app, workflow editor, step config, variables, API integration) |

---

## Styling Conventions (use when editing)

Apply these so diagrams stay readable on both light and dark backgrounds:

- **Text:** `fontColor=#1a1a1a` on all labels and content (title, swimlane headers, bullet lines, edge labels).
- **Relations (arrows/edges):** `strokeColor=#90caf9` so relations are visible on dark grid.
- **Section boxes:** Keep existing fill colors (e.g. `#dae8fc`, `#fff2cc`, `#d5e8d4`, `#e1d5e7`, `#f8cecc`); ensure text uses `fontColor=#1a1a1a`.

When adding new shapes or edges, reuse these style values.

---

## api.drawio — Backend Architecture

**Diagram name:** Backend Architecture

Update the **relevant parts** of this document when changing the backend diagram.

### 1. API Server
- Express Server
- Workflow routes (CRUD, versions)
- Plugin routes (GET /plugins, /plugins/:type)
- Run routes (list, detail, replay, trigger)
- Credential routes (GET /credentials, POST /credentials, GET /credentials/:id, DELETE /credentials/:id). **GET list and GET by id return only metadata:** `id`, `name`, `type`, `createdAt` (credential payload is never sent).

### 2. Workflow Engine
- **Models:** Workflow (steps, trigger, versions); Run (status, stepStates, outputs); StepStates (pending/running/completed/failed)
- **Components:** Orchestrator (dispatch, depsSatisfied); Scheduler (ready queue, DAG); Worker (consumes step.execute.q); Plugin executor (plugin.executor ?? execute)

### 3. RabbitMQ
- automation.direct; step.execute / step.result; run.start / step.retry; step.timeout / step.cancel

### 4. Plugin System
- Plugin registry (getPlugin, getAllPlugins); Plugin loader (plugins/index.js)
- Plugin executors: http, openai, log, delay; switch, merge, parallel; transform, setVariable, template, code
- Each plugin: type, label, category, schema, output, executor, validate
- Worker calls getPlugin(type); Result → step.result → Orchestrator

### 5. Execution Flow
- Steps 1–7: trigger → run created → scheduler finds ready steps → orchestrator publishes → worker executes plugin → output stored → next steps scheduled
- Special: IF/Switch branch skip, Merge multi-input, Error port, Retry + retryDelay

### 6. Data Storage (MongoDB)
- workflows; runs; logs (embedded in run); credentials

### Relations (arrows)
- API Server → Workflow Engine  
- Workflow Engine → RabbitMQ  
- RabbitMQ → Workflow Engine (consume job)  
- Workflow Engine → Plugin System (execute)  
- Workflow Engine → Data Storage  

---

## web.drawio — Frontend Architecture

**Diagram name:** Frontend Architecture

Update the **relevant parts** of this document when changing the frontend diagram.

### 1. React Application
- WorkflowEditPage (canvas + toolbar); WorkflowDetailPage (read-only); RunsPage, RunDetailPage
- RunDebuggerPanel (Input, Logs, step viewer); WorkflowEditorContext, RunDataContext

### 2. Workflow Editor (React Flow)
- React Flow canvas; WorkflowGraph (nodes, edges, onConnect)
- DefaultNode (handles, summaryTemplate); IfNode (branch handles)
- Node handles (inputs, outputs, errorOutput); Edge system (sourceHandle → step.branch / errorFrom)
- nodeRegistry (nodeTypes from plugins); stepsToNodesAndEdges (steps ↔ React Flow)

### 3. Step Configuration System
- StepEditModal (open on node click); SchemaForm (plugin.schema → UI fields)
- VariableAutocomplete; VariableTree (steps, trigger, loop)
- Flow: plugin.schema → SchemaForm → params; Step params stored in workflow.steps[id]
- InsertVariableButton, VariableHighlightedTextarea

### 4. Variable System
- Variable resolver (backend: variableResolver); Variable tree (run outputs / plugin.output schema)
- Step outputs: steps.\<stepId\>.output; Autocomplete (variableSystem.ts)
- Example paths: trigger.payload, loop.item, steps.stepId.output, lastError

### 5. API Integration
- GET /plugins; GET /workflows, GET /workflows/:id; POST /runs; GET /runs/:id/detail
- api/plugins.ts, workflow.ts, run.ts → Backend API (Express)

### Relations (arrows)
- React Application → Workflow Editor; Workflow Editor → Step Configuration System  
- Step Configuration System → Variable System (uses)  
- React Application → API Integration; API Integration → Backend API (HTTP)  

---

## How to use this in prompts

- When asked to **add or change something in the backend diagram**, edit **docs/api.drawio** and update the matching section above under **api.drawio**.
- When asked to **add or change something in the frontend diagram**, edit **docs/web.drawio** and update the matching section above under **web.drawio**.
- When asked to **document the architecture**, point to this file and the two drawio files; keep the lists above in sync with the diagrams.
