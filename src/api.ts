export const API_URL = 'http://localhost:4000'

export interface User {
  name: string
  email: string
  token: string
}

export async function authRequest(
  mode: 'login' | 'signup',
  body: Record<string, string>
): Promise<User> {
  const res = await fetch(`${API_URL}/auth/${mode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
  return data as User
}

const STORE_KEY = 'equilibrium_user'

export function loadUser(): User | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

export function saveUser(user: User | null): void {
  if (user) localStorage.setItem(STORE_KEY, JSON.stringify(user))
  else localStorage.removeItem(STORE_KEY)
}
