# 🍃 GreenLeaf — Your planner at service

GreenLeaf is an AI planning assistant powered by a **multi-agent swarm**. Describe a goal in plain
English — *"plan me a 3-day trip to Moscow"* — and an orchestrator splits it into subtasks, hands
each one to a specialist agent (researcher, writer, analyst), reviews the combined result with a
critic, and delivers a polished plan back into a leaf-swirl chat interface. Files the agents write
are downloadable straight from the conversation.

## ✨ Features

- **Agent swarm** — an orchestrator LLM plans subtasks and routes them to role specialists with
  their own tools (web search, page reading, file writing, code execution, API calls, charting)
- **Parallel execution** — the plan is a dependency *graph*, not a list: independent subtasks run
  at the same time, so a run costs the depth of the graph rather than its size
- **Critic loop** — a reviewer model grades the final answer and can demand one revision before
  anything reaches the user
- **Long-term memory** — finished runs are stored per account, and a new goal that resembles
  earlier work is planned and answered with that work as context
- **Run history** — search, reopen, and delete past runs; every artifact stays downloadable
- **Stop button** — cancel a run mid-flight; the swarm stands down between steps and saves what it has
- **Live telemetry** — token spend, call count, elapsed time, and which model actually answered
- **Model resilience** — automatic fallback chain across NVIDIA-hosted models on rate limits,
  outages, or empty responses, with per-model cooldowns
- **Live progress** — every specialist's step streams into the UI over WebSocket with animated
  task states
- **Real auth** — scrypt-hashed accounts, personalized greeting, session persistence
- **Tangible output** — files the agents save appear as download chips in the chat, with charts
  previewed inline
- **Voice input**, follow-up suggestion chips, refresh-proof conversations, and a gesture-reactive
  canvas of drifting leaves

## 🏗 Architecture

```mermaid
flowchart LR
    subgraph Frontend [React + Vite]
        UI[GreenLeaf UI\nSpline hero · leaf canvas · chat]
    end

    subgraph Backend [Express + WebSocket]
        WS[WS session] --> MEM[🧠 Memory\nrecall past runs]
        MEM --> PL[Planner\norchestrator LLM]
        PL --> SW{{Scheduler\nruns a DAG in parallel}}
        SW --> R[🔍 Researcher]
        SW --> W[✍️ Writer]
        SW --> A[📊 Analyst]
        R & W & A --> SY[Synthesizer]
        SY --> CR[🧐 Critic]
        CR -->|revise once| SY
        SY --> ST[(Run store\nhistory + memory)]
    end

    UI <-->|goal / progress / answer| WS
    R -->|web_search · read_url| NET[(Web)]
    W -->|write_file · read_file| FS[(agent_workspace)]
    A -->|run_code · call_api · make_chart| FS
    SY --> LLM[NVIDIA NIM API\nfallback chain]
```

**Model chain** (env-configurable, re-benchmarked 2026-09-04 on tool-calling, planner JSON, critic
and clarifier): `nvidia/nemotron-3-super-120b-a12b` → `openai/gpt-oss-20b` →
`nvidia/nemotron-3-ultra-550b-a55b`. The chain advances automatically on rate limits, empty
responses, and 404s, with per-model cooldowns. Catalog ids drift and a listed model can still 404 on
completions, so validate with a real call before changing the chain.

## 🚀 Quickstart

```bash
# 1. Backend
cd server
npm install
cp .env.example .env        # add your NVIDIA_API_KEY (free at build.nvidia.com)
npm run dev                 # http://localhost:4000

# 2. Frontend (new terminal, project root)
npm install
npm run dev                 # http://localhost:5173
```

Required env: `NVIDIA_API_KEY`. Optional: `NVIDIA_MODEL` / `NVIDIA_FALLBACK_MODELS` overrides,
SMTP credentials for email-a-PDF delivery, Google Custom Search keys for richer web search.

## 🗂 Project structure

```
├── src/                      # React frontend
│   ├── App.tsx               # views: home hero, team, journal, AI chat
│   └── components/ui/        # Spline hero, circular nav, chat, cards
├── server/                   # Express + WebSocket backend
│   ├── index.ts              # WS protocol, auth routes, file downloads
│   ├── auth.ts               # scrypt-hashed file-backed user store
│   └── agent/
│       ├── llm.ts            # NVIDIA client + model fallback chain
│       ├── planner.ts        # orchestrator → subtask JSON
│       ├── roles.ts          # specialist registry (tools per role)
│       ├── executor.ts       # tool-calling loop + synthesizer
│       ├── critic.ts         # answer review pass
│       └── tools.ts          # web_search, write_file, run_code, email
└── public/team/              # team photos
```

## 👥 Team

| | |
|---|---|
| **Justin** — *The Crazy coder* | architecture, agents, backend |
| **Anushka** — *The Psycho designer* | product, design, UX |

---

🌿 *Plan your days, track your goals, and grow one task at a time.*
