// Every dialog of the workspace. Field errors come from the API's `errors` map.

import { useId, useState, type ReactNode } from 'react'
import { CLEFS, type Clef, type Transpose } from '../shared/music.js'
import type { Collaborator, Part, Staff } from '../shared/protocol.js'
import { filterText } from '../shared/text.js'
import { api, ApiFailure, NetworkFailure } from './api.js'
import { Dialog, ErrorSummary, FieldError, useDialogClose, useSession, useSnapshot, useSubmit, type FieldErrors } from './ui.js'

const TRANSPOSITIONS: { label: string; value: Transpose }[] = [
  { label: 'Concert pitch', value: { diatonic: 0, chromatic: 0 } },
  { label: 'B♭ (sounds a major second lower)', value: { diatonic: -1, chromatic: -2 } },
  { label: 'A (sounds a minor third lower)', value: { diatonic: -2, chromatic: -3 } },
  { label: 'F (sounds a perfect fifth lower)', value: { diatonic: -4, chromatic: -7 } },
  { label: 'E♭ (sounds a major sixth lower)', value: { diatonic: -5, chromatic: -9 } },
  { label: 'Octave lower', value: { diatonic: -7, chromatic: -12 } },
]

const CLEF_LABEL: Record<Clef, string> = { treble: 'Treble', alto: 'Alto', tenor: 'Tenor', bass: 'Bass', percussion: 'Percussion' }

function failureErrors(error: unknown): FieldErrors {
  if (error instanceof ApiFailure) return error.body.errors ?? { form: error.body.message }
  if (error instanceof NetworkFailure) return { form: 'The server could not be reached. Try again.' }
  return { form: 'Something went wrong. Try again.' }
}

function transposeIndex(transpose: Transpose): number {
  const at = TRANSPOSITIONS.findIndex((t) => t.value.diatonic === transpose.diatonic && t.value.chromatic === transpose.chromatic)
  return Math.max(0, at)
}

interface FormProps {
  fields: Record<string, string>
  errors: FieldErrors
  children: ReactNode
  submit: string
  pending: boolean
  onSubmit: (event: React.FormEvent) => void
  cancel?: string
}

function Form({ fields, errors, children, submit, pending, onSubmit, cancel = 'Cancel' }: FormProps): ReactNode {
  const close = useDialogClose()
  return (
    <form onSubmit={onSubmit} noValidate>
      <ErrorSummary errors={errors} fields={{ form: fields.first ?? '', ...fields }} />
      {children}
      <div className="dialog-actions">
        <button type="button" className="btn secondary" onClick={close}>{cancel}</button>
        <button type="submit" className="btn" disabled={pending}>{pending ? `${submit}…` : submit}</button>
      </div>
    </form>
  )
}

export function AddStaffDialog({ onClose }: { onClose: () => void }): ReactNode {
  const session = useSession()
  const { parts } = useSnapshot()
  const id = useId()
  const [name, setName] = useState('')
  const [clef, setClef] = useState<Clef>('treble')
  const [transposition, setTransposition] = useState(0)
  const [partId, setPartId] = useState('')
  const { pending, errors, run, fail } = useSubmit()
  const names = `${id}-name`
  const fields = { first: names, name: names, clef: `${id}-clef`, transpose: `${id}-transposition`, partId: `${id}-part`, staves: names, afterStaffId: names }
  return (
    <Dialog name="Add staff" onClose={onClose}>
      <AddStaffForm {...{ name, setName, clef, setClef, transposition, setTransposition, partId, setPartId, parts, pending, errors, fields }}
        onSubmit={(event, closeDialog) =>
          run(event, async () => {
            try {
              const result = await api<{ staff: Staff }>('POST', `/api/scores/${session.scoreId}/staves`, {
                name, clef, transpose: (TRANSPOSITIONS[transposition] as (typeof TRANSPOSITIONS)[number]).value, partId: partId || null, afterStaffId: null,
              })
              session.notice('Score changes', `${result.staff.name} added.`)
              closeDialog()
            } catch (error) {
              fail(failureErrors(error))
            }
          })} />
    </Dialog>
  )
}

