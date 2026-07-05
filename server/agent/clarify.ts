import { chatWithFallback, FAST_CHAIN } from './llm.js'

const CLARIFY_PROMPT = `You decide whether a user's goal for an autonomous AI agent is clear enough to execute well.

If the goal is already specific and actionable, respond exactly:
{"clear": true, "questions": []}

If it is vague or missing details that would materially change the result, ask 1-3 SHORT clarifying questions:
{"clear": false, "questions": ["...", "..."]}

Only ask about things that genuinely matter (scope, audience, format, time frame, specifics).
Do NOT ask more than 3 questions. Respond ONLY with JSON, no markdown, no explanation.`

// Returns up to 3 clarifying questions, or [] if the goal is clear enough.
// Never throws — on any failure we proceed without clarification.
export async function getClarifyingQuestions(goal: string): Promise<string[]> {
  try {
    const { completion } = await chatWithFallback({
      messages: [
        { role: 'system', content: CLARIFY_PROMPT },
        { role: 'user', content: `Goal: ${goal}` },
      ],
      temperature: 0.2,
      max_tokens: 300,
    }, undefined, FAST_CHAIN)

    const text = completion.choices[0]?.message?.content?.trim() ?? ''
    const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(clean) as { clear?: boolean; questions?: unknown }

    if (parsed?.clear === true) return []
    if (!Array.isArray(parsed?.questions)) return []
    return parsed.questions
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .map((q) => q.trim())
      .slice(0, 3)
  } catch {
    return []
  }
}
