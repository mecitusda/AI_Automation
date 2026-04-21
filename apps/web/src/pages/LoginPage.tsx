import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getApiBaseUrl, setAccessToken } from "../api/client";
import "../styles/LoginPage.css";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const base = getApiBaseUrl();
      const endpoint = mode === "register" ? "/auth/register" : "/auth/login";
      const payload = mode === "register" ? { name, email, password } : { email, password };
      const res = await fetch(`${base}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || (mode === "register" ? "Registration failed" : "Login failed"));
      setAccessToken(json.accessToken);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : (mode === "register" ? "Registration failed" : "Login failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="loginPage">
      <div className="loginPage__card">
        <header className="loginPage__brand">
          <h1 className="loginPage__title">
            {mode === "register" ? "Create your account" : "Welcome back"}
          </h1>
          <p className="loginPage__subtitle">
            {mode === "register"
              ? "Sign up to manage workflows and automation runs."
              : "Sign in to continue to your dashboard."}
          </p>
        </header>

        <div className="loginPage__tabs" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className="loginPage__tab"
            onClick={() => {
              setMode("login");
              setError("");
            }}
            disabled={mode === "login"}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className="loginPage__tab"
            onClick={() => {
              setMode("register");
              setError("");
            }}
            disabled={mode === "register"}
          >
            Register
          </button>
        </div>

        <form className="loginPage__form" onSubmit={submit}>
          {mode === "register" ? (
            <div className="loginPage__field">
              <label className="loginPage__label" htmlFor="login-name">
                Name
              </label>
              <input
                id="login-name"
                className="loginPage__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
              />
            </div>
          ) : null}
          <div className="loginPage__field">
            <label className="loginPage__label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className="loginPage__input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              type="email"
              autoComplete="email"
              required
            />
          </div>
          <div className="loginPage__field">
            <label className="loginPage__label" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              className="loginPage__input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="••••••••"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              required
            />
          </div>
          <button type="submit" className="loginPage__submit" disabled={loading}>
            {loading
              ? mode === "register"
                ? "Creating account…"
                : "Signing in…"
              : mode === "register"
                ? "Create account"
                : "Sign in"}
          </button>
          {error ? <div className="loginPage__error">{error}</div> : null}
        </form>
      </div>
    </div>
  );
}
