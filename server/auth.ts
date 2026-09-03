import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// ── Simple file-backed user store with scrypt-hashed passwords ──────────────────
// Good enough for a demo: users persist to users.json, sessions live in memory.

export interface User {
  name: string
  email: string
  salt: string
  hash: string
  createdAt: string
}

export interface PublicUser {
  name: string
  email: string
  token: string
}

const USERS_FILE = path.join('/tmp', 'users.json')
const sessions = new Map<string, string>() // token -> email

function loadUsers(): Record<string, User> {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveUsers(users: Record<string, User>): void {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8')
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex')
}

function newToken(email: string): string {
  const token = crypto.randomBytes(24).toString('hex')
  sessions.set(token, email)
  return token
}

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

export function signup(name: string, email: string, password: string): PublicUser {
  email = (email ?? '').trim().toLowerCase()
  name = (name ?? '').trim()
  if (!isEmail(email)) throw new Error('Please enter a valid email address.')
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.')

  const users = loadUsers()
  if (users[email]) throw new Error('An account with this email already exists.')

  const salt = crypto.randomBytes(16).toString('hex')
  users[email] = {
    name: name || email.split('@')[0],
    email,
    salt,
    hash: hashPassword(password, salt),
    createdAt: new Date().toISOString(),
  }
  saveUsers(users)

  return { name: users[email].name, email, token: newToken(email) }
}

export function login(email: string, password: string): PublicUser {
  email = (email ?? '').trim().toLowerCase()
  const users = loadUsers()
  const user = users[email]
  if (!user) throw new Error('No account found with this email.')

  const attempt = hashPassword(password ?? '', user.salt)
  // timing-safe compare
  const ok =
    attempt.length === user.hash.length &&
    crypto.timingSafeEqual(Buffer.from(attempt), Buffer.from(user.hash))
  if (!ok) throw new Error('Incorrect password.')

  return { name: user.name, email, token: newToken(email) }
}

// Resolve a session token back to its email (used to authorize the agent run).
export function emailForToken(token?: string): string | null {
  if (!token) return null
  return sessions.get(token) ?? null
}
