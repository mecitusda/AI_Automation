const API_URL = import.meta.env.VITE_API_URL ?? "";
const TOKEN_KEY = "aa_access_token";
const REFRESH_TOKEN_KEY = "aa_refresh_token";

export function getApiBaseUrl(): string {
  return API_URL;
}

export function getAccessToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setAccessToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function setRefreshToken(token: string) {
  localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

export function getRefreshToken(): string {
  return localStorage.getItem(REFRESH_TOKEN_KEY) || "";
}

export function clearAccessToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getCurrentUserRole(): string {
  const token = getAccessToken();
  const payload = decodeJwtPayload(token);
  return typeof payload?.role === "string" ? payload.role : "";
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.accessToken) {
    clearAccessToken();
    return false;
  }
  setAccessToken(json.accessToken);
  if (json.refreshToken) setRefreshToken(json.refreshToken);
  return true;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, retryOnUnauthorized = true): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {})
    },
    ...init
  });

  const json = await res.json().catch(() => ({}));

  if (res.status === 401) {
    if (retryOnUnauthorized && await refreshAccessToken()) {
      return apiFetch<T>(path, init, false);
    }
    clearAccessToken();
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    throw new Error(json?.error || "API Error");
  }

  return json as T;
}