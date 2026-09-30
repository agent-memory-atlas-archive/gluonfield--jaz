import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, ChevronRight, LoaderCircle } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { answerSessionInteractiveResponse } from '@/lib/api/sessions'
import type { ACPPermission, ACPQuestion, SessionEvent } from '@/lib/api/types'
import { keys } from '@/lib/query/keys'
import { normalized } from '@/components/session/TranscriptUtils'

type QuestionAnswer = {
  choices: string[]
  other: string
}

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
  const [answers, setAnswers] = useState<Record<string, QuestionAnswer>>({})
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
    const answer = answers[question.id]
    const other = answer?.other.trim()
    return [...(answer?.choices ?? []), ...(other ? [other] : [])]
  }
  const complete = questions.every((question) => valuesFor(question).length > 0)

  // Settled questions collapse to a single line, codex-style.
  const summary = settled ? (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
      className="inline-flex min-h-7 items-center gap-1.5 self-start rounded-full px-1 text-left font-mono text-[12px] text-ink-3 transition-colors hover:text-ink"
    >
      <ChevronRight size={12} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
      Asked {questions.length} question{questions.length === 1 ? '' : 's'}
      {cancelled ? ' · cancelled' : ''}
    </button>
  ) : null
  if (settled && !open) return summary

  const total = questions.length
  const safeIndex = Math.min(index, total - 1)
  const current = questions[safeIndex]
  const isFirst = safeIndex === 0
  const isLast = safeIndex === total - 1
  const options = current.options ?? []
  const selected = answers[current.id]?.choices ?? []
  const showOther = current.is_other || !options.length
  const otherValue = answers[current.id]?.other ?? ''

  const goTo = (next: number) => {
    if (next < 0 || next >= total || next === safeIndex) return
    setDirection(next > safeIndex ? 1 : -1)
    setIndex(next)
  }

  const pickOption = (label: string) => {
    setAnswers((prev) => {
      const answer = prev[current.id]
      const choices = answer?.choices ?? []
      return {
        ...prev,
        [current.id]: {
          choices: current.multi_select
            ? choices.includes(label)
              ? choices.filter((value) => value !== label)
              : [...choices, label]
            : [label],
          other: current.multi_select ? answer?.other ?? '' : '',
        },
      }
    })
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
    <>
      {summary}
      <div className="rounded-card border border-border bg-surface px-3 pt-3 pb-2">
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
            <p className="text-sm font-medium leading-snug text-ink text-pretty">{current.question}</p>

            <fieldset disabled={locked} className="-mx-2 mt-2 flex flex-col">
              <legend className="sr-only">{current.question}</legend>
              {options.map((option) => (
                <label
                  key={option.label}
                  className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-[13px] leading-5 text-ink transition-colors has-focus-visible:bg-list-hover ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-list-hover'}`}
                >
                  <input
                    type={current.multi_select ? 'checkbox' : 'radio'}
                    name={`${permission.id}:${current.id}`}
                    checked={selected.includes(option.label)}
                    onChange={() => pickOption(option.label)}
                    className="mt-0.75 size-3.5 shrink-0 accent-ink"
                  />
                  <span className="min-w-0 text-pretty">
                    {option.label}
                    {option.description ? <span className="ml-1 text-ink-3"> {option.description}</span> : null}
                  </span>
                </label>
              ))}

              {showOther ? (
                <input
                  type={current.is_secret ? 'password' : 'text'}
                  value={otherValue}
                  aria-label={options.length ? 'Other answer' : current.question}
                  placeholder={options.length ? 'Other answer…' : 'Type your answer…'}
                  className="mt-1 h-9 w-full rounded-lg bg-bg px-2 text-[13px] text-ink placeholder:text-ink-3 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  onChange={(e) => {
                    const value = e.target.value
                    setAnswers((prev) => ({
                      ...prev,
                      [current.id]: {
                        choices: current.multi_select ? prev[current.id]?.choices ?? [] : [],
                        other: value,
                      },
                    }))
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    if (isLast) void submit()
                    else goTo(safeIndex + 1)
                  }}
                />
              ) : null}
            </fieldset>
          </motion.div>
        </AnimatePresence>

        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <button
            type="button"
            onClick={() => goTo(safeIndex - 1)}
            disabled={isFirst}
            className="-ml-1 inline-flex h-8 items-center gap-1 justify-self-start rounded-full px-2 text-[13px] text-ink-2 transition duration-150 hover:text-ink active:scale-[0.96] disabled:pointer-events-none disabled:opacity-0"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Back
          </button>

          {total > 1 ? (
            <div className="flex items-center">
              {questions.map((question, dotIndex) => {
                const dotCurrent = dotIndex === safeIndex
                return (
                  <button
                    key={question.id}
                    type="button"
                    aria-label={`Go to question ${dotIndex + 1}`}
                    aria-current={dotCurrent ? 'step' : undefined}
                    onClick={() => goTo(dotIndex)}
                    className="group grid h-6 place-items-center px-0.75"
                  >
                    <span
                      className={`h-1.5 rounded-full transition-[width,background-color] duration-200 ${
                        dotCurrent
                          ? 'w-3 bg-ink-2'
                          : valuesFor(question).length
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

          {!isLast ? (
            <button
              type="button"
              onClick={() => goTo(safeIndex + 1)}
              className="inline-flex h-8 items-center gap-1 justify-self-end rounded-full bg-surface-2 pr-2.5 pl-3 text-[13px] font-medium text-ink transition duration-150 hover:bg-list-active active:scale-[0.96]"
            >
              Next
              <ArrowRight className="size-3.5" aria-hidden />
            </button>
          ) : settled ? null : (
            <button
              type="button"
              disabled={!complete || submitting}
              onClick={() => void submit()}
              className="inline-flex h-8 items-center gap-1.5 justify-self-end rounded-full bg-primary px-3.5 text-[13px] font-medium text-on-primary transition duration-150 hover:bg-primary-strong active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-3"
            >
              {submitting ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}
              Submit
            </button>
          )}
        </div>

        {error ? <p className="mt-2 text-[12px] text-danger">{error}</p> : null}
      </div>
    </>
  )
}
