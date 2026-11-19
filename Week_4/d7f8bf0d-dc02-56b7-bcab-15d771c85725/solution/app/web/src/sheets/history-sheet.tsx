import { closeSheet, layoutPath } from '../actions'
import { apiGet } from '../api'
import { useSelector } from '../state'
import { EmptyState, Sheet } from '../ui/primitives'
import { Skeleton } from './skeleton'
import { useLoad } from './use-load'
import type { HistoryRow } from '../../../shared/domain'

const PHRASES: Record<string, string> = {
  'piece.added': 'Added a piece',
  'piece.changed': 'Changed a piece',
  'piece.removed': 'Removed a piece',
  'module.added': 'Added a module',
  'module.trashed': 'Moved a module to trash',
  'module.restored': 'Restored a module',
  'block.added': 'Added a block',
  'block.renamed': 'Renamed a block',
  'station.renamed': 'Renamed a station',
  'timetable.saved': 'Saved the timetable',
  'version.restored': 'Restored a version',
  purged: 'Purged module',
}

export function HistorySheet() {
  const revision = useSelector(s => s.layout?.revision)
  const { data } = useLoad(() => apiGet<{ history: HistoryRow[] }>(`${layoutPath()}/history`), [revision])
  return (
    <Sheet title="History" testId="sheet-history" onClose={closeSheet}>
      {data === null ? <Skeleton /> : data.history.length === 0 ? <EmptyState /> : (
        <ul className="rows">
          {data.history.map(row => (
            <li key={row.id} className="row">
              <div className="row-main">
                <span className="row-title">{PHRASES[row.action] ?? row.action}</span>
                {row.action.endsWith('.renamed') && row.from !== null && row.to !== null ? <span>{`${row.from} → ${row.to}`}</span> : null}
                <span className="row-meta">{`${row.actor?.display_name ?? 'Someone'}, ${new Date(row.at).toLocaleString()}`}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