interface AddStaffFormProps {
  name: string; setName: (v: string) => void; clef: Clef; setClef: (v: Clef) => void; transposition: number; setTransposition: (v: number) => void
  partId: string; setPartId: (v: string) => void; parts: Part[]; pending: boolean; errors: FieldErrors; fields: Record<string, string>
  onSubmit: (event: React.FormEvent, close: () => void) => void
}

function AddStaffForm(p: AddStaffFormProps): ReactNode {
  const close = useDialogClose()
  return (
    <Form fields={p.fields} errors={p.errors} submit="Create staff" pending={p.pending} onSubmit={(e) => p.onSubmit(e, close)}>
      <label className="field">Staff name
        <input aria-label="Staff name" id={p.fields.name} type="text" value={p.name} onChange={(e) => p.setName(e.target.value)} autoComplete="off" aria-describedby={p.errors.name ? `${p.fields.name}-error` : undefined} aria-invalid={!!p.errors.name || undefined} />
        <FieldError id={`${p.fields.name}-error`} message={p.errors.name ?? p.errors.staves} />
      </label>
      <label className="field">Clef
        <select aria-label="Clef" id={p.fields.clef} value={p.clef} onChange={(e) => p.setClef(e.target.value as Clef)}>
          {CLEFS.map((c) => <option key={c} value={c}>{CLEF_LABEL[c]}</option>)}
        </select>
        <FieldError id={`${p.fields.clef}-error`} message={p.errors.clef} />
      </label>
      <label className="field">Transposition
        <select aria-label="Transposition" id={p.fields.transpose} value={p.transposition} onChange={(e) => p.setTransposition(Number(e.target.value))}>
          {TRANSPOSITIONS.map((t, i) => <option key={t.label} value={i}>{t.label}</option>)}
        </select>
        <FieldError id={`${p.fields.transpose}-error`} message={p.errors.transpose} />
      </label>
      <label className="field">Part
        <select aria-label="Part" id={p.fields.partId} value={p.partId} onChange={(e) => p.setPartId(e.target.value)}>
          <option value="">New part</option>
          {p.parts.map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}
        </select>
        <FieldError id={`${p.fields.partId}-error`} message={p.errors.partId} />
      </label>
    </Form>
  )
}

const SIGNATURES: { label: string; value: { beats: number; beatType: number } | null }[] = [
  { label: 'Same as last', value: null },
  { label: '2/4', value: { beats: 2, beatType: 4 } },
  { label: '3/4', value: { beats: 3, beatType: 4 } },
  { label: '4/4', value: { beats: 4, beatType: 4 } },
  { label: '5/4', value: { beats: 5, beatType: 4 } },
  { label: '6/8', value: { beats: 6, beatType: 8 } },
]

export function AddMeasuresDialog({ onClose }: { onClose: () => void }): ReactNode {
  return (
    <Dialog name="Add measures" onClose={onClose}>
      <AddMeasuresForm />
    </Dialog>
  )
}

function AddMeasuresForm(): ReactNode {
  const session = useSession()
  const close = useDialogClose()
  const id = useId()
  const [count, setCount] = useState('1')
  const [signature, setSignature] = useState(0)
  const { pending, errors, run, fail } = useSubmit()
  const countId = `${id}-count`
  return (
    <Form fields={{ first: countId, count: countId, timeSignature: `${id}-sig`, measures: countId }} errors={errors} submit="Append" pending={pending}
      onSubmit={(event) =>
        run(event, async () => {
          try {
            const result = await api<{ measureCount: number }>('POST', `/api/scores/${session.scoreId}/measures`, {
              count: Number(count), ...(SIGNATURES[signature]?.value ? { timeSignature: SIGNATURES[signature]?.value } : {}),
            })
            session.notice('Score changes', `${count} measures added. The score now has ${result.measureCount} measures.`)
            close()
          } catch (error) {
            fail(failureErrors(error))
          }
        })}>
      <label className="field">Measures to add
        <input aria-label="Measures to add" id={countId} type="number" min={1} max={2000} value={count} onChange={(e) => setCount(e.target.value)} aria-invalid={!!(errors.count ?? errors.measures) || undefined} />
        <FieldError id={`${countId}-error`} message={errors.count ?? errors.measures} />
      </label>
      <label className="field">Time signature
        <select aria-label="Time signature" id={`${id}-sig`} value={signature} onChange={(e) => setSignature(Number(e.target.value))}>
          {SIGNATURES.map((s, i) => <option key={s.label} value={i}>{s.label}</option>)}
        </select>
        <FieldError id={`${id}-sig-error`} message={errors.timeSignature} />
      </label>
    </Form>
  )
}

