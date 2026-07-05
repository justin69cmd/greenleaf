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
Open `.env` and add your Gemini API key:
```
GEMINI_API_KEY=your_key_here
```

### 3. Run the server
```bash
npm run dev
```
Server starts on **http://localhost:4000**

---

## Tools available to the agent

| Tool | What it does |
|------|-------------|
| `web_search` | DuckDuckGo search (no key needed) or Google Custom Search |
| `write_file` | Writes files to `./agent_workspace/` |
| `call_api` | Makes HTTP requests to any external API |
| `send_email` | Sends email via SMTP (configure in .env) |
| `run_code` | Executes Node.js code in a sandboxed environment |

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
