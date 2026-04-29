import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import App from "./App"
import ErrorBoundary from "./components/ErrorBoundary"
import { ThemeLanguageProvider } from "./contexts/ThemeLanguageContext"
import "./styles/global.css"
import "./styles/runs.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <ThemeLanguageProvider>
          <App />
        </ThemeLanguageProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
)