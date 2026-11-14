import { useState, type FormEvent } from 'react'
import { ApiFailure, fieldErrors } from '../api.ts'
import { COLOR_NAMES, type ColorName } from '../../shared/domain.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { FieldError, FormErrors } from '../ui/FormErrors.tsx'

const IDS = { name: 'group-name', color: 'group-color' }
const label = (color: string): string => color.charAt(0).toUpperCase() + color.slice(1)

interface GroupDialogProps {
  names: string[]
  onSubmit: (name: string, color: ColorName) => Promise<void>
  onClose: () => void
}

export function GroupDialog({ names, onSubmit, onClose }: GroupDialogProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<ColorName>('blue')
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState('')

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setPending(true)
    setFailure('')
    try {
      await onSubmit(name, color)
      onClose()
    } catch (error) {
      const fields = fieldErrors(error)
      setErrors(fields)
      if (!Object.keys(fields).length) setFailure(error instanceof ApiFailure ? error.message : 'The group could not be created.')
      setPending(false)
    }
  }

  return (
    <Dialog name="Group entities" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <p className="dialog-note">Selected: {names.join(', ')}</p>
        <FormErrors errors={errors} ids={{ name: IDS.name, entities: IDS.name, color: IDS.color }} />
        {failure ? (
          <p role="alert" className="dialog-failure">
            {failure}
          </p>
        ) : null}
        <div className="field">
          <label htmlFor={IDS.name}>Group name</label>
          <input
            id={IDS.name}
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${IDS.name}-error` : undefined}
            autoComplete="off"
          />
          <FieldError id={`${IDS.name}-error`} message={errors.name} />
          <FieldError id="group-entities-error" message={errors.entities} />
        </div>
        <div className="field">
          <span className="field-label" id={`${IDS.color}-label`}>
            Group colour
          </span>
          <div role="radiogroup" aria-labelledby={`${IDS.color}-label`} className="radio-row group-colors" id={IDS.color} tabIndex={-1}>
            {COLOR_NAMES.map((candidate) => (
              <label key={candidate}>
                <input type="radio" name="group-colour" value={candidate} checked={color === candidate} onChange={() => setColor(candidate)} />
                <span className="swatch" style={{ background: `var(--c-${candidate})` }} aria-hidden="true" />
                {label(candidate)}
              </label>
            ))}
          </div>
          <FieldError id={`${IDS.color}-error`} message={errors.color} />
        </div>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Creating group...' : 'Create group'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