export function ExtractDialog({ onClose, initialPartId, onExtract }: { onClose: () => void; initialPartId: string; onExtract: (part: Part) => void }): ReactNode {
  return (
    <Dialog name="Extract part" onClose={onClose}>
      <ExtractForm initialPartId={initialPartId} onExtract={onExtract} />
    </Dialog>
  )
}

function ExtractForm({ initialPartId, onExtract }: { initialPartId: string; onExtract: (part: Part) => void }): ReactNode {
  const session = useSession()
  const close = useDialogClose()
  const { parts, me } = useSnapshot()
  const id = useId()
  const allowed = me?.role === 'player' ? parts.filter((p) => p.staffIds.every((s) => me.staffIds.includes(s))) : parts
  const [partId, setPartId] = useState(allowed.find((p) => p.id === initialPartId)?.id ?? allowed[0]?.id ?? '')
  const { pending, errors, run, fail } = useSubmit()
  return (
    <Form fields={{ first: `${id}-part`, form: `${id}-part`, partId: `${id}-part` }} errors={errors} submit="Extract" pending={pending}
      onSubmit={(event) =>
        run(event, async () => {
          try {
            const result = await api<{ part: Part }>('POST', `/api/scores/${session.scoreId}/parts/${partId}/extract`, {})
            session.notice('Parts', `Engraving ${result.part.name}…`)
            close()
            onExtract(result.part)
          } catch (error) {
            fail(failureErrors(error))
          }
        })}>
      <label className="field">Part
        <select aria-label="Part" id={`${id}-part`} value={partId} onChange={(e) => setPartId(e.target.value)}>
          {allowed.map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}
        </select>
      </label>
    </Form>
  )
}

export function StaffSettingsDialog({ staff, onClose }: { staff: Staff; onClose: () => void }): ReactNode {
  return (
    <Dialog name="Staff settings" onClose={onClose}>
      <StaffSettingsForm staff={staff} />
    </Dialog>
  )
}

function StaffSettingsForm({ staff }: { staff: Staff }): ReactNode {
  const session = useSession()
  const close = useDialogClose()
  const id = useId()
  const [name, setName] = useState(staff.name)
  const [clef, setClef] = useState<Clef>(staff.clef)
  const [transposition, setTransposition] = useState(transposeIndex(staff.transpose))
  const { pending, errors, run, fail } = useSubmit()
  const nameId = `${id}-name`
  return (
    <Form fields={{ first: nameId, name: nameId, clef: `${id}-clef`, transpose: `${id}-tr`, form: nameId }} errors={errors} submit="Save staff" pending={pending}
      onSubmit={(event) =>
        run(event, async () => {
          try {
            const result = await api<{ staff: Staff }>('PATCH', `/api/scores/${session.scoreId}/staves/${staff.id}`, {
              name, clef, transpose: (TRANSPOSITIONS[transposition] as (typeof TRANSPOSITIONS)[number]).value,
            })
            session.notice('Score changes', `${result.staff.name} saved.`)
            close()
          } catch (error) {
            fail(failureErrors(error))
          }
        })}>
      <label className="field">Staff name
        <input aria-label="Staff name" id={nameId} type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" aria-invalid={!!errors.name || undefined} />
        <FieldError id={`${nameId}-error`} message={errors.name} />
      </label>
      <label className="field">Clef
        <select aria-label="Clef" id={`${id}-clef`} value={clef} onChange={(e) => setClef(e.target.value as Clef)}>
          {CLEFS.map((c) => <option key={c} value={c}>{CLEF_LABEL[c]}</option>)}
        </select>
      </label>
      <label className="field">Transposition
        <select aria-label="Transposition" id={`${id}-tr`} value={transposition} onChange={(e) => setTransposition(Number(e.target.value))}>
          {TRANSPOSITIONS.map((t, i) => <option key={t.label} value={i}>{t.label}</option>)}
        </select>
      </label>
    </Form>
  )
}

