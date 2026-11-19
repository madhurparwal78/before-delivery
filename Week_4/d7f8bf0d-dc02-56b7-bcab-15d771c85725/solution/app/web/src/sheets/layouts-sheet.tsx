import { useEffect, useState, type FormEvent } from 'react'
import { act, closeSession, closeSheet, loadLayout, refreshWorkspaceLists, workspacePath } from '../actions'
import { apiWrite } from '../api'
import { COPY } from '../copy'
import { canManage, store, useSelector } from '../state'
import { Button, EmptyState, Sheet, TextField } from '../ui/primitives'

function openLayout(id: string): void {
  if (id === store.get().layoutId) return
  if (store.get().sessionId !== null) closeSession()
  store.set({ selection: { pieceId: null, endId: null, trainNumber: null, blockNumber: null }, mode: 'build' })
  void loadLayout(id)
}

export function LayoutsSheet() {
  const layouts = useSelector(s => s.layouts)
  const role = useSelector(s => s.role)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void refreshWorkspaceLists().catch(() => undefined)
  }, [])

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError('')
    const done = await act({
      pending: COPY.creatingLayout,
      run: () => apiWrite('POST', `${workspacePath()}/layouts`, { name }),
      success: () => COPY.layoutCreated,
      inline: true,
    })
    if (done.ok) {
      setName('')
      await refreshWorkspaceLists()
    } else {
      setError(done.error.fields.name ?? '')
    }
  }

  return (
    <Sheet title="Layouts" testId="sheet-layouts" onClose={closeSheet}>
      {layouts.length === 0 ? <EmptyState /> : (
        <ul className="rows">
          {layouts.map(layout => (
            <li key={layout.id} className="row" data-testid={`layout-row-${layout.id}`}>
              <div className="row-main">
                <span className="row-title">{layout.name}</span>
                <span className="row-meta">{`${layout.counts.modules} modules, ${layout.counts.pieces} pieces, ${layout.counts.blocks} blocks, ${layout.counts.trash} in trash`}</span>
              </div>
              <div className="row-actions">
                <Button className="btn-small" onClick={() => openLayout(layout.id)}>Open</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {canManage(role) ? (
        <form className="inline-form" onSubmit={event => void create(event)}>
          <TextField label="Layout name" value={name} onChange={event => setName(event.target.value)} error={error} />
          <Button type="submit">Create layout</Button>
        </form>
      ) : null}
    </Sheet>
  )
}
