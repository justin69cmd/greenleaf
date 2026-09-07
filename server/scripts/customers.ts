import { raw, recentLoginEvents, type UserRow } from '../db.js'

// Read-only look at what the customer database holds.
//   npm run db:customers            → every account
//   npm run db:customers ada@x.com  → one account plus its recent sign-in events
//
// Password hashes, TOTP secrets and recovery codes are never printed.

const [filter] = process.argv.slice(2)

const users = filter
  ? raw().prepare<[string], UserRow>('SELECT * FROM users WHERE email = ?').all(filter)
  : raw().prepare<[], UserRow>('SELECT * FROM users ORDER BY id').all()

if (users.length === 0) {
  console.log(filter ? `No account for ${filter}.` : 'No accounts yet.')
  process.exit(0)
}

console.table(
  users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    verified: Boolean(u.email_verified),
    authenticator: Boolean(u.totp_enabled),
    created: u.created_at,
    lastLogin: u.last_login_at ?? '—',
  }))
)

if (filter) {
  const events = recentLoginEvents(users[0].id, 20)
  console.log(`\nRecent sign-in activity for ${users[0].email}:`)
  console.table(
    events.map((e) => ({ at: e.created_at, stage: e.stage, outcome: e.outcome, ip: e.ip ?? '—', detail: e.detail ?? '' }))
  )
}
