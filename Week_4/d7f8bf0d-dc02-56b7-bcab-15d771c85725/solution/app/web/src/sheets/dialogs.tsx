import { useState, type FormEvent } from 'react'
import {
  act, adoptSnapshot, createModule, layoutPath, openWorkspace, refreshLayout, refreshWorkspaceLists, sessionPath, workspacePath,
} from '../actions'
import { apiGet, apiWrite } from '../api'
import { COPY } from '../copy'
import { store, useSelector, type DialogState } from '../state'
import { Button, Modal, SelectField, TextField } from '../ui/primitives'
import { Skeleton } from './skeleton'
import { useLoad } from './use-load'
import type { LayoutVersion, Membership, SessionSnapshot } from '../../../shared/domain'

const close = (): void => store.set({ dialog: null })

function Actions({ submit, busy }: { submit: string; busy: boolean }) {
  return (
    <div className="modal-actions">
      <Button className="btn-ghost" onClick={close}>Cancel</Button>
      <Button type="submit" busy={busy} disabled={busy}>{submit}</Button>
    </div>
  )
}

function NewWorkspaceDialog() {
  const [name, setName] = useState('')
  const [template, setTemplate] = useState('reference')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    const done = await act({
      pending: COPY.creatingWorkspace,
      run: () => apiWrite<{ workspace: { id: string } }>('POST', '/api/workspaces', { name, template }),
      success: () => COPY.workspaceCreated,
      inline: true,
    })
    if (done.ok) {
      const me = await apiGet<{ memberships: Membership[] }>('/api/me')
      store.set({ memberships: me.memberships, dialog: null })
      await openWorkspace(done.value.workspace.id)
    } else {
      setErrors(done.error.fields)
      setBusy(false)
    }
  }

  return (
    <Modal title="New workspace" testId="new-workspace-dialog" onClose={close}>
      <form onSubmit={event => void create(event)}>
        <TextField label="Workspace name" value={name} error={errors.name} onChange={event => setName(event.target.value)} />
        <SelectField label="Template" value={template} error={errors.template} onChange={event => setTemplate(event.target.value)}
          options={[{ value: 'reference', label: 'Reference layout' }, { value: 'empty', label: 'Empty' }]} />
        <Actions submit="Create workspace" busy={busy} />
      </form>
    </Modal>
  )
}

function AddModuleDialog() {
  const [name, setName] = useState('')
  const [endplate, setEndplate] = useState<'single' | 'double'>('single')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    const done = await createModule(name, endplate)
    if (done.ok) {
      close()
    } else {
      setErrors(done.error.fields)
      setBusy(false)
    }
  }

  return (
    <Modal title="Add module" testId="add-module-dialog" onClose={close}>
      <form onSubmit={event => void create(event)}>
        <TextField label="Module name" value={name} error={errors.name ?? errors.endplates} onChange={event => setName(event.target.value)} />
        <SelectField label="Endplate" value={endplate} onChange={event => setEndplate(event.target.value === 'double' ? 'double' : 'single')}
          options={[{ value: 'single', label: 'Single' }, { value: 'double', label: 'Double' }]} />
        <Actions submit="Create module" busy={busy} />
      </form>
    </Modal>
  )
}

function NewSessionDialog() {
  const { data } = useLoad(() => apiGet<{ versions: LayoutVersion[] }>(`${layoutPath()}/versions`), [])
  const published = (data?.versions ?? []).filter(version => version.state === 'Published').sort((a, b) => b.number - a.number)
  const [name, setName] = useState('')
  const [chosen, setChosen] = useState('')
  const [ratio, setRatio] = useState('6')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const versionId = published.some(version => version.id === chosen) ? chosen : published[0]?.id ?? ''

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    const done = await act({
      pending: COPY.creatingSession,
      run: () => apiWrite<SessionSnapshot>('POST', `${workspacePath()}/sessions`, { name, layout_version_id: versionId, ratio: Number(ratio) }),
      success: () => COPY.sessionCreated,
      inline: true,
    })
    if (done.ok) {
      await refreshWorkspaceLists()
      close()
    } else {
      setErrors(done.error.fields)
      setBusy(false)
    }
  }

  return (
    <Modal title="New session" testId="new-session-dialog" onClose={close}>
      {data === null ? <Skeleton /> : (
        <form onSubmit={event => void create(event)}>
          <TextField label="Session name" value={name} error={errors.name} onChange={event => setName(event.target.value)} />
          <SelectField label="Published version" value={versionId} error={errors.layout_version_id} onChange={event => setChosen(event.target.value)}
            options={published.map(version => ({ value: version.id, label: `Version ${version.number} ${version.label}` }))} />
          <TextField label="Clock ratio" type="number" min={1} max={12} step={1} value={ratio} error={errors.ratio} onChange={event => setRatio(event.target.value)} />
          <Actions submit="Create session" busy={busy} />
        </form>
      )}
    </Modal>
  )
}

