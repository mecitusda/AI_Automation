import { Routes, Route } from "react-router-dom"
import RunDetailPage from "./pages/RunDetailPage"
import RunsPage from "./pages/RunsPage"
import WorkflowsPage from "./pages/WorkflowsPage"
import WorkflowDetailPage from "./pages/WorkflowDetailPage"


export default function App() {
  return (
    <div className="main">
      <Routes>
        <Route path="/" element={<RunsPage />} />
        <Route path="/runs/:id" element={<RunDetailPage />} />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/workflows/:id" element={<WorkflowDetailPage />} />
      </Routes>
    </div>
  )
}