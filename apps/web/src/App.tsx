import { Routes, Route, Link, Navigate, useLocation } from "react-router-dom"
import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import RunDetailPage from "./pages/RunDetailPage"
import RunsPage from "./pages/RunsPage"
import WorkflowsPage from "./pages/WorkflowsPage"
import WorkflowDetailPage from "./pages/WorkflowDetailPage"
import WorkflowEditPage from "./pages/WorkflowEditPage"
import TemplatesPage from "./pages/TemplatesPage"
import MetricsDashboardPage from "./pages/MetricsDashboardPage"
import CredentialsPage from "./pages/CredentialsPage"
import DataStorePage from "./pages/DataStorePage"
import PluginsPage from "./pages/PluginsPage"
import NotFoundPage from "./pages/NotFoundPage"
import SystemPage from "./pages/SystemPage"
import HomePage from "./pages/HomePage"
import DocsPage from "./pages/DocsPage"
import { RunDataProvider } from "./contexts/RunDataContext"
import LoginPage from "./pages/LoginPage"
import { clearAccessToken, getAccessToken, getCurrentUserRole, getRefreshToken, getApiBaseUrl } from "./api/client"
import { connectSocket, disconnectSocket } from "./api/socket"
import { ToastProvider } from "./components/ui"
import { useI18n } from "./hooks/useI18n"
import SwitchThemeButton from "./components/SwitchThemeButton"
import "./styles/Header.css"

