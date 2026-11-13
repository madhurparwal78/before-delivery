import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ApiFail, call } from '../api.ts'
import { Glyph } from '../components/Glyph.tsx'
import { Link } from '../components/Link.tsx'
import { Card, Shell, useNewPattern } from '../components/Shell.tsx'
import { useLive } from '../live.ts'
import { navigate, safeNext, useLocation } from '../router.ts'
import { type Me, useSession } from '../session.tsx'

export function NotFound() {
  return (
    <Shell lead="This page could not be opened." live={null}>
      <h1>Not found.</h1>
    </Shell>
  )
}

/** The signed-in person, or null after sending a signed-out visitor to sign in. */
export function useRequireUser(): Me | null {
  const { ready, me } = useSession()
  const { path, search } = useLocation()
  useEffect(() => {
    if (ready && !me) navigate(path === '/' ? '/signin' : `/signin?next=${encodeURIComponent(path + (search.size ? `?${search}` : ''))}`, true)
  }, [ready, me, path, search])
  return me
}

function useForm() {
  const [error, setError] = useState<{ field: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = (work: () => Promise<void>) => async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (failure) {
      if (failure instanceof ApiFail) setError({ field: failure.body.field ?? '', message: failure.body.message ?? 'That change was not saved. Try again.' })
      else throw failure
    } finally {
      setBusy(false)
    }
  }
  return { error, busy, submit, bad: (field: string) => (error?.field === field ? true : undefined) }
}

async function enter(setMe: (me: Me) => void, next: string): Promise<void> {
  setMe(await call<Me>('GET', '/api/me'))
  navigate(next)
}

