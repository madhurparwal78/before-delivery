import { useId, useState, type FormEvent } from 'react'
import type { UserJson } from '../../shared/domain.ts'
import { api, ApiFailure, fieldErrors } from '../api.ts'
import { useNavigation } from '../router.tsx'
import { useSession } from '../session.tsx'
import { FieldError, FormErrors } from '../ui/FormErrors.tsx'

interface SignInFormProps {
  heading: string
  onSignedIn?: (user: UserJson) => void
}

const MAIL_DOWN = "We couldn't send a code because mail is down. Try again in a minute."

/** Email and display name, then the emailed code: the one way in. */
export function SignInForm({ heading, onSignedIn }: SignInFormProps) {
  const { setUser } = useSession()
  const base = useId()
  const ids = { email: `${base}-email`, displayName: `${base}-name`, code: `${base}-code` }
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [pending, setPending] = useState<'code' | 'session' | null>(null)
  const [requestErrors, setRequestErrors] = useState<Record<string, string>>({})
  const [codeErrors, setCodeErrors] = useState<Record<string, string>>({})
  const [mailDown, setMailDown] = useState(false)

  const sendCode = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setPending('code')
    setStatus('Sending code...')
    setRequestErrors({})
    setCodeErrors({})
    setMailDown(false)
    try {
      await api('POST', '/api/auth/code', { email, displayName })
      setSentTo(email)
      setStatus(`We sent a code to ${email}.`)
    } catch (error) {
      setStatus('')
      if (error instanceof ApiFailure && error.body.error === 'mail_unavailable') setMailDown(true)
      else setRequestErrors(fieldErrors(error))
    } finally {
      setPending(null)
    }
  }

  const signIn = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setPending('session')
    setStatus('Signing in...')
    setCodeErrors({})
    try {
      const answer = await api<{ user: UserJson }>('POST', '/api/auth/session', { email: sentTo, code })
      setUser(answer.user)
      onSignedIn?.(answer.user)
    } catch (error) {
      setStatus(`We sent a code to ${sentTo}.`)
      setCodeErrors(fieldErrors(error))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="signin-card">
      <h1>{heading}</h1>
      <p className="hint">We email you a six-digit code. No password needed.</p>
      <div role="status" aria-label="Sign-in status" className="signin-status">
        {status}
      </div>
      {mailDown && (
        <div role="alert" className="notice signin-alert">
          {MAIL_DOWN}
        </div>
      )}
      <form onSubmit={sendCode} noValidate>
        <FormErrors errors={requestErrors} ids={{ email: ids.email, displayName: ids.displayName }} />
        <div className="field">
          <label htmlFor={ids.email}>Email</label>
          <input
            id={ids.email}
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            aria-invalid={requestErrors.email ? true : undefined}
            aria-describedby={requestErrors.email ? `${ids.email}-error` : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
          <FieldError id={`${ids.email}-error`} message={requestErrors.email} />
        </div>
        <div className="field">
          <label htmlFor={ids.displayName}>Display name</label>
          <input
            id={ids.displayName}
            className="input"
            type="text"
            autoComplete="name"
            value={displayName}
            aria-invalid={requestErrors.displayName ? true : undefined}
            aria-describedby={requestErrors.displayName ? `${ids.displayName}-error` : `${ids.displayName}-hint`}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <p id={`${ids.displayName}-hint`} className="field-hint">
            Needed only for a new email address.
          </p>
          <FieldError id={`${ids.displayName}-error`} message={requestErrors.displayName} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending !== null}>
          {pending === 'code' ? 'Sending code...' : 'Send code'}
        </button>
      </form>
      {sentTo !== null && (
        <form onSubmit={signIn} noValidate className="code-form">
          <FormErrors errors={codeErrors} ids={{ code: ids.code }} />
          <div className="field">
            <label htmlFor={ids.code}>Sign-in code</label>
            <input
              id={ids.code}
              className="input code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              aria-invalid={codeErrors.code ? true : undefined}
              aria-describedby={codeErrors.code ? `${ids.code}-error` : undefined}
              onChange={(event) => setCode(event.target.value)}
            />
            <FieldError id={`${ids.code}-error`} message={codeErrors.code} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={pending !== null}>
            {pending === 'session' ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      )}
    </div>
  )
}

function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get('next')
  return next !== null && /^\/(?![/\\])/.test(next) ? next : '/projects'
}

export function SignIn() {
  const { navigate } = useNavigation()
  return (
    <div className="signin-wrap">
      <SignInForm heading="Sign in" onSignedIn={() => navigate(nextPath())} />
    </div>
  )
}
