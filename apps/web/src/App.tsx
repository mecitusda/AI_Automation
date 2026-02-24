import { Routes, Route } from "react-router-dom"
import RunDetailPage from "./pages/RunDetailPage"
import RunsPage from "./pages/RunsPage"


export default function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <Routes>
        <Route path="/" element={<RunsPage />} />
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </div>
  )
}