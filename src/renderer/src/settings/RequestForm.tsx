import { useCallback, useState } from 'react'

// "Your email + a message, opened in your mail app" — the shape three places
// in Settings now need: Report a bug, Request a feature, and Explore's
// "ask us for a page look". They were the same 60 lines twice before the third
// one existed; the third is what made keeping them separate indefensible.
//
// Sends via the OS default mail app (mailto:) opened by main — no account or
// API key needed here. The fixed destinations live in src/main/support.ts, and
// WHICH one is the `send` prop: this component knows nothing about inboxes.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Props {
  /** distinguishes the label/input ids when two forms are on one page */
  idPrefix: string
  /** drawn as the section heading. Omit where the caller already has one. */
  title?: string
  hint: string
  placeholder: string
  /** what to say above the message box; "Message" unless the ask is narrower */
  messageLabel?: string
  send: (fromEmail: string, message: string) => Promise<boolean>
}

export function RequestForm({
  idPrefix,
  title,
  hint,
  placeholder,
  messageLabel = 'Message',
  send
}: Props): React.JSX.Element {
  const [fromEmail, setFromEmail] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const canSend = EMAIL_RE.test(fromEmail.trim()) && message.trim().length > 0

  const submit = useCallback(async () => {
    setStatus('sending')
    const ok = await send(fromEmail.trim(), message.trim())
    if (ok) {
      setMessage('')
      setStatus('sent')
    } else {
      setStatus('error')
    }
  }, [fromEmail, message, send])

  return (
    <>
      {title && <h3 className="font-display text-[15px] font-semibold text-ink-900">{title}</h3>}
      <p className={(title ? 'mt-0.5 ' : '') + 'text-[12px] text-ink-500'}>{hint}</p>

      <div className="mt-4 flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-email`} className="text-[12.5px] font-medium text-ink-700">
          Your email
        </label>
        <input
          id={`${idPrefix}-email`}
          type="email"
          value={fromEmail}
          onChange={(e) => setFromEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-lg bg-brand-500/8 px-2.5 py-1.5 text-[12px] text-ink-900 outline-none placeholder:text-ink-400"
        />
      </div>

      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-message`} className="text-[12.5px] font-medium text-ink-700">
          {messageLabel}
        </label>
        <textarea
          id={`${idPrefix}-message`}
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={placeholder}
          className="w-full resize-y rounded-lg bg-brand-500/8 px-2.5 py-2 text-[12.5px] text-ink-900 outline-none placeholder:text-ink-400"
        />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button className="mini" disabled={!canSend || status === 'sending'} onClick={() => void submit()}>
          {status === 'sending' ? 'Opening…' : 'Send'}
        </button>
        {status === 'sent' && (
          <span className="text-[11.5px] text-ink-400">
            Your default mail app should now have this ready to send.
          </span>
        )}
        {status === 'error' && (
          <span className="text-[11.5px] text-ink-400">
            Couldn&apos;t open a mail app automatically — email us directly instead.
          </span>
        )}
      </div>
    </>
  )
}
