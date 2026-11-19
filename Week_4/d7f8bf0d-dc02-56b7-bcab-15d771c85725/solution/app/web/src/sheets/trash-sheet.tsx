import { useState } from 'react'
import { act, closeSheet, layoutPath, refreshLayout } from '../actions'
import { apiGet, apiWrite } from '../api'
import { COPY } from '../copy'
import { canManage, store, useSelector } from '../state'
import { Button, EmptyState, Sheet } from '../ui/primitives'
import { Skeleton } from './skeleton'
import { useLoad } from './use-load'
import type { TrashedModule } from '../../../shared/domain'

export function TrashSheet() {
  const revision = useSelector(s => s.layout?.revision)
  const role = useSelector(s => s.role)
  const { data, reload } = useLoad(() => apiGet<{ modules: TrashedModule[] }>(`${layoutPath()}/trash`), [revision])
  const [busy, setBusy] = useState<string | null>(null)

  async function run(module: TrashedModule, action: 'undo' | 'purge'): Promise<void> {
    setBusy(module.id)
    await act({
      pending: action === 'undo' ? COPY.undoing : COPY.purging,
      run: () => apiWrite('POST', `${layoutPath()}/trash/${module.id}/${action}`, { revision: store.get().layout?.revision ?? 0 }),
      success: () => (action === 'undo' ? COPY.moduleRestored : COPY.purged),
    })
    setBusy(null)
    reload()
    await refreshLayout().catch(() => undefined)
  }

  return (
    <Sheet title="Trash" testId="sheet-trash" onClose={closeSheet}>
      {data === null ? <Skeleton /> : data.modules.length === 0 ? <EmptyState /> : (
        <ul className="rows">
          {data.modules.map(module => (
            <li key={module.id} className="row" data-testid={`trash-row-${module.id}`}>
              <div className="row-main">
                <span className="row-title">{module.name}</span>
                <span className="row-meta">{`Moved to trash by ${module.trashed_by}`}</span>
              </div>
              {canManage(role) ? (
                <div className="row-actions">
                  <Button className="btn-small" disabled={busy !== null} onClick={() => void run(module, 'undo')}>Undo</Button>
                  <Button className="btn-small btn-danger" disabled={busy !== null} onClick={() => void run(module, 'purge')}>Purge</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