function RequireAuth({ isAuthed, children }: { isAuthed: boolean; children: ReactNode }) {
  if (!isAuthed) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const { t, theme, toggleTheme, language, setLanguage } = useI18n();
  const pathname = useLocation().pathname;
  const isWorkflowEditRoute = /^\/workflows\/[^/]+\/edit$/.test(pathname);
  const isStandaloneRoute = pathname === "/" || pathname === "/docs";
  const isAuthed = Boolean(getAccessToken());
  const isAdmin = getCurrentUserRole() === "admin";
  const [standaloneScrolled, setStandaloneScrolled] = useState(false);
  useEffect(() => {
    if (isAuthed) {
      connectSocket()
      return
    }
    disconnectSocket()
  }, [isAuthed])

  return (
    <ToastProvider>
    <RunDataProvider>
    <div className={`main${isAuthed ? "" : " main--authShell"}`}>
      {isStandaloneRoute ? (
        <div
          className={`standaloneShell${pathname === "/docs" ? " standaloneShell--docs" : ""}${pathname === "/" ? " standaloneShell--home" : ""} standaloneShell--marketing`}
          onScroll={(event) => {
            const top = event.currentTarget.scrollTop;
            setStandaloneScrolled((prev) => (prev ? top > 6 : top > 18));
          }}
        > 
          <header className={`standaloneHeader${standaloneScrolled ? " standaloneHeader--scrolled" : ""}`}>
            <div  className="standaloneHeader__brand">
              <Link to="/" className="standaloneHeader__mark"><img src="/images/logo.png" alt="AI Automation" /></Link>
              <Link to="/" className={pathname === "/" ? "active" : ""}>{t("nav.home")}</Link>
              <Link to="/docs" className={pathname === "/docs" ? "active" : ""}>{t("nav.docs")}</Link>
             
            </div>
            
            {pathname === "/docs" ? (
              <div className="standaloneHeader__search">
                <span>{t("nav.searchDocs")}</span>
                <kbd>⌘K</kbd>
              </div>
            ) : null}
            <nav className="standaloneHeader__nav" aria-label="Site navigation">

              <div className="standaloneHeader__rightLink">
              <select
                  className="navControlSelect"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as "en" | "tr")}
                  aria-label="Language"
                >
                  <option value="en">{t("lang.en")}</option>
                  <option value="tr">{t("lang.tr")}</option>
                </select>
              <SwitchThemeButton
                  checked={theme === "dark"}
                  onChange={toggleTheme}
                  ariaLabel={theme === "dark" ? t("theme.dark") : t("theme.light")}
                />
                <Link to="/login">{t("nav.signIn")}</Link>
              </div>
            </nav>
          </header>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/docs" element={<DocsPage />} />
          </Routes>
          {pathname === "/" ? (
            <footer className="homeFooterV2">
              <div className="homeFooterV2__inner">
                <div>
                  <h2>{t("home.footer.brandTitle")}</h2>
                  <p>{t("home.footer.brandText")}</p>
                </div>
                <div className="homeFooterV2__links">
                  <div>
                    <h2>{t("home.footer.product")}</h2>
                    <Link to="/workflows">{t("home.footer.workflowStudio")}</Link>
                    <Link to="/plugins">{t("home.footer.pluginCatalog")}</Link>
                    <Link to="/templates">{t("home.footer.templates")}</Link>
                  </div>
                  <div>
                    <h2>{t("home.footer.operations")}</h2>
                    <Link to="/runs">{t("home.footer.runs")}</Link>
                    <Link to="/data-store">{t("home.footer.dataStore")}</Link>
                    <Link to={isAdmin ? "/system" : "/docs"}>{isAdmin ? t("home.footer.system") : t("home.footer.docs")}</Link>
                  </div>
                  <div>
                    <h2>{t("home.footer.resources")}</h2>
                    <Link to="/docs">{t("home.footer.docs")}</Link>
                    <Link to="/credentials">{t("home.footer.credentials")}</Link>
                    <Link to="/login">{t("home.footer.login")}</Link>
                  </div>
                </div>
              </div>
            </footer>
          ) : null}
        </div>
      ) : isAuthed ? (
      <div className="appShell">
        <aside className="nav">
          <div className="nav__top">
            <div className="nav__brand">AI Automation</div>
            <div className="nav__links">
              <Link to="/runs" className={pathname.startsWith("/runs") ? "active" : ""}>{t("nav.runs")}</Link>
              <Link to="/workflows" className={pathname.startsWith("/workflows") ? "active" : ""}>{t("nav.workflows")}</Link>
              <Link to="/templates" className={pathname === "/templates" ? "active" : ""}>{t("nav.templates")}</Link>
              <Link to="/plugins" className={pathname === "/plugins" ? "active" : ""}>{t("nav.plugins")}</Link>
              <Link to="/credentials" className={pathname === "/credentials" ? "active" : ""}>{t("nav.credentials")}</Link>
              <Link to="/data-store" className={pathname === "/data-store" ? "active" : ""}>{t("nav.dataStore")}</Link>
              {isAdmin ? (
              <Link to="/metrics" className={pathname === "/metrics" ? "active" : ""}>{t("nav.metrics")}</Link>
              ) : null}
              {isAdmin ? (
              <Link to="/system" className={pathname === "/system" ? "active" : ""}>{t("nav.system")}</Link>
              ) : null}
                
            </div>
            <div className="nav__prefs">
            <SwitchThemeButton
              checked={theme === "dark"}
              onChange={toggleTheme}
              ariaLabel={theme === "dark" ? t("theme.dark") : t("theme.light")}
            />
              <select
                className="navControlSelect"
                value={language}
                onChange={(event) => setLanguage(event.target.value as "en" | "tr")}
                aria-label="Language"
              >
                <option value="en">{t("lang.en")}</option>
                <option value="tr">{t("lang.tr")}</option>
              </select>
            </div>
          </div>
              
          
          <button
            type="button"
            className="nav__logout"
            onClick={() => {
              const refreshToken = getRefreshToken();
              if (refreshToken) {
                fetch(`${getApiBaseUrl()}/auth/logout`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ refreshToken })
                }).catch(() => undefined);
              }
              clearAccessToken();
              disconnectSocket();
              window.location.href = "/login";
            }}
          >
            {t("nav.logout")}
          </button>
        </aside>
        <div className={`appShell__content${isWorkflowEditRoute ? " appShell__content--edit" : ""}`}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<Navigate to="/runs" replace />} />
            <Route
              path="/metrics"
              element={
                <RequireAuth isAuthed={isAuthed}>
                  {isAdmin ? <MetricsDashboardPage /> : <Navigate to="/" replace />}
                </RequireAuth>
              }
            />
            <Route path="/runs" element={<RequireAuth isAuthed={isAuthed}><RunsPage /></RequireAuth>} />
            <Route path="/runs/:id" element={<RequireAuth isAuthed={isAuthed}><RunDetailPage /></RequireAuth>} />
            <Route path="/workflows" element={<RequireAuth isAuthed={isAuthed}><WorkflowsPage /></RequireAuth>} />
            <Route path="/workflows/:id" element={<RequireAuth isAuthed={isAuthed}><WorkflowDetailPage /></RequireAuth>} />
            <Route path="/workflows/:id/edit" element={<RequireAuth isAuthed={isAuthed}><WorkflowEditPage /></RequireAuth>} />
            <Route path="/templates" element={<RequireAuth isAuthed={isAuthed}><TemplatesPage /></RequireAuth>} />
            <Route path="/plugins" element={<RequireAuth isAuthed={isAuthed}><PluginsPage /></RequireAuth>} />
            <Route path="/credentials" element={<RequireAuth isAuthed={isAuthed}><CredentialsPage /></RequireAuth>} />
            <Route path="/data-store" element={<RequireAuth isAuthed={isAuthed}><DataStorePage /></RequireAuth>} />
            <Route
              path="/system"
              element={
                <RequireAuth isAuthed={isAuthed}>
                  {isAdmin ? <SystemPage /> : <Navigate to="/" replace />}
                </RequireAuth>
              }
            />
            <Route path="*" element={<RequireAuth isAuthed={isAuthed}><NotFoundPage /></RequireAuth>} />
          </Routes>
        </div>
      </div>
      ) : (
      <header className="authHeader" role="banner">
        <div className="authHeader__inner">
          <span className="authHeader__brand">AI Automation</span>
          <span className="authHeader__tagline">{t("nav.workflowAutomationPlatform")}</span>
        </div>
      </header>
      )} 
      
      {!isAuthed && !isStandaloneRoute ? (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      ) : null}
    </div>
    </RunDataProvider>
    </ToastProvider>
  )
}