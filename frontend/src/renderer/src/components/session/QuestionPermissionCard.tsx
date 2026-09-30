import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, ChevronRight, LoaderCircle, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { answerSessionInteractiveResponse } from '@/lib/api/sessions'
import type { ACPPermission, ACPQuestion, SessionEvent } from '@/lib/api/types'
import { keys } from '@/lib/query/keys'
import { normalized } from '@/components/session/TranscriptUtils'

export function QuestionPermissionCard({
  event,
  resolution,
}: {
  event: SessionEvent
  resolution?: ACPPermission
}) {
  const permission = event.permission
  const queryClient = useQueryClient()
  const reduce = useReducedMotion()
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [otherAnswers, setOtherAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [localAnswered, setLocalAnswered] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  // Which question is on screen, and the direction we last moved (for the slide).
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState(1)

  if (!permission?.questions?.length) return null
  const questions = permission.questions

  const status = normalized(resolution?.status || permission.status)
  const answered = localAnswered || status === 'selected' || Boolean(resolution?.selected_option_id)
  const cancelled = status === 'cancelled'
  const settled = answered || cancelled
  const locked = settled || submitting
  const valuesFor = (question: ACPQuestion) => {
    const other = otherAnswers[question.id]?.trim()
    return [...(answers[question.id] ?? []), ...(other ? [other] : [])]
  }
  const complete = questions.every((question) => valuesFor(question).length > 0)

  // Settled questions collapse to a single line, codex-style.
  if (settled && !open) {
    return (
      <button
        type="button"
        aria-expanded={false}
        onClick={() => setOpen(true)}
        className="inline-flex min-h-7 items-center gap-1.5 self-start rounded-full px-1 text-left font-mono text-[12px] text-ink-3 transition-colors hover:text-ink"
      >
        <ChevronRight size={12} className="shrink-0" aria-hidden />
        Asked {questions.length} question{questions.length === 1 ? '' : 's'}
        {cancelled ? ' · cancelled' : ''}
      </button>
    )
  }

  const total = questions.length
  const safeIndex = Math.min(index, total - 1)
  const current = questions[safeIndex]
  const isFirst = safeIndex === 0
  const isLast = safeIndex === total - 1
  const options = current.options ?? []
  const selected = answers[current.id] ?? []
  const showOther = current.is_other || !options.length
  const otherValue = otherAnswers[current.id] ?? ''

  const goTo = (next: number) => {
    if (next < 0 || next >= total || next === safeIndex) return
    setDirection(next > safeIndex ? 1 : -1)
    setIndex(next)
  }

  const pickOption = (label: string) => {
    if (locked) return
    setAnswers((prev) => ({
      ...prev,
      [current.id]: current.multi_select
        ? selected.includes(label)
          ? selected.filter((value) => value !== label)
          : [...selected, label]
        : [label],
    }))
    if (!current.multi_select) setOtherAnswers((prev) => ({ ...prev, [current.id]: '' }))
  }

  const submit = async () => {
    if (!complete || locked) return
    setSubmitting(true)
    setError('')
    try {
      await answerSessionInteractiveResponse(event.session_id, {
        request_id: permission.id,
        answers: Object.fromEntries(
          questions.map((question) => [
            question.id,
            { answers: valuesFor(question) },
          ]),
        ),
      })
      setLocalAnswered(true)
      await queryClient.invalidateQueries({ queryKey: keys.sessionMessages(event.session_id) })
      queryClient.invalidateQueries({ queryKey: keys.sidebarSessions })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Question response failed.')
    } finally {
      setSubmitting(false)
    }
  }

  const slide = {
    enter: (dir: number) => ({ opacity: 0, x: reduce ? 0 : dir >= 0 ? 24 : -24, filter: 'blur(4px)' }),
    center: { opacity: 1, x: 0, filter: 'blur(0px)' },
    exit: (dir: number) => ({ opacity: 0, x: reduce ? 0 : dir >= 0 ? -16 : 16, filter: 'blur(4px)' }),
  }

  return (
    <div className="rounded-card border border-border bg-surface px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-ink">{permission.title || 'Clarifying questions'}</p>
        {answered ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-ok">
            <Check className="size-3.5" aria-hidden />
            Answered
          </span>
        ) : cancelled ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-danger">
            <X className="size-3.5" aria-hidden />
            Cancelled
          </span>
        ) : (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-3">
            {safeIndex + 1} / {total}
          </span>
        )}
      </div>

      <div className="relative mt-3 min-h-[124px]">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={current.id}
            custom={direction}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring', duration: 0.18, bounce: 0 }}
          >
            {current.header ? (
              <p className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">
                {current.header}
              </p>
            ) : null}
            <p className="mt-0.5 text-[15px] leading-snug text-ink text-pretty">{current.question}</p>

            {options.length ? (
              <fieldset className="mt-3 flex flex-col gap-1.5">
                <legend className="sr-only">{current.question}</legend>
                {options.map((option) => {
                  const active = selected.includes(option.label)
                  return (
                    <label
                      key={option.label}
                      className={`flex min-h-10 w-full items-start gap-2.5 rounded-control border px-3 py-2 text-left text-[12px] transition-colors ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${
                        active
                          ? 'border-primary bg-primary-soft text-primary-strong'
                          : 'border-border bg-bg text-ink hover:border-primary hover:text-primary'
                      }`}
                    >
                      <input
                        type={current.multi_select ? 'checkbox' : 'radio'}
                        name={`${permission.id}:${current.id}`}
                        checked={active}
                        disabled={locked}
                        onChange={() => pickOption(option.label)}
                        className="mt-0.5 size-4 shrink-0 accent-primary"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">{option.label}</span>
                        {option.description ? (
                          <span className="mt-0.5 block leading-snug text-ink-2">{option.description}</span>
                        ) : null}
                      </span>
                    </label>
                  )
                })}
              </fieldset>
            ) : null}

            {showOther ? (
              <input
                type={current.is_secret ? 'password' : 'text'}
                value={otherValue}
                aria-label={options.length ? 'Other answer' : current.question}
                disabled={locked}
                placeholder={options.length ? 'Other answer…' : 'Type your answer…'}
                className={`${options.length ? 'mt-1.5' : 'mt-3'} h-9 w-full rounded-control border border-border bg-bg px-3 text-[12px] text-ink transition-colors placeholder:text-ink-3 focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60`}
                onChange={(e) => {
                  const value = e.target.value
                  setOtherAnswers((prev) => ({ ...prev, [current.id]: value }))
                  if (!current.multi_select) setAnswers((prev) => ({ ...prev, [current.id]: [] }))
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  if (isLast) void submit()
                  else goTo(safeIndex + 1)
                }}
              />
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => goTo(safeIndex - 1)}
          disabled={isFirst}
          className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-ink-2 transition duration-150 hover:text-ink active:scale-[0.96] disabled:pointer-events-none disabled:opacity-0"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Back
        </button>

        {total > 1 ? (
          <div className="flex items-center gap-1.5">
            {questions.map((question, dotIndex) => {
              const dotAnswered = valuesFor(question).length > 0
              const dotCurrent = dotIndex === safeIndex
              return (
                <button
                  key={question.id}
                  type="button"
                  aria-label={`Go to question ${dotIndex + 1}`}
                  aria-current={dotCurrent}
                  onClick={() => goTo(dotIndex)}
                  className="group grid place-items-center py-1.5"
                >
                  <motion.span
                    layout
                    transition={{ type: 'spring', duration: 0.2, bounce: 0 }}
                    className={`h-1.5 rounded-full transition-colors ${
                      dotCurrent
                        ? 'w-5 bg-primary'
                        : dotAnswered
                          ? 'w-1.5 bg-ink-3 group-hover:bg-ink-2'
                          : 'w-1.5 bg-border group-hover:bg-ink-3'
                    }`}
                  />
                </button>
              )
            })}
          </div>
        ) : (
          <span />
        )}

        {!settled && isLast ? (
          <button
            type="button"
            disabled={!complete || submitting}
            onClick={() => void submit()}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12px] font-medium text-on-primary transition duration-150 hover:bg-primary-strong active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-bg disabled:text-ink-3"
          >
            {submitting ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Check className="size-3.5" aria-hidden />
            )}
            Submit
          </button>
        ) : !isLast ? (
          <button
            type="button"
            onClick={() => goTo(safeIndex + 1)}
            className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-bg px-3 text-[12px] font-medium text-ink transition duration-150 hover:border-primary hover:text-primary active:scale-[0.96]"
          >
            Next
            <ArrowRight className="size-3.5" aria-hidden />
          </button>
        ) : (
          <span />
        )}
      </div>

      {error ? <p className="mt-2 text-[12px] text-danger">{error}</p> : null}
    </div>
  )
}