export function TextDialog({ initial, onSave, onClose }: { initial: string; onSave: (raw: string) => Promise<void>; onClose: () => void }): ReactNode {
  return (
    <Dialog name="Expression text" onClose={onClose}>
      <TextForm initial={initial} onSave={onSave} />
    </Dialog>
  )
}

function TextForm({ initial, onSave }: { initial: string; onSave: (raw: string) => Promise<void> }): ReactNode {
  const close = useDialogClose()
  const id = useId()
  const [text, setText] = useState(initial)
  const { pending, errors, run, fail } = useSubmit()
  const filtered = filterText(text)
  const textId = `${id}-text`
  return (
    <Form fields={{ first: textId, text: textId, value: textId, form: textId }} errors={errors} submit="Save text" pending={pending}
      onSubmit={(event) =>
        run(event, async () => {
          try {
            await onSave(text)
            close()
          } catch (error) {
            fail(failureErrors(error))
          }
        })}>
      <label className="field">Text
        <textarea aria-label="Text" id={textId} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!(errors.text ?? errors.value) || undefined} />
        <FieldError id={`${textId}-error`} message={errors.text ?? errors.value} />
      </label>
      <p className="copy-note">Italic, bold and line breaks are kept. {filtered.length} of 200 characters.</p>
      <div role="region" aria-label="Preview" className="preview" dangerouslySetInnerHTML={{ __html: filtered.html }} />
    </Form>
  )
}

function StaffListbox({ staves, value, onChange, label, id }: { staves: Staff[]; value: string[]; onChange: (next: string[]) => void; label: string; id: string }): ReactNode {
  const toggle = (staffId: string): void => onChange(value.includes(staffId) ? value.filter((s) => s !== staffId) : [...value, staffId])
  const [active, setActive] = useState(0)
  return (
    <div id={id} role="listbox" aria-label={label} aria-multiselectable="true" tabIndex={0} aria-activedescendant={staves[active] ? `${id}-${staves[active]?.id}` : undefined}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') setActive(Math.min(staves.length - 1, active + 1))
        else if (event.key === 'ArrowUp') setActive(Math.max(0, active - 1))
        else if (event.key === ' ' && staves[active]) toggle((staves[active] as Staff).id)
        else return
        event.preventDefault()
      }}>
      {staves.map((s) => (
        <div key={s.id} id={`${id}-${s.id}`} role="option" aria-selected={value.includes(s.id)} onClick={() => toggle(s.id)}>{s.name}</div>
      ))}
    </div>
  )
}

export function InviteDialog({ onClose }: { onClose: () => void }): ReactNode {
  return (
    <Dialog name="Invite collaborator" onClose={onClose}>
      <InviteForm />
    </Dialog>
  )
}

