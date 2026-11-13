import { formatMass } from '../../shared/units';
import { useWorkbench } from '../workbench';

const COLUMNS = ['Item', 'Kind', 'Material', 'Qty', 'Unit mass', 'Line mass'] as const;
const mass = (grams: number | null): string => (grams === null ? '—' : formatMass(grams));

/** The bill of materials: six columns above 600 px, stacked blocks with the column name before each value below it. */
export function BomTable() {
  const { assembly } = useWorkbench();
  const bom = assembly?.bom;
  if (!bom) return null;
  return (
    <div className="bom-wrap" tabIndex={0}>
      <div role="table" aria-label="Bill of materials" className="bom">
        <div role="rowgroup" className="bom-head">
          <div role="row">
            {COLUMNS.map((column) => (
              <div key={column} role="columnheader">
                {column}
              </div>
            ))}
          </div>
        </div>
        <div role="rowgroup">
          {bom.lines.map((line) => (
            <div role="row" key={`${line.item.type}:${line.item.id}`}>
              <div role="cell" data-label="Item" className="bom-item">
                {line.item.name}
                {line.body_status === 'not_stored' && <span className="chip not-stored">Not stored</span>}
              </div>
              <div role="cell" data-label="Kind">
                {line.kind === 'made' ? 'Made' : 'Purchased'}
              </div>
              <div role="cell" data-label="Material">
                {line.material ?? '—'}
              </div>
              <div role="cell" data-label="Qty" className="num">
                {line.quantity}
              </div>
              <div role="cell" data-label="Unit mass" className="num">
                {mass(line.unit_mass_g)}
              </div>
              <div role="cell" data-label="Line mass" className="num">
                {mass(line.line_mass_g)}
              </div>
            </div>
          ))}
          <div role="row" className="bom-total">
            <div role="cell" data-label="Item" className="bom-item">
              Total
            </div>
            <div role="cell" data-label="Kind" className="empty" />
            <div role="cell" data-label="Material" className="empty" />
            <div role="cell" data-label="Qty" className="num">
              {bom.part_count}
            </div>
            <div role="cell" data-label="Unit mass" className="empty" />
            <div role="cell" data-label="Line mass" className="num">
              {formatMass(bom.total_mass_g)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
