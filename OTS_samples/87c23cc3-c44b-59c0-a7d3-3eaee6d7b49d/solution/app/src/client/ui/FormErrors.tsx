import { useEffect, useRef } from 'react'

interface FormErrorsProps {
  /** Field name to message, from a 422 answer. */
  errors: Record<string, string>
  /** Field name to the id of its control. */
  ids: Record<string, string>
}

/** The `Check these fields:` alert: every message is a link that moves focus to its field. */
export function FormErrors({ errors, ids }: FormErrorsProps) {
  const entries = Object.entries(errors).filter(([field]) => ids[field])
  const ref = useRef<HTMLDivElement>(null)
  const count = entries.length
  useEffect(() => {
    if (count) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [count])
  if (!count) return null
  return (
    <div role="alert" className="form-errors" ref={ref}>
      <p className="form-errors-title">Check these fields:</p>
      <ul>
        {entries.map(([field, message]) => (
          <li key={field}>
            <a
              href={`#${ids[field]}`}
              onClick={(event) => {
                event.preventDefault()
                document.getElementById(ids[field] as string)?.focus()
              }}
            >
              {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The message under a field; the field points at it as its description. */
export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p id={id} className="field-error">
      {message}
    </p>
  ) : null
}
