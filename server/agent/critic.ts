import { chatWithFallback, FAST_CHAIN } from './llm.js'

const CRITIC_PROMPT = `You are the CRITIC, the reviewer in a multi-agent AI team. Judge the team's final answer
against the user's goal: is it complete, accurate, on-topic, and free of placeholders or vague filler?

Be strict but fair. Respond ONLY with JSON, no markdown:
{"ok": true}                                         // if the answer is good enough
{"ok": false, "feedback": "what to fix in 1-2 sentences"}   // if it needs one revision`

export interface Review {
  ok: boolean
  feedback: string
}

// Review the final answer. Never throws and never blocks — on any failure it
// approves (ok: true), so the critic can only improve, never break, a run.
export async function reviewResult(goal: string, summary: string): Promise<Review> {
  try {
    const { completion } = await chatWithFallback({
      messages: [
        { role: 'system', content: CRITIC_PROMPT },
        { role: 'user', content: `User goal: ${goal}\n\nThe team's answer:\n${summary.slice(0, 1600)}` },
      ],
      temperature: 0.2,
      max_tokens: 250,
    }, undefined, FAST_CHAIN)

    const text = completion.choices[0]?.message?.content?.trim() ?? ''
    const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(clean) as { ok?: boolean; feedback?: string }

    return {
      ok: parsed?.ok !== false,
      feedback: typeof parsed?.feedback === 'string' ? parsed.feedback : '',
    }
  } catch {
    return { ok: true, feedback: '' }
  }
}
