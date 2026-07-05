import { useState } from 'react'
import {
  Monitor, Mail, MailCheck, AlertCircle, Check, X, Send,
  Search, PenLine, Calculator, Bot, Circle, Loader2, CheckCircle2, XCircle,
  type LucideIcon,
} from 'lucide-react'
import { useAgent, type DeliveryMode, type AgentRole } from './hooks/useAgent'
import type { AgentTask } from './hooks/useAgent'
import type { User } from './api'
import ResultView from './ResultView'
import { ProgressiveFluxLoader } from '@/components/ui/progressive-flux-loader'
import { BorderRotate } from '@/components/ui/animated-gradient-border'

// The agent result wrapped in an animated purple gradient border.
function ResultBox({ summary }: { summary: string }) {
  return (
    <BorderRotate
      animationSpeed={8}
      borderWidth={2}
      borderRadius={16}
      backgroundColor="#130c22"
      className="w-full overflow-hidden"
    >
      <ResultView summary={summary} />
    </BorderRotate>
  )
}

const RUN_PHASES = [
  { at: 0, label: 'working' },
  { at: 45, label: 'building' },
  { at: 80, label: 'finishing' },
  { at: 100, label: 'done' },
]

const ROLE_META: Record<AgentRole, { Icon: LucideIcon; label: string; cls: string }> = {
  researcher: { Icon: Search, label: 'Researcher', cls: 'bg-sky-500/20 text-sky-200' },
  writer: { Icon: PenLine, label: 'Writer', cls: 'bg-amber-500/20 text-amber-200' },
  analyst: { Icon: Calculator, label: 'Analyst', cls: 'bg-emerald-500/20 text-emerald-200' },
  generalist: { Icon: Bot, label: 'Agent', cls: 'bg-white/10 text-white/70' },
}

function RoleBadge({ role }: { role?: AgentRole }) {
  const { Icon, label, cls } = ROLE_META[role ?? 'generalist']
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      <Icon size={11} strokeWidth={2} />
      {label}
    </span>
  )
}

interface Props {
  user: User | null
  onRequireAuth: () => void
}

function StatusIcon({ status }: { status: AgentTask['status'] }) {
  switch (status) {
    case 'pending': return <Circle size={14} className="text-white/40" />
    case 'running': return <Loader2 size={14} className="text-yellow-300 animate-spin" />
    case 'done':    return <CheckCircle2 size={14} className="text-green-400" />
    case 'failed':  return <XCircle size={14} className="text-red-400" />
  }
}

// Inline form for the agent's clarifying questions.
function ClarifyForm({
  questions,
  onSubmit,
}: {
  questions: string[]
  onSubmit: (answers: { question: string; answer: string }[]) => void
}) {
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ''))

  return (
    <div className="mt-4 space-y-3">
      <p className="text-xs text-white/50">A couple of quick questions so I get this right:</p>
      {questions.map((q, i) => (
        <div key={i}>
          <label className="text-sm text-white/80 block mb-1.5">{q}</label>
          <input
            autoFocus={i === 0}
            value={answers[i]}
            onChange={(e) => setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))}
            placeholder="Your answer (optional)"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors"
          />
        </div>
      ))}
      <button
        onClick={() => onSubmit(questions.map((q, i) => ({ question: q, answer: answers[i] })))}
        className="w-full btn-gold text-sm font-medium py-2.5 rounded-full transition-colors"
      >
        Continue →
      </button>
    </div>
  )
}

