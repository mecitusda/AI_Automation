import { Routes, Route, Link, Navigate, useLocation } from "react-router-dom"
import { useEffect } from "react"
import type { ReactNode } from "react"
import RunDetailPage from "./pages/RunDetailPage"
import RunsPage from "./pages/RunsPage"
import WorkflowsPage from "./pages/WorkflowsPage"
import WorkflowDetailPage from "./pages/WorkflowDetailPage"
import WorkflowEditPage from "./pages/WorkflowEditPage"
import TemplatesPage from "./pages/TemplatesPage"
import MetricsDashboardPage from "./pages/MetricsDashboardPage"
import { RunDataProvider } from "./contexts/RunDataContext"
import LoginPage from "./pages/LoginPage"
import { clearAccessToken, getAccessToken, getCurrentUserRole } from "./api/client"
import { connectSocket, disconnectSocket } from "./api/socket"
import "./styles/Header.css"

function RequireAuth({ isAuthed, children }: { isAuthed: boolean; children: ReactNode }) {
  if (!isAuthed) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const pathname = useLocation().pathname;
  const isAuthed = Boolean(getAccessToken());
  const isAdmin = getCurrentUserRole() === "admin";
  useEffect(() => {
    if (isAuthed) {
      connectSocket()
      return
    }
    disconnectSocket()
  }, [isAuthed])

  return (
    <RunDataProvider>
    <div className={`main${isAuthed ? "" : " main--authShell"}`}>
      {isAuthed ? (
      <nav className="nav">
        <Link to="/" className={pathname === "/" ? "active" : ""}>Runs</Link>
        <Link to="/workflows" className={pathname === "/workflows" ? "active" : ""}>Workflows</Link>
        {isAdmin ? (
        <Link to="/metrics" className={pathname === "/metrics" ? "active" : ""}>Metrics</Link>
        ) : null}
        <Link to="/templates" className={pathname === "/templates" ? "active" : ""}>Templates</Link>
        <button
          type="button"
          onClick={() => {
            clearAccessToken();
            disconnectSocket();
            window.location.href = "/login";
          }}
          style={{ marginLeft: "auto" }}
        >
          Logout
        </button>
      </nav>
      ) : (
      <header className="authHeader" role="banner">
        <div className="authHeader__inner">
          <span className="authHeader__brand">AI Automation</span>
          <span className="authHeader__tagline">Workflow automation platform</span>
        </div>
      </header>
      )}
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RequireAuth isAuthed={isAuthed}><RunsPage /></RequireAuth>} />
        <Route
          path="/metrics"
          element={
            <RequireAuth isAuthed={isAuthed}>
              {isAdmin ? <MetricsDashboardPage /> : <Navigate to="/" replace />}
            </RequireAuth>
          }
        />
        <Route path="/runs/:id" element={<RequireAuth isAuthed={isAuthed}><RunDetailPage /></RequireAuth>} />
        <Route path="/workflows" element={<RequireAuth isAuthed={isAuthed}><WorkflowsPage /></RequireAuth>} />
        <Route path="/workflows/:id" element={<RequireAuth isAuthed={isAuthed}><WorkflowDetailPage /></RequireAuth>} />
        <Route path="/workflows/:id/edit" element={<RequireAuth isAuthed={isAuthed}><WorkflowEditPage /></RequireAuth>} />
        <Route path="/templates" element={<RequireAuth isAuthed={isAuthed}><TemplatesPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to={isAuthed ? "/" : "/login"} replace />} />
      </Routes>
    </div>
    </RunDataProvider>
  )
}