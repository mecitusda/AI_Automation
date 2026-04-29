import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getApiBaseUrl, setAccessToken, setRefreshToken } from "../api/client";
import { useI18n } from "../hooks/useI18n";
import "../styles/LoginPage.css";

export default function LoginPage() {
  const { t } = useI18n();
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
      if (!res.ok) throw new Error(json?.error || (mode === "register" ? t("login.registrationFailed") : t("login.loginFailed")));
      setAccessToken(json.accessToken);
      if (json.refreshToken) setRefreshToken(json.refreshToken);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : (mode === "register" ? t("login.registrationFailed") : t("login.loginFailed")));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="loginPage">
      <div className="loginPage__card">
        <header className="loginPage__brand">
          <h1 className="loginPage__title">
            {mode === "register" ? t("login.createAccountTitle") : t("login.welcomeBack")}
          </h1>
          <p className="loginPage__subtitle">
            {mode === "register"
              ? t("login.registerSubtitle")
              : t("login.loginSubtitle")}
          </p>
        </header>

        <div className="loginPage__tabs" role="tablist" aria-label={t("login.authenticationMode")}>
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
            {t("login.signIn")}
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
            {t("login.register")}
          </button>
        </div>

        <form className="loginPage__form" onSubmit={submit}>
          {mode === "register" ? (
            <div className="loginPage__field">
              <label className="loginPage__label" htmlFor="login-name">
                {t("login.name")}
              </label>
              <input
                id="login-name"
                className="loginPage__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("login.yourName")}
                autoComplete="name"
              />
            </div>
          ) : null}
          <div className="loginPage__field">
            <label className="loginPage__label" htmlFor="login-email">
              {t("login.email")}
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
              {t("login.password")}
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
                ? t("login.creatingAccount")
                : t("login.signingIn")
              : mode === "register"
                ? t("login.createAccount")
                : t("login.signIn")}
          </button>
          {error ? <div className="loginPage__error">{error}</div> : null}
        </form>
      </div>
    </div>
  );
}