export default function AgentPanel({ user, onRequireAuth }: Props) {
  const { state, start, submitClarifications, approvePlan, cancel, sendFollowup, reset } = useAgent()
  const [input, setInput] = useState('')
  const [followup, setFollowup] = useState('')
  const [delivery, setDelivery] = useState<DeliveryMode>('screen')
  const [email, setEmail] = useState(user?.email ?? '')


  const handleSubmit = () => {
    if (!input.trim()) return
    if (delivery === 'email') {
      const to = (email || user?.email || '').trim()
      if (!to) return onRequireAuth()
      start(input.trim(), { delivery: 'email', email: to, token: user?.token })
    } else {
      start(input.trim(), { delivery: 'screen', token: user?.token })
    }
    setInput('')
  }

  const toggle = (mode: DeliveryMode, Icon: typeof Monitor, label: string) => (
    <button
      onClick={() => setDelivery(mode)}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${
        delivery === mode ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/80'
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  )

  const isBusy = state.status === 'thinking' || state.status === 'running'

  // Drive the loading buffer from task progress while running.
  const doneCount = state.tasks.filter((t) => t.status === 'done' || t.status === 'failed').length
  const runningCount = state.tasks.filter((t) => t.status === 'running').length
  const runProgress = state.tasks.length
    ? Math.min(99, Math.round(((doneCount + runningCount * 0.45) / state.tasks.length) * 100))
    : 8

  return (
    <div className="liquid-glass rounded-2xl p-5 w-full max-w-lg text-white">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-sm font-medium">AI Agent</span>
        {state.status !== 'idle' && (
          <button onClick={reset} className="ml-auto text-xs text-white/40 hover:text-white/70 transition-colors">
            Reset
          </button>
        )}
      </div>

      {/* Conversation history (previous turns) */}
      {state.history.length > 0 && (
        <div className="mb-3 space-y-2">
          {state.history.map((turn, i) => (
            <div key={i} className="text-xs">
              <p className="text-white/70">› {turn.goal}</p>
              <p className="text-white/30 pl-3 line-clamp-2">{turn.summary.replace(/[#*]/g, '').slice(0, 120)}…</p>
            </div>
          ))}
          <div className="border-t border-white/10" />
        </div>
      )}

      {/* Goal input (new conversation) */}
      {state.status === 'idle' && (
        <div className="space-y-3">
          <textarea
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 resize-none focus:outline-none focus:border-white/30 transition-colors"
            rows={3}
            placeholder="Describe your goal… e.g. Plan a 3-day trip, or research the top AI tools"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit() }}
          />
          <div>
            <p className="text-xs text-white/40 mb-1.5">Deliver the result via</p>
            <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
              {toggle('screen', Monitor, 'On screen')}
              {toggle('email', Mail, 'Email PDF')}
            </div>
          </div>
          {delivery === 'email' && (
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors"
            />
          )}
          <button
            onClick={handleSubmit}
            disabled={!input.trim()}
            className="w-full btn-gold text-sm font-medium py-2.5 rounded-full transition-colors disabled:opacity-30"
          >
            Start →
          </button>
        </div>
      )}

      {/* Thinking — animated loading buffer */}
      {state.status === 'thinking' && (
        <div className="py-3">
          <ProgressiveFluxLoader
            duration={6}
            className="max-w-full gap-4"
            textClassName="text-lg sm:text-xl"
            phases={[
              { at: 0, label: 'thinking' },
              { at: 50, label: 'planning' },
              { at: 90, label: 'almost there' },
            ]}
          />
        </div>
      )}

      {/* Clarifying questions */}
      {state.status === 'clarifying' && (
        <ClarifyForm
          key={state.clarifyQuestions.join('|')}
          questions={state.clarifyQuestions}
          onSubmit={submitClarifications}
        />
      )}

      {/* Plan proposed — awaiting approval */}
      {state.status === 'awaiting_approval' && (
        <div>
          <p className="text-xs text-white/50 mb-2">Here's my plan — each step goes to a specialist agent:</p>
          <div className="space-y-2.5 mb-4">
            {state.tasks.map((task, i) => (
              <div key={task.id} className="flex items-start gap-2.5">
                <span className="text-xs text-amber-300 font-semibold mt-0.5">{i + 1}.</span>
                <div className="flex-1">
                  <RoleBadge role={task.role} />
                  <p className="text-sm text-white/90 mt-1">{task.description}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={approvePlan}
              className="flex-1 flex items-center justify-center gap-1.5 btn-gold text-sm font-medium py-2.5 rounded-full transition-colors"
            >
              <Check size={15} /> Approve & Run
            </button>
            <button
              onClick={cancel}
              className="flex items-center justify-center gap-1.5 text-white/60 hover:text-white border border-white/15 hover:border-white/30 text-sm px-4 py-2.5 rounded-full transition-colors"
            >
              <X size={15} /> Cancel
            </button>
          </div>
        </div>
      )}

      {/* Running / finishing — loading buffer + live task checklist */}
      {(state.status === 'running' || state.status === 'finishing') && (
        <div>
          <ProgressiveFluxLoader
            value={state.status === 'finishing' ? 100 : runProgress}
            className="max-w-full gap-3 mb-5"
            textClassName="text-base sm:text-lg"
            phases={RUN_PHASES}
          />
          <p className="text-xs text-white/40 mb-3 uppercase tracking-wider">{state.goal}</p>
          <div className="space-y-2">
            {state.tasks.map((task) => (
              <div key={task.id} className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0"><StatusIcon status={task.status} /></span>
                <div className="flex-1">
                  <RoleBadge role={task.role} />
                  <p className={`text-sm mt-1 ${task.status === 'pending' ? 'text-white/40' : 'text-white'}`}>
                    {task.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Done — result + follow-up chat */}
      {state.status === 'done' && (
        <div>
          {state.delivery === 'email' ? (
            state.emailOk ? (
              <div className="rounded-xl bg-green-400/10 border border-green-400/20 px-4 py-4 text-center">
                <MailCheck className="mx-auto text-green-400 mb-2" size={26} />
                <p className="text-sm text-white font-medium">PDF report sent</p>
                <p className="text-xs text-white/50 mt-0.5">Delivered to {state.emailedTo}</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl bg-red-400/10 border border-red-400/20 px-4 py-3 flex gap-2.5">
                  <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={16} />
                  <div>
                    <p className="text-sm text-white">Couldn't send the email — showing it here instead:</p>
                    <p className="text-xs text-white/50 mt-0.5">{state.emailInfo}</p>
                  </div>
                </div>
                {state.summary && <ResultBox summary={state.summary} />}
              </div>
            )
          ) : (
            state.summary && <ResultBox summary={state.summary} />
          )}

          {/* Follow-up input — keep the conversation going */}
          <div className="mt-3 flex gap-2">
            <input
              value={followup}
              onChange={(e) => setFollowup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && followup.trim()) { sendFollowup(followup.trim()); setFollowup('') }
              }}
              placeholder="Ask a follow-up…"
              className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors"
            />
            <button
              onClick={() => { if (followup.trim()) { sendFollowup(followup.trim()); setFollowup('') } }}
              disabled={!followup.trim()}
              className="btn-gold flex items-center justify-center w-10 h-10 rounded-full transition-colors disabled:opacity-30"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {state.status === 'error' && (
        <div className="space-y-3">
          <p className="text-sm text-red-400">{state.error}</p>
          <button
            onClick={reset}
            className="w-full text-sm text-white/50 hover:text-white border border-white/10 py-2 rounded-full transition-colors"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Cancel while thinking */}
      {isBusy && state.status === 'thinking' && (
        <button onClick={cancel} className="mt-3 text-xs text-white/40 hover:text-white/70 transition-colors">
          Cancel
        </button>
      )}
    </div>
  )
}
