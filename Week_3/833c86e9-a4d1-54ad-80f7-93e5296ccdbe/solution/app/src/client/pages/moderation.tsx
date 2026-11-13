import { useEffect, useState } from 'react'
import { extendMessages } from '../../shared/i18n'
import '../styles/account.css'
import { ApiFailure, get, post } from '../api'
import { useSignedIn } from '../components/guard'
import { PageTitle } from '../components/page-title'
import { announce } from '../live'
import { useApp } from '../state'
import { BigWord, Button } from '../ui'
import { NotFound } from '../app'

extendMessages({ 'x.moderation': ['Moderation', 'Moderation', 'الإشراف'] })

const ASPECTS = ['cleanliness', 'comfort', 'location', 'staff', 'value'] as const

interface Pending { id: string; property: { code: string; name: string }; comment: string; created_at: string; scores: Record<string, number> }

/** Moderation (operator only): one article per pending review, oldest first. */
export function ModerationPage() {
  const app = useApp()
  const signedIn = useSignedIn()
  const [reviews, setReviews] = useState<Pending[] | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!signedIn) return
    get<Pending[]>('/api/moderation/reviews').then(setReviews, (error) => {
      if (error instanceof ApiFailure && error.status === 403) setForbidden(true)
      else throw error
    })
  }, [signedIn])

  if (!signedIn) return null
  if (forbidden) return <NotFound forbidden />

  const decide = async (review: Pending, action: 'publish' | 'reject'): Promise<void> => {
    setBusy(`${review.id}:${action}`)
    try {
      await post(`/api/moderation/reviews/${review.id}/${action}`)
      announce('toast', app.t(action === 'publish' ? 'toast.published' : 'toast.rejected'))
    } catch (error) {
      if (!(error instanceof ApiFailure) || error.status !== 409) throw error
    }
    setReviews((list) => list?.filter((item) => item.id !== review.id) ?? null)
    setBusy(null)
  }

  return (
    <div className="plain-page moderation">
      <PageTitle>{app.t('x.moderation')}</PageTitle>
      {reviews && !reviews.length && <BigWord word={app.t('empty.results.word')} sentence={app.t('moderation.empty')} />}
      {reviews?.map((review) => (
        <article key={review.id} className="pending" aria-labelledby={`review-${review.id}`}>
          <h2 id={`review-${review.id}`}>{review.property.name}</h2>
          <dl className="aspects">
            {ASPECTS.map((aspect) => <div key={aspect}><dt>{app.t(`ui.${aspect}`)}</dt><dd className="num">{review.scores[aspect]}</dd></div>)}
          </dl>
          <p className="comment-text">{review.comment}</p>
          <div className="btn-row">
            <Button busy={busy === `${review.id}:publish`} disabled={busy !== null} onClick={() => void decide(review, 'publish')}>{app.t('ui.publishReview', { id: review.id })}</Button>
            <Button className="quiet" busy={busy === `${review.id}:reject`} disabled={busy !== null} onClick={() => void decide(review, 'reject')}>{app.t('ui.rejectReview', { id: review.id })}</Button>
          </div>
        </article>
      ))}
    </div>
  )
}
