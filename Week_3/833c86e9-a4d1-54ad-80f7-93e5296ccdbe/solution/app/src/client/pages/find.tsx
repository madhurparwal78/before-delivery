import { useState, type FormEvent } from 'react'
import '../styles/account.css'
import { ApiFailure, post } from '../api'
import { PageTitle } from '../components/page-title'
import { navigate } from '../router'
import { useApp } from '../state'
import { Button } from '../ui'

/** Find a booking by its code and surname. */
export function FindPage() {
  const app = useApp()
  const [code, setCode] = useState('')
  const [surname, setSurname] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const found = await post<{ code: string }>('/api/bookings/find', { code: code.trim(), surname })
      navigate(`/bookings/${found.code}`)
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error
      setMessage(app.t(error.status === 429 ? 'rate.limited' : 'find.none'))
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <PageTitle>{app.t('ui.findBooking')}</PageTitle>
      <form aria-label={app.t('ui.findBooking')} className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
        <label className="stack">
          <span>{app.t('ui.bookingCode')}</span>
          <input className="field" type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={code} onChange={(event) => setCode(event.target.value)} />
        </label>
        <label className="stack">
          <span>{app.t('ui.surname')}</span>
          <input className="field" type="text" autoComplete="family-name" value={surname} onChange={(event) => setSurname(event.target.value)} />
        </label>
        <p className="field-message form-message" aria-live="polite">{message}</p>
        <div className="btn-row">
          <Button type="submit" busy={busy}>{app.t('ui.findButton')}</Button>
        </div>
      </form>
    </div>
  )
}
