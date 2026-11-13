import { useState, type FormEvent } from 'react'
import { ApiFailure, post } from '../api'
import { navigate, useLocation } from '../router'
import { useApp } from '../state'
import { Button } from '../ui'
import { PageTitle } from './page-title'

type Mode = 'signin' | 'signup'

/** The sign-in and create-account forms: field messages under the fields, `rate.limited` on 429, a redirect after success. */
export function AuthForm({ mode }: { mode: Mode }) {
  const app = useApp()
  const loc = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [messages, setMessages] = useState<{ form?: string; username?: string; password?: string }>({})
  const [busy, setBusy] = useState(false)
  const title = app.t(mode === 'signin' ? 'ui.signIn' : 'ui.createAccount')

  const fail = (error: ApiFailure): void => {
    const { status, body } = error
    if (status === 429) setMessages({ form: app.t('rate.limited') })
    else if (status === 401) setMessages({ form: app.t('signin.failed') })
    else if (status === 409) setMessages({ username: app.t('signup.taken') })
    else if (status === 422) setMessages({ username: body.fields?.username ? app.t('signup.username') : undefined, password: body.fields?.password ? app.t('signup.password') : undefined })
    else throw error
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setMessages({})
    try {
      await post(mode === 'signin' ? '/api/signin' : '/api/signup', { username, password })
      await app.refreshMe()
      const next = new URLSearchParams(loc.search).get('next')
      navigate(next && /^\/(?!\/)/.test(next) ? next : '/account')
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error
      fail(error)
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <PageTitle>{title}</PageTitle>
      <form aria-label={title} className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
        <label className="stack">
          <span>{app.t('ui.username')}</span>
          <input className="field" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} aria-invalid={messages.username ? 'true' : undefined} />
          <span className="field-message">{messages.username}</span>
        </label>
        <label className="stack">
          <span>{app.t('ui.password')}</span>
          <input className="field" type="password" role="textbox" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={messages.password ? 'true' : undefined} />
          <span className="field-message">{messages.password}</span>
        </label>
        <p className="field-message form-message" aria-live="polite">{messages.form}</p>
        <div className="btn-row">
          <Button type="submit" className="auth-submit" busy={busy}>{title}</Button>
        </div>
      </form>
    </div>
  )
}
