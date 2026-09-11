# Equilibrium — AI Agent Backend

## Setup

### 1. Install dependencies
```bash
cd server
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Open `.env` and add your NVIDIA API key (free at https://build.nvidia.com):
```
NVIDIA_API_KEY=nvapi-...
```
Everything else in `.env.example` is optional — model chain, SMTP for PDF
delivery, Brave Search, swarm concurrency, and the run-history directory.

### 3. Run the server
```bash
npm run dev
```
Server starts on **http://localhost:4000**

---

## Tools available to the agent

| Tool | What it does |
|------|-------------|
| `web_search` | Brave (with a key) → DuckDuckGo → Wikipedia, in that order |
| `read_url` | Fetches a page and returns its readable text. Refuses loopback and private addresses |
| `write_file` | Writes files to `./agent_workspace/` |
| `read_file` | Reads a file another specialist saved in the workspace |
| `list_files` | Lists what is in the workspace |
| `call_api` | Makes HTTP requests to any external API |
| `run_code` | Executes Node.js code with a 10s timeout |
| `make_chart` | Renders bar/line/pie data as an SVG saved to the workspace |
| `send_email` | Sends email via SMTP (configure in .env) |

Each role gets only the tools it needs (see `agent/roles.ts`); `generalist`
gets all of them.

---

## How a run works

1. **Clarifier** asks up to 3 questions if the goal is vague (chat clients skip this).
2. **Planner** divides the goal into a *graph* of 2–4 subtasks, each assigned to a
   specialist and each declaring which other subtasks it depends on.
3. **Swarm** executes that graph: everything with no unmet dependency runs at the
   same time, capped by `SWARM_CONCURRENCY`. Cycles and unknown dependencies are
   repaired rather than rejected.
4. **Synthesizer** writes the final Markdown answer from the collected results.
5. **Critic** reviews it and can request one revision.
6. The run is persisted, and its token spend is reported.

A run can be stopped at any point — the server aborts between steps, saves what
it has, and replies `cancelled`.

### Memory

Finished runs are stored per account. When a new goal resembles earlier work by
the same user, the relevant passages are retrieved (TF-IDF over that user's own
history — no embedding service) and given to the planner, the specialists, and
the synthesizer as context. The client is told what was recalled.

---

## HTTP endpoints

| Method | Path | What it does |
|--------|------|-------------|
| `GET` | `/health` | Liveness check |
| `POST` | `/auth/signup`, `/auth/login` | Check credentials and open a sign-in challenge (rate limited) |
| `POST` | `/auth/verify-email-otp` | Layer 1 — the 6-digit code emailed to the account |
| `POST` | `/auth/verify-totp` | Layer 2 — an authenticator code, or a recovery code |
| `POST` | `/auth/resend-otp` | Send a fresh email code (30s cooldown, 3 per challenge) |
| `GET` | `/auth/me` | Account + two-factor status |
| `POST` | `/auth/totp/setup` | Start authenticator enrolment (returns secret, otpauth URL, QR) |
| `POST` | `/auth/totp/enable` | Confirm enrolment with a code; returns 8 recovery codes |
| `POST` | `/auth/totp/disable` | Turn the authenticator off (needs the password) |
| `POST` | `/auth/logout` | Revoke the current session token |
| `GET/POST` | `/schedules` | List or create recurring runs |
| `PATCH/DELETE` | `/schedules/:id` | Pause/resume or delete one |
| `POST` | `/schedules/:id/run` | Run one now, ignoring the clock |
| `POST` | `/schedules/tick` | Cron entry point (needs `CRON_SECRET`) |
| `GET` | `/calendar/connect` | Ask Google for calendar write access |
| `POST` | `/calendar/extract` | Propose events from a plan (writes nothing) |
| `POST` | `/calendar/events` | Write the confirmed events |
| `POST` | `/calendar/disconnect` | Forget the calendar grant |
| `POST/DELETE` | `/runs/:id/share` | Publish a run behind a link, or revoke it |
| `GET` | `/shares` | Links this account has published |
| `GET` | `/shared/:token` | Read a shared run (no session — the link is the credential) |
| `POST` | `/shared/:token/comments` | Comment on a shared run |
| `GET` | `/auth/config` | Whether "Continue with Google" is available |
| `GET` | `/auth/google` | Start a Google sign-in (redirects to Google) |
| `GET` | `/auth/google/callback` | Google returns here; redirects back to the app with a one-time code |
| `POST` | `/auth/handoff` | Swap that one-time code for a session, or for the authenticator step |
| `GET` | `/files/*` | Download a file from the workspace |
| `GET` | `/runs` | List the signed-in user's runs (`?q=` to search them) |
| `GET` | `/runs/:id` | Full record for one run |
| `DELETE` | `/runs/:id` | Delete one run |

Run endpoints and the `/auth/totp/*` routes need the session token as
`Authorization: Bearer <token>` (or `?token=`), and run endpoints only ever
return runs belonging to that account.

### Schedules

A schedule is a goal plus a cadence: *every Sunday at 20:00, plan my week and
email me the PDF*. Scheduled runs go through exactly the same pipeline as the
chat (`agent/run.ts` is shared by both), so they plan, run the swarm, get
reviewed by the critic and land in run history.

Cadence is stored in the customer's own timezone rather than as a UTC
timestamp, so "8pm Sunday" stays 8pm Sunday across daylight-saving changes. A
schedule fires at most once per local calendar day, which also means a restart
mid-day cannot replay one that already ran.

The runner is an in-process loop ticking every minute — **it needs a host where
the process stays alive**. On serverless, set `CRON_SECRET` and have an
external cron call `POST /schedules/tick` with `Authorization: Bearer <secret>`.

### Email delivery

Layer 1 of sign-in is a code emailed to the customer, so **broken email means
nobody can sign in**. The server says so at boot, and the whole thing is
checkable in one command:

```bash
npm run mail:test                  # verify the credentials
npm run mail:test you@example.com  # verify, then send a real test message
```

Two providers, picked from the environment (`server/mailer.ts`):

- `RESEND_API_KEY` — Resend's HTTPS API. Use this on the deployed backend:
  serverless hosts often block outbound SMTP.
- `SMTP_USER` + `SMTP_PASS` — plain SMTP, fine locally. For Gmail, `SMTP_PASS`
  must be a 16-character App Password (2-Step Verification on first), and
  `SMTP_USER` must be that same full Gmail address. Both a wrong username and a
  wrong password fail with the same `535` error.

Outside production, a failed send returns the code in the API response so local
work is never blocked. In production it never does — the sign-in simply cannot
finish until email works.

### Customer database

Accounts live in a SQLite file — `server/data/greenleaf.db` by default
(`/tmp/greenleaf.db` on Vercel, the only writable path there), overridable with
`DATABASE_FILE`. **On a serverless host accounts do not persist**: each instance
gets its own copy and `/tmp` is wiped. Deploy to a host with a real disk, or
move the store to Postgres, before real customers sign up. The schema is created on first boot
(`server/db.ts`), and a pre-existing `users.json` is imported once and renamed
to `users.json.migrated`.

| Table | What it holds |
|-------|---------------|
| `users` | name, email (unique), scrypt password hash + salt (null for Google-only accounts), email-verified flag, `google_sub`, avatar, TOTP secret, created/last-login timestamps |
| `recovery_codes` | one row per unused code, stored as a SHA-256 hash; consuming a code deletes the row |
| `sessions` | SHA-256 of each bearer token, its owner, and a 30-day expiry — tokens themselves are never stored |
| `login_challenges` | sign-ins in progress: which layer is next, and the hashed email code |
| `login_events` | audit trail — every attempt at every layer, with IP and outcome |
| `oauth_states` | a Google sign-in that has left for Google and not come back yet (state + PKCE verifier) |
| `auth_handoffs` | the one-time code the app swaps for its session after Google returns |

Because sessions and challenges are rows rather than memory, a restart no
longer signs everyone out or breaks a half-finished sign-in.

Look at what's stored (no secrets are printed):

```bash
npm run db:customers                    # every account
npm run db:customers ada@example.com    # one account + its recent sign-in events
```

### Continue with Google

OAuth 2.0 authorization code + PKCE, handled entirely server-side — the browser
never touches the client secret or an access token:

```
app → GET /auth/google?redirect=<app url>   → 302 to Google
Google → GET /auth/google/callback?code&state
        → exchanges the code, finds or creates the account
        → 302 back to the app with ?handoff=<one-time code>
app → POST /auth/handoff { code }
        → { stage: null, user }   (signed in)
        → { stage: "totp", challengeId }  (account has an authenticator)
```

- **Google replaces layer 1, never layer 2.** Google has verified the mailbox,
  so no email code is sent — but an account with an authenticator still has to
  produce a code, or enabling Google would become a way around 2FA.
- **Linking.** A Google sign-in whose verified email already has an account
  links to it (`users.google_sub`) instead of creating a duplicate.
- **Google-only accounts** have `password_hash = NULL`. Password sign-in tells
  them to use Google, and turning the authenticator off asks for a current
  authenticator code rather than a password.
- The `state` and the handoff code are single-use rows in the database, the
  handoff expires after 2 minutes, and the session token never appears in a URL.
- Return URLs are checked against the origin allowlist (`APP_ORIGIN`,
  `ALLOWED_ORIGINS`, localhost outside production) — no open redirect.
- Unconfigured is a supported state: `/auth/config` reports `google: false` and
  the button is not rendered. See `server/.env.example` for the console setup.

### Google Calendar

A plan is only useful if it ends up somewhere real, so a finished answer can be
turned into calendar events. Two steps, always:

```
POST /calendar/extract   → proposes events from a run's answer. Writes nothing.
POST /calendar/events    → writes the ones the customer ticked.
```

`agent/calendar.ts` asks the model for wall-clock times relative to a stated
"today" (it has no clock of its own), keeps only things that actually happen at
a time, and drops advice. Proposed times are timezone-naive because that is
what the customer means; comparing them against existing bookings resolves them
in the *customer's* zone, not the server's — otherwise a clash check on a UTC
server is wrong for everyone else. Verified across Kolkata, New York and a
Denver DST boundary.

Calendar permission is asked for separately from sign-in (incremental auth,
`access_type=offline`), only when someone wants it, and the refresh token is
stored on the user row. Revoking in Settings deletes it.

### Two-layer sign-in

`/auth/signup` and `/auth/login` never return a session token. They verify the
credentials and return a `challengeId` plus the layers still to clear:

```
POST /auth/login        → { challengeId, stage: "email_otp", factors: [...] }
POST /auth/verify-email-otp  → { stage: "totp" }        (account has an authenticator)
                             → { stage: null, user }    (it does not — token issued)
POST /auth/verify-totp  → { stage: null, user }         (token issued)
```

Codes are stored hashed in `login_challenges`, expire after 5 minutes, allow 5 wrong guesses, and a
whole challenge dies after 10 minutes. TOTP is RFC 6238 (SHA1, 6 digits, 30s
step, ±1 step of drift) implemented in `totp.ts`, so any authenticator app
works. Recovery codes are single-use and stored as SHA-256 hashes.

On signup, the account row is only written once the emailed code checks out —
an unverified email can never occupy an address.

If the OTP email cannot be sent, the server logs the code and (outside
`NODE_ENV=production`) returns it in the response so local work isn't blocked.

---

## Websocket messages

Client → server: `start`, `clarify`, `approve`, `cancel`, `followup`.
Server → client: `log`, `clarify`, `plan_proposed`, `plan`, `task_start`,
`task_done`, `tool_call`, `tool_result`, `usage`, `memory`, `run_saved`,
`agent_done`, `agent_error`, `cancelled`.

---

## Running both frontend + backend

Open two terminals:

**Terminal 1 — Frontend**
```bash
cd equilibrium
npm run dev
```

**Terminal 2 — Backend**
```bash
cd equilibrium/server
npm run dev
```

Then open **http://localhost:5173**
