import { useState, type FormEvent } from 'react'
import { api, fieldErrors } from '../api.ts'
import { useAnnounce } from '../announce.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { FieldError, FormErrors } from '../ui/FormErrors.tsx'
import type { VersionJson } from '../../shared/domain.ts'

const FIELD_IDS = { name: 'save-version-name' }

export function SaveVersionDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { say } = useAnnounce()
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setPending(true)
    say('studio', 'Saving...')
    try {
      const version = await api<VersionJson>('POST', `/api/projects/${projectId}/versions`, { name })
      say('studio', `Version ${version.number} saved.`)
      onClose()
    } catch (error) {
      setErrors(fieldErrors(error))
      say('studio', '')
      setPending(false)
    }
  }

  return (
    <Dialog name="Save version" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <FormErrors errors={errors} ids={FIELD_IDS} />
        <div className="field">
          <label htmlFor={FIELD_IDS.name}>Version name</label>
          <input
            id={FIELD_IDS.name}
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${FIELD_IDS.name}-error` : undefined}
            autoComplete="off"
          />
          <FieldError id={`${FIELD_IDS.name}-error`} message={errors.name} />
        </div>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
