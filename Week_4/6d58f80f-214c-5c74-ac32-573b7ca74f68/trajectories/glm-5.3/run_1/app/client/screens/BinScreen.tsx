import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { announce } from '../components/Announcements.tsx';
import type { BinItem } from '../lib/types.js';
import { binDaysLeftText, formatSize } from '../lib/format.js';
import { Dialog, DialogActions } from '../components/Dialog.tsx';

export function BinScreen(): preact.JSX.Element {
  const [items, setItems] = useState<BinItem[]>([]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const load = (): void => {
    void api.bin().then(r => setItems(r.items)).catch(() => setItems([]));
  };
  useEffect(() => {
    load();
    const onDay = (): void => load();
    document.addEventListener('lintel:day-change', onDay);
    return () => document.removeEventListener('lintel:day-change', onDay);
  }, []);

  return (
    <div class="table-wrap">
      <table class="data-table" aria-label="Binned files">
        <thead>
          <tr><th>Name</th><th>From</th><th>Binned</th><th>Days left</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.file.id}>
              <td>{item.file.name} <span class="mono" style="color:var(--ink-soft);font-size:11px;">{formatSize(item.file.size)}</span></td>
              <td>{item.fromFolder.name}</td>
              <td class="numeric">{item.binnedDate}</td>
              <td class="numeric">{binDaysLeftText(item.daysLeft, item.retentionDays, item.purgePending)}</td>
              <td class="actions-cell">
                <button type="button" class="rowbtn" aria-label={`Restore ${item.file.name}`} onClick={async () => {
                  try {
                    const res = await api.restoreFile(item.file.id);
                    announce(`Restored ${res.file.name} to ${item.fromFolder.name}`);
                    load();
                  } catch { announce('Something went wrong. Nothing was changed.'); }
                }}>Restore</button>
                <button type="button" class="rowbtn danger" aria-label={`Delete ${item.file.name} forever`} onClick={() => setPendingDelete(item.file.id)}>Delete forever</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && <div class="empty-state">The bin is empty.</div>}
      {pendingDelete && (
        <Dialog title="Delete forever?" onClose={() => setPendingDelete(null)}>
          <p>{items.find(i => i.file.id === pendingDelete)?.file.name} will be removed for good.</p>
          <DialogActions
            danger
            onCancel={() => setPendingDelete(null)}
            primaryLabel="Delete forever"
            onPrimary={async () => {
              try {
                await api.deleteForever(pendingDelete);
                announce(`Deleted ${items.find(i => i.file.id === pendingDelete)?.file.name} forever`);
                setPendingDelete(null);
                load();
              } catch (err) {
                const code = (err as { code?: string }).code;
                const name = items.find(i => i.file.id === pendingDelete)?.file.name ?? 'The file';
                if (code === 'storage_unavailable') announce(`File storage is unreachable. ${name} was not deleted.`);
                else announce('Something went wrong. Nothing was changed.');
                setPendingDelete(null);
              }
            }}
          />
        </Dialog>
      )}
    </div>
  );
}