function AddExtraTrainDialog() {
  const blocks = useSelector(s => s.session?.blocks)
  const options = [...(blocks ?? [])].sort((a, b) => a.number - b.number).map(block => ({ value: block.id, label: `Block ${block.number} ${block.name}` }))
  const [form, setForm] = useState({ number: '', name: '', length: '900', speed: '25', direction: 'east', start: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const start = options.some(option => option.value === form.start) ? form.start : options[0]?.value ?? ''
  const set = (key: keyof typeof form) => (event: { target: { value: string } }): void => setForm(current => ({ ...current, [key]: event.target.value }))

  async function add(event: FormEvent): Promise<void> {
    event.preventDefault()
    const session = store.get().session
    if (session === null) return
    setBusy(true)
    const done = await act({
      pending: COPY.addingTrain,
      run: () => apiWrite<SessionSnapshot>('POST', `${sessionPath()}/trains`, {
        revision: session.session_version,
        number: form.number,
        name: form.name,
        length_mm: Number(form.length),
        speed_mph: Number(form.speed),
        direction: form.direction,
        start_block_id: start,
      }),
      success: answer => COPY.trainAdded(form.number, answer.session_version),
      inline: true,
    })
    if (done.ok) {
      adoptSnapshot(done.value)
      close()
    } else {
      setErrors(done.error.fields)
      setBusy(false)
    }
  }

  return (
    <Modal title="Add extra train" testId="add-extra-train-dialog" onClose={close}>
      <form onSubmit={event => void add(event)}>
        <TextField label="Train number" value={form.number} error={errors.number} onChange={set('number')} />
        <TextField label="Train name" value={form.name} error={errors.name} onChange={set('name')} />
        <TextField label="Length" type="number" min={300} max={2400} step={1} value={form.length} error={errors.length_mm} onChange={set('length')} />
        <TextField label="Speed" type="number" min={5} max={60} step={1} value={form.speed} error={errors.speed_mph} onChange={set('speed')} />
        <SelectField label="Direction" value={form.direction} error={errors.direction} onChange={set('direction')}
          options={[{ value: 'east', label: 'East' }, { value: 'west', label: 'West' }]} />
        <SelectField label="Start block" value={start} error={errors.start_block_id} onChange={set('start')} options={options} />
        <Actions submit="Add train" busy={busy} />
      </form>
    </Modal>
  )
}

function RenameDialog({ target, id, name }: { target: 'block' | 'station'; id: string; name: string }) {
  const [value, setValue] = useState(name)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault()
    const layout = store.get().layout
    if (layout === null) return
    setBusy(true)
    const done = await act({
      pending: COPY.savingName,
      run: () => apiWrite('PATCH', `${layoutPath()}/${target === 'block' ? 'blocks' : 'stations'}/${id}`, { revision: layout.revision, name: value }),
      success: () => COPY.renamed(value.trim()),
      inline: true,
    })
    if (done.ok) {
      await refreshLayout()
      close()
    } else {
      setError(done.error.fields.name ?? done.error.message)
      setBusy(false)
    }
  }

  return (
    <Modal title="Rename" testId="rename-dialog" onClose={close}>
      <form onSubmit={event => void save(event)}>
        <TextField label="New name" value={value} error={error} onChange={event => setValue(event.target.value)} />
        <Actions submit="Save name" busy={busy} />
      </form>
    </Modal>
  )
}

export function DialogHost() {
  const dialog: DialogState | null = useSelector(s => s.dialog)
  if (dialog === null) return null
  switch (dialog.kind) {
    case 'new-workspace': return <NewWorkspaceDialog />
    case 'add-module': return <AddModuleDialog />
    case 'new-session': return <NewSessionDialog />
    case 'add-extra-train': return <AddExtraTrainDialog />
    case 'rename': return <RenameDialog key={dialog.id} target={dialog.target} id={dialog.id} name={dialog.name} />
  }
}
