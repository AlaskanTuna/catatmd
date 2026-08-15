import type { CopilotProposal, CopilotTurn } from '@shared/types'
import { useCallback, useRef, useState } from 'react'

/**
 * The CatatAI conversation, held in memory for the life of the panel
 * (GitHub issue #169).
 *
 * **Nothing here is persisted, and that is a decision rather than a shortcut.**
 * Storing the conversation would create a fourth PHI-bearing column, which
 * `.claude/rules/security.md` obliges to name the erasure target it joins and
 * to update `eraseConsultation`, today nulling exactly three. A chat log is
 * also the least valuable clinical artefact on the screen: the note is the
 * record, and the conversation is scaffolding the doctor used to get there.
 * Reloading the page clears it, which is the honest behaviour for something
 * that was never saved, and the panel says so on first open.
 */

const BASE = import.meta.env.VITE_API_URL ?? ''

export type CopilotToolRun = { name: string; label: string }

/**
 * A proposal carries its own id rather than being addressed by array index.
 *
 * Cards are removed as the doctor approves or discards them, so an index key
 * would let React reuse a card component for a different proposal after a
 * removal shifted the array. That is not a rendering nicety: the dismissal
 * reason is component state, so the doctor's justification for one flag could
 * reappear pre-filled under another.
 */
export type CopilotProposalCard = { id: string; proposal: CopilotProposal }

export type CopilotMessage = {
  id: string
  role: 'doctor' | 'copilot'
  content: string
  /** Tool activity for this turn, rendered collapsed once the answer lands. */
  tools: CopilotToolRun[]
  proposals: CopilotProposalCard[]
  citations: string[]
  streaming?: boolean
}

/** Parses the `\n\n`-delimited `data:` frames the route writes. */
async function* frames(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      while (buffer.includes('\n\n')) {
        const split = buffer.indexOf('\n\n')
        const chunk = buffer.slice(0, split)
        buffer = buffer.slice(split + 2)
        const line = chunk.split('\n').find((entry) => entry.startsWith('data:'))
        if (!line) continue
        const payload = line.slice(5).trim()
        if (payload) yield JSON.parse(payload)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function localId(): string {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function useCopilot(consultationId: string) {
  const [messages, setMessages] = useState<CopilotMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  /** Mutates the in-flight copilot turn, which is always the last message. */
  const patchLast = useCallback((change: (message: CopilotMessage) => CopilotMessage) => {
    setMessages((current) =>
      current.map((message, index) => (index === current.length - 1 ? change(message) : message)),
    )
  }, [])

  const send = useCallback(
    async (text: string) => {
      const message = text.trim()
      if (!message || abort.current) return

      setError(null)
      const controller = new AbortController()
      abort.current = controller

      /*
       * History is read from the state we are about to extend, not from the
       * state after it. The doctor's new message travels in `message`, and
       * sending it in both places makes the model answer a question it has
       * been asked twice.
       */
      const history: CopilotTurn[] = messages.map((entry) => ({
        role: entry.role,
        content: entry.content,
      }))

      setMessages((current) => [
        ...current,
        {
          id: localId(),
          role: 'doctor',
          content: message,
          tools: [],
          proposals: [],
          citations: [],
        },
        {
          id: localId(),
          role: 'copilot',
          content: '',
          tools: [],
          proposals: [],
          citations: [],
          streaming: true,
        },
      ])
      setStreaming(true)

      try {
        const response = await fetch(`${BASE}/api/consultations/${consultationId}/copilot`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message, history }),
          signal: controller.signal,
        })

        if (!response.ok || !response.body) {
          // A non-200 here is an ordinary JSON error: ownership and validation
          // both resolve before the stream opens, by design.
          setError(
            response.status === 429
              ? 'Too many messages just now. Give it a moment.'
              : 'CatatAI could not be reached.',
          )
          setMessages((current) => current.slice(0, -1))
          return
        }

        for await (const event of frames(response.body)) {
          const frame = event as { type?: string } & Record<string, unknown>
          if (frame.type === 'token') {
            patchLast((entry) => ({ ...entry, content: entry.content + String(frame.text ?? '') }))
          } else if (frame.type === 'tool') {
            patchLast((entry) => ({
              ...entry,
              tools: [...entry.tools, { name: String(frame.name), label: String(frame.label) }],
            }))
          } else if (frame.type === 'proposal') {
            patchLast((entry) => ({
              ...entry,
              proposals: [
                ...entry.proposals,
                { id: localId(), proposal: frame.proposal as CopilotProposal },
              ],
            }))
          } else if (frame.type === 'error') {
            setError(String(frame.message ?? 'Something went wrong.'))
          }
        }
      } catch (cause) {
        // An abort is the doctor closing the panel, not a failure to report.
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError('The connection to CatatAI dropped.')
        }
      } finally {
        abort.current = null
        setStreaming(false)
        patchLast((entry) => ({ ...entry, streaming: false }))
      }
    },
    [consultationId, messages, patchLast],
  )

  const stop = useCallback(() => {
    abort.current?.abort()
    abort.current = null
  }, [])

  /** Removes a proposal card once the doctor has approved or discarded it. */
  const resolveProposal = useCallback((cardId: string) => {
    setMessages((current) =>
      current.map((entry) => ({
        ...entry,
        proposals: entry.proposals.filter((card) => card.id !== cardId),
      })),
    )
  }, [])

  return { messages, send, stop, streaming, error, resolveProposal }
}
