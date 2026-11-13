import type { ReactNode } from 'react'

/** A radio or checkbox drawn as a text chip; the native input covers the chip so pointer and keyboard reach it directly. */
export function Choice({ type, name, checked, onChange, children }: { type: 'radio' | 'checkbox'; name?: string; checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className="choice">
      <input type={type} name={name} checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{children}</span>
    </label>
  )
}
