const API_URL = import.meta.env.VITE_API_URL

export async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`)

  if (!res.ok) {
    throw new Error("API Error")
  }

  return res.json()
}