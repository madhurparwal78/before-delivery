import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiFailure, fieldErrors } from '../api.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { FieldError, FormErrors } from '../ui/FormErrors.tsx'

const IDS = { to: 'rename-entity-name' }

interface RenameDialogProps {
  current: string
  onSubmit: (name: string) => Promise<void>
  onClose: () => void
}

export function RenameDialog({ current, onSubmit, onClose }: RenameDialogProps) {
  const [name, setName] = useState(current)
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.select()
  }, [])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setPending(true)
    setFailure('')
    try {
      await onSubmit(name)
      onClose()
    } catch (error) {
      const fields = fieldErrors(error)
      setErrors(fields)
      if (!Object.keys(fields).length) setFailure(error instanceof ApiFailure ? error.message : 'The entity could not be renamed.')
      setPending(false)
    }
  }

  return (
    <Dialog name="Rename entity" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <FormErrors errors={errors.to ? { to: errors.to } : {}} ids={IDS} />
        {failure ? (
          <p role="alert" className="dialog-failure">
            {failure}
          </p>
        ) : null}
        <div className="field">
          <label htmlFor={IDS.to}>New name</label>
          <input
            id={IDS.to}
            ref={input}
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={errors.to ? true : undefined}
            aria-describedby={errors.to ? `${IDS.to}-error` : undefined}
            autoComplete="off"
          />
          <FieldError id={`${IDS.to}-error`} message={errors.to} />
        </div>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Renaming...' : 'Rename'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
