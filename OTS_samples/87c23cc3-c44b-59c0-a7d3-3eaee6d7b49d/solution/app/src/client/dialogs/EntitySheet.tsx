import { CARDINALITY_WORDS } from '../../shared/domain.ts'
import { columnMarkers } from '../../shared/diagram.ts'
import { typeToString, type Entity, type Model } from '../../shared/mortise.ts'
import { Dialog } from '../ui/Dialog.tsx'

interface EntitySheetProps {
  model: Model
  entity: Entity
  canEdit: boolean
  onRename: () => void
  onClose: () => void
}

export function EntitySheet({ model, entity, canEdit, onRename, onClose }: EntitySheetProps) {
  const links = model.links.filter((link) => link.from.entity === entity.name || link.to.entity === entity.name)
  return (
    <Dialog name={`Entity ${entity.name}`} onClose={onClose} sheet className="entity-sheet">
      <h3 className="sheet-heading">Columns</h3>
      <ul className="sheet-list" aria-label={`Columns of ${entity.name}`}>
        {entity.columns.map((column) => (
          <li key={column.name}>
            <span className="sheet-name">{column.name}</span>
            <span className="sheet-type">{typeToString(column.type)}</span>
            <span className="sheet-badges">
              {columnMarkers(model, entity, column).map((marker) => (
                <span className="badge" key={marker}>
                  {marker === 'primary' ? 'Primary key' : marker === 'unique' ? 'Unique' : 'Foreign key'}
                </span>
              ))}
              {column.required && !column.key ? <span className="badge">Required</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <h3 className="sheet-heading">Links</h3>
      <ul className="sheet-list" aria-label={`Links of ${entity.name}`}>
        {links.length ? (
          links.map((link) => (
            <li key={`${link.from.entity}.${link.from.column}-${link.to.entity}.${link.to.column}`}>
              {`${link.from.entity}.${link.from.column} to ${link.to.entity}.${link.to.column}, ${CARDINALITY_WORDS[link.cardinality]}`}
            </li>
          ))
        ) : (
          <li className="sheet-empty">No links.</li>
        )}
      </ul>
      <div className="dialog-actions">
        {canEdit ? (
          <button type="button" className="btn btn-quiet" onClick={onRename}>
            Rename entity
          </button>
        ) : null}
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  )
}
