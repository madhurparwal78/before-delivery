import { useEffect, useRef, useState, type FormEvent } from 'react'
import { timeZoneNames } from '../shared/share'
import type { DisplayUnit, PaperSize, Profile } from '../shared/api-types'
import { api, ApiError, weightInput } from './api'
import { cache } from './cache'
import { navigate } from './router'
import { cancelHeld, heldChanges, resumeHeld } from './session-hold'
import { useStore } from './status'
import { Dialog, FieldError, RadioGroup, Status } from './ui'

const PASSPHRASE_REFUSED = "That passphrase didn't match."

function PassphraseForm({ onSignedIn, children, autoFocus = false }: { onSignedIn: () => void; children?: React.ReactNode; autoFocus?: boolean }) {
  const [passphrase, setPassphrase] = useState('')
  const [message, setMessage] = useState<string | undefined>()
  const field = useRef<HTMLInputElement>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      await api.signIn(passphrase)
      onSignedIn()
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      setMessage(error.status === 401 ? PASSPHRASE_REFUSED : error.message)
      field.current?.focus()
    }
  }

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <div className="field">
        <label htmlFor="passphrase">Passphrase</label>
        <input
          id="passphrase" ref={field} type="text" className="secret" autoComplete="off" autoCapitalize="off" spellCheck={false}
          autoFocus={autoFocus} value={passphrase} aria-invalid={message ? true : undefined}
          aria-describedby={message ? 'passphrase-error' : undefined}
          onChange={(event) => { setPassphrase(event.target.value); setMessage(undefined) }}
        />
        <FieldError id="passphrase-error" message={message} />
      </div>
      <div className="actions">
        <button type="submit" className="primary">Sign in</button>
        {children}
      </div>
    </form>
  )
}

export function SignIn() {
  return (
    <main className="sign-in">
      <h1>Skinout</h1>
      <p className="lede">One closet, every trip list, every gram.</p>
      <PassphraseForm onSignedIn={() => navigate('/trips')} />
    </main>
  )
}

/** The Sign in again dialog: opens over the workspace when a change finds the session ended. */
export function SessionDialog() {
  const held = useStore(heldChanges)
  if (held.length === 0) return null
  return (
    <Dialog name="Sign in again" onClose={cancelHeld}>
      <h2>Sign in again</h2>
      <p>Your session ended. Sign in to finish this change.</p>
      <PassphraseForm onSignedIn={() => void resumeHeld()}>
        <button type="button" onClick={cancelHeld}>Cancel</button>
      </PassphraseForm>
    </Dialog>
  )
}

const UNIT_OPTIONS = [
  { value: 'g', label: 'Grams' },
  { value: 'oz', label: 'Ounces' },
  { value: 'lb', label: 'Pounds and ounces' },
] as const
const GOAL_UNITS = [{ value: 'g', label: 'g' }, { value: 'oz', label: 'oz' }] as const
const PAPER = [{ value: 'A4', label: 'A4' }, { value: 'Letter', label: 'Letter' }] as const

export function Settings() {
  const [profile, setProfile] = useState<Profile | null>(cache.profile.get())
  const [name, setName] = useState('')
  const [unit, setUnit] = useState<DisplayUnit>('g')
  const [goal, setGoal] = useState('')
  const [goalUnit, setGoalUnit] = useState<'g' | 'oz'>('g')
  const [zone, setZone] = useState('UTC')
  const [paper, setPaper] = useState<PaperSize>('A4')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const form = useRef<HTMLFormElement>(null)

  function fill(next: Profile) {
    setProfile(next)
    setName(next.displayName)
    setUnit(next.unit)
    setGoal(String(next.goalGrams))
    setGoalUnit('g')
    setZone(next.timeZone)
    setPaper(next.paperSize)
  }

  useEffect(() => {
    api.profile().then((loaded) => { cache.profile.set(loaded); fill(loaded) }, () => { const cached = cache.profile.get(); if (cached) fill(cached) })
  }, [])

  useEffect(() => {
    if (Object.keys(errors).length > 0) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [errors])

  async function save(event: FormEvent) {
    event.preventDefault()
    setMessage('')
    try {
      const saved = await api.saveProfile({
        displayName: name, unit, goal: weightInput(goal, goalUnit), timeZone: zone, paperSize: paper,
      })
      cache.profile.set(saved)
      fill(saved)
      setErrors({})
      setMessage('Settings saved.')
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      setErrors(error.fields)
    }
  }

  return (
    <main className="page">
      <h1 tabIndex={-1}>Settings</h1>
      <form ref={form} onSubmit={save} className="sheet-form" noValidate>
        <div className="field">
          <label htmlFor="display-name">Display name</label>
          <input id="display-name" type="text" value={name} aria-invalid={errors.displayName ? true : undefined} aria-describedby={errors.displayName ? 'e-name' : undefined} onChange={(e) => setName(e.target.value)} />
          <FieldError id="e-name" message={errors.displayName} />
        </div>
        <div className="field">
          <span className="label">Display unit</span>
          <RadioGroup name="Display unit" groupName="display-unit" value={unit} options={UNIT_OPTIONS} onChange={setUnit} />
          <FieldError id="e-unit" message={errors.unit} />
        </div>
        <div className="field">
          <label htmlFor="goal">Base-weight goal</label>
          <input id="goal" type="number" step="any" min="0" className="weight-input" value={goal} aria-invalid={errors.goal ? true : undefined} aria-describedby={errors.goal ? 'e-goal' : undefined} onChange={(e) => setGoal(e.target.value)} />
          <RadioGroup name="Goal unit" groupName="goal-unit" value={goalUnit} options={GOAL_UNITS} onChange={setGoalUnit} />
          <FieldError id="e-goal" message={errors.goal} />
        </div>
        <div className="field">
          <label htmlFor="time-zone">Time zone</label>
          <select id="time-zone" value={zone} aria-invalid={errors.timeZone ? true : undefined} onChange={(e) => setZone(e.target.value)}>
            {timeZoneNames().map((zoneName) => <option key={zoneName} value={zoneName}>{zoneName}</option>)}
          </select>
          <FieldError id="e-zone" message={errors.timeZone} />
        </div>
        <div className="field">
          <span className="label">Paper size</span>
          <RadioGroup name="Paper size" groupName="paper-size" value={paper} options={PAPER} onChange={setPaper} />
          <FieldError id="e-paper" message={errors.paperSize} />
        </div>
        <div className="actions"><button type="submit" className="primary" disabled={!profile}>Save settings</button></div>
        <Status name="Settings" text={message} />
      </form>
    </main>
  )
}
