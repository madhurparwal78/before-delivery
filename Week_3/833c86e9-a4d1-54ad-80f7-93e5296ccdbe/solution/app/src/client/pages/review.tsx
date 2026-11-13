import { useCallback, useEffect, useState, type FormEvent } from 'react'
import '../styles/account.css'
import { ApiFailure, get, post } from '../api'
import { PageTitle } from '../components/page-title'
import { announce, useLive } from '../live'
import { useApp } from '../state'
import { Button, Spinbutton } from '../ui'
import { NotFound } from '../app'

const ASPECTS = ['cleanliness', 'comfort', 'location', 'staff', 'value'] as const
const REFUSALS: Record<string, string> = { too_early: 'review.early', window_closed: 'review.closed', already_reviewed: 'review.used' }

type Status = { kind: 'open'; property: string } | { kind: 'refused'; key: string } | { kind: 'missing' }

/** The review page: the form while the review window runs, otherwise the server's refusal sentence; re-read on every clock event. */
export function ReviewPage({ params }: { params: string[] }) {
  const app = useApp()
  const token = params[0]
  const [status, setStatus] = useState<Status | null>(null)
  const [scores, setScores] = useState<Record<string, number>>(Object.fromEntries(ASPECTS.map((aspect) => [aspect, 8])))
  const [comment, setComment] = useState('')
  const [messages, setMessages] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      const open = await get<{ property: string }>(`/api/reviews/${token}`)
      setStatus({ kind: 'open', property: open.property })
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error
      const key = REFUSALS[String(error.body.error)]
      setStatus(error.status === 404 || !key ? { kind: 'missing' } : { kind: 'refused', key })
    }
  }, [token])

  useEffect(() => void load(), [load])
  useLive('clock', () => void load())

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setMessages({})
    try {
      await post(`/api/reviews/${token}`, { ...scores, comment })
      announce('toast', app.t('toast.review_sent'))
      await load()
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error
      if (error.status === 422) setMessages(Object.fromEntries(ASPECTS.filter((aspect) => error.body.fields?.[aspect]).map((aspect) => [aspect, app.t('review.score_range')])))
      else await load()
    } finally {
      setBusy(false)
    }
  }

  if (!status) return null
  if (status.kind === 'missing') return <NotFound />
  if (status.kind === 'refused') return <div className="plain-page"><PageTitle className="sentence">{app.t(status.key)}</PageTitle></div>

  return (
    <div className="plain-page">
      <PageTitle>{app.t('ui.reviewYourStay', { 'property name': status.property })}</PageTitle>
      <form className="review-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="scores">
          {ASPECTS.map((aspect) => (
            <div key={aspect} className="score">
              <span>{app.t(`ui.${aspect}`)}</span>
              <Spinbutton label={app.t(`ui.${aspect}`)} value={scores[aspect]} min={1} max={10} onChange={(value) => setScores({ ...scores, [aspect]: value })} />
              <span className="field-message">{messages[aspect]}</span>
            </div>
          ))}
        </div>
        <label className="stack">
          <span>{app.t('ui.comment')}</span>
          <textarea className="field comment" rows={5} maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} />
        </label>
        <div className="btn-row">
          <Button type="submit" busy={busy}>{app.t('ui.sendReview')}</Button>
        </div>
      </form>
    </div>
  )
}
