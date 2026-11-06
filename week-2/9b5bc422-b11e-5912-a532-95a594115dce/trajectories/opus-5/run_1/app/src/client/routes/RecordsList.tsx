import { useStore } from '../hooks.ts';
import { focusWhenReady } from '../focus.ts';
import { navigate } from '../router.ts';
import { tables } from '../store/actions.ts';

export function RecordsList() {
  const state = useStore();
  const all = [...state.workspace.tables.values()].sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
  );

  return (
    <div className="screen">
      <h1 className="display">Records</h1>
      <button
        type="button"
        className="button"
        onClick={() => {
          void tables.create().then((tableId) => {
            navigate(`/records/${tableId}?view=table`);
            focusWhenReady('[aria-label="Table name"]');
          });
        }}
      >
        New table
      </button>
      <ul aria-label="Tables" className="table-list">
        {all.map((table) => (
          <li key={table.id} className="paper table-list-row">
            <a
              href={`/records/${table.id}`}
              onClick={(event) => {
                event.preventDefault();
                navigate(`/records/${table.id}?view=table`);
              }}
            >
              {table.name}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