function Field({ label, type = 'text', value, onChange, invalid, autoComplete }: {
  label: string; type?: string; value: string; onChange(value: string): void; invalid?: true; autoComplete?: string
}) {
  return (
    <label className="field">{label}
      <input type={type} value={value} aria-invalid={invalid} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

export function Signin() {
  const { setMe } = useSession()
  const { search } = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const form = useForm()
  const go = form.submit(async () => {
    await call('POST', '/api/session', { email, password })
    await enter(setMe, safeNext(search.get('next')))
  })
  return (
    <Shell lead="Sign in to your patterns." live={null}>
      <form className="stack narrow" onSubmit={go} noValidate>
        <span className="tile tint-blue"><Glyph stitch="k" size={22} /></span>
        <h1>Sign in</h1>
        <Field label="Email" value={email} onChange={setEmail} autoComplete="username" />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        {form.error && <p role="alert" aria-label="Sign-in error" className="error">{form.error.message}</p>}
        <button type="submit" className="primary" disabled={form.busy} aria-busy={form.busy}>Sign in</button>
        <p>New here? <Link to="/signup">Create an account</Link></p>
      </form>
    </Shell>
  )
}

export function Signup() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const form = useForm()
  const go = form.submit(async () => {
    await call('POST', '/api/signup', { name, email, password })
    setSent(true)
  })
  return (
    <Shell lead="Create your Twinrow account." live={null}>
      {sent ? <p>Check your email to verify your account.</p> : (
        <form className="stack narrow" onSubmit={go} noValidate>
          <h1>Create account</h1>
          <Field label="Name" value={name} onChange={setName} invalid={form.bad('name')} autoComplete="name" />
          <Field label="Email" value={email} onChange={setEmail} invalid={form.bad('email')} autoComplete="email" />
          <Field label="Password" type="password" value={password} onChange={setPassword} invalid={form.bad('password')} autoComplete="new-password" />
          {form.error && <p role="alert" aria-label="Sign-up error" className="error">{form.error.message}</p>}
          <button type="submit" className="primary" disabled={form.busy} aria-busy={form.busy}>Create account</button>
          <p>Already have an account? <Link to="/signin">Sign in</Link></p>
        </form>
      )}
    </Shell>
  )
}

export function Verify() {
  const token = useLocation().search.get('token') ?? ''
  const [state, setState] = useState<'checking' | 'verified' | 'expired'>('checking')
  useEffect(() => {
    call('POST', '/api/verify', { token }).then(() => setState('verified'), () => setState('expired'))
  }, [token])
  return (
    <Shell lead={state === 'checking' ? 'Loading...' : 'Email verification.'} live={null}>
      {state === 'verified' && <div className="stack"><p>Your email is verified.</p><Link to="/signin" className="button primary">Sign in</Link></div>}
      {state === 'expired' && <p>This link has expired. Sign up again to get a new one.</p>}
    </Shell>
  )
}

interface Invitation { patternName: string; hasAccount: boolean; status: 'sent' | 'accepted' | 'expired' }

export function Invite({ token }: { token: string }) {
  const { setMe } = useSession()
  const [invitation, setInvitation] = useState<Invitation | null | 'missing'>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const form = useForm()
  useEffect(() => { call<Invitation>('GET', `/api/invites/${token}`).then(setInvitation, () => setInvitation('missing')) }, [token])
  if (invitation === 'missing') return <NotFound />
  const join = form.submit(async () => {
    const joined = await call<{ patternId: string }>('POST', `/api/invites/${token}/accept`, invitation?.hasAccount ? { password } : { name, password })
    await enter(setMe, `/follow/${joined.patternId}`)
  })
  let body: ReactNode = null
  if (invitation?.status === 'expired') body = <p>This invitation has expired. Ask the designer for a new one.</p>
  else if (invitation?.status === 'accepted') body = <p>This invitation has already been used.</p>
  else if (invitation) {
    body = (
      <form className="stack narrow" onSubmit={join} noValidate>
        <h1>{invitation.patternName}</h1>
        {!invitation.hasAccount && <Field label="Name" value={name} onChange={setName} invalid={form.bad('name')} autoComplete="name" />}
        <Field label="Password" type="password" value={password} onChange={setPassword} invalid={form.bad('password')}
          autoComplete={invitation.hasAccount ? 'current-password' : 'new-password'} />
        {form.error && <p role="alert" aria-label="Invite error" className="error">{form.error.message}</p>}
        <button type="submit" className="primary" disabled={form.busy} aria-busy={form.busy}>Join as tester</button>
      </form>
    )
  }
  return <Shell lead={invitation ? 'You are invited to test a pattern.' : 'Loading...'} live={null}>{body}</Shell>
}

interface PatternItem { id: string; name: string; state: 'draft' | 'published'; role: 'owner' | 'co-designer' | 'tester' }
const TILE = { owner: 'k', 'co-designer': 'c22', tester: 'yo' } as const
const TINT = { owner: 'blue', 'co-designer': 'lilac', tester: 'sage' } as const

function NewPatternButton() {
  const open = useNewPattern()
  return <button type="button" className="primary" onClick={open}>New pattern</button>
}

export function Home() {
  const me = useRequireUser()
  const { layout } = useSession()
  const { live } = useLive(null, () => undefined)
  const [patterns, setPatterns] = useState<PatternItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (me) call<{ patterns: PatternItem[] }>('GET', '/api/patterns').then((r) => setPatterns(r.patterns), () => setFailed(true))
  }, [me])
  if (!me) return null
  const sample = async () => {
    const made = await call<{ id: string }>('POST', '/api/patterns', { sample: true })
    navigate(`/patterns/${made.id}`)
  }
  const lead = failed ? 'This page could not be loaded. Reload to try again.' : patterns ? 'Pick up a pattern or start a new one.' : 'Loading...'
  return (
    <Shell lead={lead} live={live}>
      {patterns && (
        <div className="stack">
          <div className="heading-row">
            <h1>Your patterns</h1>
            {layout === 'phone' && <NewPatternButton />}
          </div>
          {patterns.length === 0 ? (
            <div className="stack">
              <p>No patterns yet. Start one from the sample or a blank chart.</p>
              <div><button type="button" onClick={() => void sample()}>Use the sample</button></div>
            </div>
          ) : (
            <ul role="list" aria-label="Patterns" className="cards">
              {patterns.map((p) => (
                <Card key={p.id} to={p.role === 'tester' ? `/follow/${p.id}` : `/patterns/${p.id}`} label={p.name}
                  tile={<Glyph stitch={TILE[p.role]} size={22} />} tint={TINT[p.role]} badge={p.role === 'tester' ? 'Following' : p.state === 'published' ? 'Published' : 'Draft'} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Shell>
  )
}

export function SettingsPage() {
  const me = useRequireUser()
  const { setMe } = useSession()
  const { live } = useLive(null, () => undefined)
  const [name, setName] = useState(me?.name ?? '')
  const [reduce, setReduce] = useState(me?.reduceMotion ?? false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [saved, setSaved] = useState('')
  const profile = useForm()
  const password = useForm()
  useEffect(() => { if (me) { setName(me.name); setReduce(me.reduceMotion) } }, [me])
  if (!me) return null
  const error = profile.error ?? password.error
  const bad = (field: string) => profile.bad(field) ?? password.bad(field)
  const saveProfile = profile.submit(async () => {
    setSaved('')
    setMe(await call<Me>('PATCH', '/api/me', { name, reduceMotion: reduce }))
    setSaved('Saved.')
  })
  const changePassword = password.submit(async () => {
    setSaved('')
    await call('POST', '/api/me/password', { current, next })
    setCurrent('')
    setNext('')
    setSaved('Saved.')
  })
  const signOut = async () => {
    await call('DELETE', '/api/session')
    setMe(null)
    navigate('/signin')
  }
  return (
    <Shell lead="Your profile and preferences." live={live}>
      <div className="stack narrow">
        <h1>Settings</h1>
        <form className="stack" onSubmit={saveProfile} noValidate>
          <Field label="Name" value={name} onChange={setName} invalid={bad('name')} />
          <label className="check"><input type="checkbox" checked={reduce} onChange={(e) => setReduce(e.target.checked)} />Reduce motion</label>
          <div><button type="submit" className="primary" disabled={profile.busy} aria-busy={profile.busy}>Save profile</button></div>
        </form>
        <form className="stack" onSubmit={changePassword} noValidate>
          <Field label="Current password" type="password" value={current} onChange={setCurrent} invalid={bad('current')} autoComplete="current-password" />
          <Field label="New password" type="password" value={next} onChange={setNext} invalid={bad('next')} autoComplete="new-password" />
          <div><button type="submit" disabled={password.busy} aria-busy={password.busy}>Change password</button></div>
        </form>
        <div role="status" aria-label="Settings">{saved}</div>
        {error && <p role="alert" aria-label="Settings error" className="error">{error.message}</p>}
        <div><button type="button" onClick={() => void signOut()}>Sign out</button></div>
      </div>
    </Shell>
  )
}
