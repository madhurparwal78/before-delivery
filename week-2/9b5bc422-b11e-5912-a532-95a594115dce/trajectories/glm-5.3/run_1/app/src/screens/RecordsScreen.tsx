import { useNavigate } from 'react-router-dom';
import { useApp } from '../lib/app';
import { uuid } from '../lib/util';
import * as db from '../lib/store';
import { Plus } from 'lucide-react';

export function RecordsScreen() {
  const tables = useApp((s) => s.tables);
  const markChange = useApp((s) => s.markChange);
  const reload = useApp((s) => s.reload);
  const navigate = useNavigate();

  const newTable = async () => {
    const id = uuid();
    const now = Date.now();
    const name = uniqueName(tables.map((t) => t.name), 'Untitled table');
    await db.putTable({ id, name, createdAt: now, updatedAt: now });
    await markChange('table', id, null, false, { id, name, createdAt: now, updatedAt: now });
    const cols: [string, string, 'text' | 'number'][] = [
      [`${id}-name`, 'Name', 'text'],
      [`${id}-amount`, 'Amount', 'number'],
    ];
    for (let i = 0; i < cols.length; i++) {
      const col = { id: cols[i][0], tableId: id, name: cols[i][1], type: cols[i][2], options: [], order: i };
      await db.putColumn(col);
      await markChange('column', col.id, id, false, col);
    }
    await reload();
    navigate(`/records/${id}`);
  };

  return (
    <div>
      <div className="heading-row">
        <h1>Records</h1>
        <button className="button accent-button" onClick={newTable}>
          <Plus size={18} aria-hidden /> New table
        </button>
      </div>
      {tables.length === 0 ? (
        <div className="empty-state paper">No tables yet.</div>
      ) : (
        <div className="paper">
          {tables.map((t) => (
            <div key={t.id} className="list-row">
              <a
                href={`/records/${t.id}`}
                className="title-link"
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/records/${t.id}`);
                }}
              >
                {t.name}
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function uniqueName(existing: string[], base: string): string {
  const names = new Set(existing);
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}