function InviteForm(): ReactNode {
  const session = useSession()
  const close = useDialogClose()
  const { score } = useSnapshot()
  const id = useId()
  const [name, setName] = useState('')
  const [role, setRole] = useState<'copyist' | 'player'>('copyist')
  const [staffIds, setStaffIds] = useState<string[]>([])
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const { pending, errors, run, fail } = useSubmit()
  const nameId = `${id}-name`
  if (link !== null) {
    return (
      <div>
        <label className="field">Invite link
          <input aria-label="Invite link" type="text" readOnly value={link} id={`${id}-link`} onFocus={(e) => e.currentTarget.select()} />
        </label>
        <p className="copy-note" aria-live="off">{copied ? 'Link copied.' : 'Send this link to the invitee. It works once.'}</p>
        <div className="dialog-actions">
          <button type="button" className="btn secondary" onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => setCopied(true), () => setCopied(false))
            document.getElementById(`${id}-link`)?.focus()
          }}>Copy link</button>
          <button type="button" className="btn" onClick={close}>Done</button>
        </div>
      </div>
    )
  }
  return (
    <Form fields={{ first: nameId, name: nameId, role: `${id}-role`, staffIds: `${id}-staves`, form: nameId }} errors={errors} submit="Create invite" pending={pending}
      onSubmit={(event) =>
        run(event, async () => {
          try {
            const result = await api<{ inviteUrl: string }>('POST', `/api/scores/${session.scoreId}/invites`, { name, role, staffIds: role === 'player' ? staffIds : [] })
            session.notice('Team', `Invite created for ${name.trim()}.`)
            setLink(`${location.origin}${result.inviteUrl}`)
          } catch (error) {
            fail(failureErrors(error))
          }
        })}>
      <label className="field">Name
        <input aria-label="Name" id={nameId} type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" aria-invalid={!!errors.name || undefined} />
        <FieldError id={`${nameId}-error`} message={errors.name} />
      </label>
      <label className="field">Role
        <select aria-label="Role" id={`${id}-role`} value={role} onChange={(e) => setRole(e.target.value as 'copyist' | 'player')}>
          <option value="copyist">Copyist</option>
          <option value="player">Section player</option>
        </select>
        <FieldError id={`${id}-role-error`} message={errors.role} />
      </label>
      {role === 'player' && (
        <div className="field">
          <span id={`${id}-staves-label`}>Staves they can edit</span>
          <StaffListbox id={`${id}-staves`} label="Staves they can edit" staves={score?.staves ?? []} value={staffIds} onChange={setStaffIds} />
          <FieldError id={`${id}-staves-error`} message={errors.staffIds} />
        </div>
      )}
    </Form>
  )
}

export function StavesForDialog({ person, onClose }: { person: Collaborator; onClose: () => void }): ReactNode {
  return (
    <Dialog name={`Staves for ${person.name}`} onClose={onClose}>
      <StavesForForm person={person} />
    </Dialog>
  )
}

function StavesForForm({ person }: { person: Collaborator }): ReactNode {
  const session = useSession()
  const close = useDialogClose()
  const { score } = useSnapshot()
  const id = useId()
  const [staffIds, setStaffIds] = useState(person.staffIds)
  const { pending, errors, run, fail } = useSubmit()
  return (
    <Form fields={{ first: `${id}-staves`, staffIds: `${id}-staves`, form: `${id}-staves` }} errors={errors} submit="Save staves" pending={pending}
      onSubmit={(event) =>
        run(event, async () => {
          try {
            await api('PATCH', `/api/scores/${session.scoreId}/collaborators/${person.id}`, { staffIds })
            session.notice('Team', `Staves updated for ${person.name}.`)
            close()
          } catch (error) {
            fail(failureErrors(error))
          }
        })}>
      <div className="field">
        <span>Staves they can edit</span>
        <StaffListbox id={`${id}-staves`} label="Staves they can edit" staves={score?.staves ?? []} value={staffIds} onChange={setStaffIds} />
        <FieldError id={`${id}-staves-error`} message={errors.staffIds} />
      </div>
    </Form>
  )
}

export function RemoveDialog({ person, onClose }: { person: Collaborator; onClose: () => void }): ReactNode {
  return (
    <Dialog name={`Remove ${person.name}?`} alert onClose={onClose}>
      <RemoveForm person={person} />
    </Dialog>
  )
}

function RemoveForm({ person }: { person: Collaborator }): ReactNode {
  const session = useSession()
  const close = useDialogClose()
  const { pending, errors, run, fail } = useSubmit()
  return (
    <Form fields={{ first: '', form: '' }} errors={errors} submit="Remove" pending={pending}
      onSubmit={(event) =>
        run(event, async () => {
          try {
            await api('DELETE', `/api/scores/${session.scoreId}/collaborators/${person.id}`)
            session.notice('Team', `${person.name} removed.`)
            close()
          } catch (error) {
            fail(failureErrors(error))
          }
        })}>
      <p>They lose access at once and their holds are released.</p>
    </Form>
  )
}
