import { X } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { matchTemplates, type Template } from '../../shared/templates.ts'
import { Dialog } from '../ui/Dialog.tsx'

interface TemplatesPanelProps {
  canEdit: boolean
  hasText: boolean
  onApply: (template: Template) => void
  onClose: () => void
}

function ReplaceConfirm({ onReplace, onCancel }: { onReplace: () => void; onCancel: () => void }) {
  return (
    <div onKeyDown={(event) => event.stopPropagation()}>
      <Dialog name="Replace the text?" role="alertdialog" onClose={onCancel}>
        <p className="dialog-note">The template text takes the place of what is in the editor now. You can restore an earlier version afterwards.</p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onReplace}>
            Replace text
          </button>
        </div>
      </Dialog>
    </div>
  )
}

export function TemplatesPanel({ canEdit, hasText, onApply, onClose }: TemplatesPanelProps) {
  const [query, setQuery] = useState('')
  const [asking, setAsking] = useState<Template | null>(null)
  const matches = matchTemplates(query)

  const choose = (template: Template): void => {
    if (hasText) setAsking(template)
    else onApply(template)
  }

  const enter = (event: KeyboardEvent<HTMLInputElement>): void => {
    const first = matches[0]
    if (event.key === 'Enter' && first && canEdit) {
      event.preventDefault()
      choose(first)
    }
  }

  return (
    <section aria-label="Starter templates" className="templates-panel dark">
      <h2 className="templates-title">Starter templates</h2>
      <input
        type="search"
        className="templates-search"
        aria-label="Find a template"
        placeholder="Find a template"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={enter}
        autoComplete="off"
      />
      {matches.length === 0 ? <p className="templates-empty">{`No template matches "${query.trim()}".`}</p> : null}
      <ul className="templates-list">
        {matches.map((template) => (
          <li key={template.id}>
            <strong>{template.name}</strong>
            <span>{template.description}</span>
            <button type="button" className="templates-use" disabled={!canEdit} onClick={() => choose(template)}>
              {`Use ${template.name}`}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="templates-close" aria-label="Close templates panel" onClick={onClose}>
        <X size={18} aria-hidden="true" />
      </button>
      {asking ? (
        <ReplaceConfirm
          onCancel={() => setAsking(null)}
          onReplace={() => {
            const chosen = asking
            setAsking(null)
            onApply(chosen)
          }}
        />
      ) : null}
    </section>
  )
}
