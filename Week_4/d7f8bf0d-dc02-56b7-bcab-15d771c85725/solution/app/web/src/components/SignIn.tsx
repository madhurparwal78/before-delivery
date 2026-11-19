import { useRef, useState, type FormEvent } from 'react'
import { signIn, signInAgain } from '../actions'
import { useAppState } from '../state'
import { trapFocus } from '../ui/overlay'
import { Button, TextField } from '../ui/primitives'

export function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLFormElement>(null)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    await signIn(email, password)
    setBusy(false)
  }

  return (
    <div className="modal-layer sign-in-layer">
      <form ref={box} role="dialog" aria-modal="true" aria-label="Sign in" data-testid="sign-in-form" className="modal sign-in" onSubmit={event => void submit(event)} onKeyDown={event => trapFocus(event, box.current)}>
        <h1 className="sheet-title">Gandyboard</h1>
        <TextField label="Email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required />
        <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
        <div className="modal-actions">
          <Button type="submit" busy={busy}>Sign in</Button>
        </div>
      </form>
    </div>
  )
}

// Sign-in expired mid-task: sign back in on the same screen and the held commands go out once more.
export function SignInAgain() {
  const { reauth } = useAppState()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLFormElement>(null)
  if (reauth === null) return null

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    const done = await signInAgain(password)
    setBusy(false)
    if (done) setPassword('')
  }

  return (
    <div className="modal-layer sign-in-layer again-layer">
      <form ref={box} role="dialog" aria-modal="true" aria-label="Sign in again" data-testid="sign-in-again" className="modal sign-in" onSubmit={event => void submit(event)} onKeyDown={event => trapFocus(event, box.current)}>
        <h2 className="sheet-title">Sign in again</h2>
        <TextField label="Email" type="email" value={reauth.email} readOnly />
        <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} autoFocus required />
        <div className="modal-actions">
          <Button type="submit" busy={busy}>Sign in</Button>
        </div>
      </form>
    </div>
  )
}
