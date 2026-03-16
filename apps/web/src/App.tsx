import { Routes, Route, Link, useLocation } from "react-router-dom"
import RunDetailPage from "./pages/RunDetailPage"
import RunsPage from "./pages/RunsPage"
import WorkflowsPage from "./pages/WorkflowsPage"
import WorkflowDetailPage from "./pages/WorkflowDetailPage"
import WorkflowEditPage from "./pages/WorkflowEditPage"
import TemplatesPage from "./pages/TemplatesPage"
import MetricsDashboardPage from "./pages/MetricsDashboardPage"
import { RunDataProvider } from "./contexts/RunDataContext"
import "./styles/Header.css"

export default function App() {
  const pathname = useLocation().pathname;
  return (
    <RunDataProvider>
    <div className="main">
      <nav className="nav">
        <Link to="/" className={pathname === "/" ? "active" : ""}>Runs</Link>
        <Link to="/workflows" className={pathname === "/workflows" ? "active" : ""}>Workflows</Link>
        <Link to="/metrics" className={pathname === "/metrics" ? "active" : ""}>Metrics</Link>
        <Link to="/templates" className={pathname === "/templates" ? "active" : ""}>Templates</Link>
      </nav>
      <Routes>
        <Route path="/" element={<RunsPage />} />
        <Route path="/metrics" element={<MetricsDashboardPage />} />
        <Route path="/runs/:id" element={<RunDetailPage />} />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/workflows/:id" element={<WorkflowDetailPage />} />
        <Route path="/workflows/:id/edit" element={<WorkflowEditPage />} />
        <Route path="/templates" element={<TemplatesPage />} />
      </Routes>
    </div>
    </RunDataProvider>
  )
}