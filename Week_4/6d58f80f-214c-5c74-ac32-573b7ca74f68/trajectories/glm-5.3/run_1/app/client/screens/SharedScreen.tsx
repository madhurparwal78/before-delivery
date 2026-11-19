import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import type { SharedItem } from '../lib/types.js';
import { daysLeftText } from '../lib/format.js';

export function SharedScreen(): preact.JSX.Element {
  const [items, setItems] = useState<SharedItem[]>([]);
  useEffect(() => {
    void api.shared().then(r => setItems(r.items)).catch(() => setItems([]));
    const timer = setInterval(() => { void api.shared().then(r => setItems(r.items)).catch(() => {}); }, 4000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div class="list-wrap">
      <div role="listbox" aria-label="Files" class="filelist">
        {items.map((item, i) => {
          const name = item.file?.name ?? item.folder?.name ?? '';
          const id = item.file?.id ?? item.folder?.id ?? `i${i}`;
          return (
            <div key={id} role="option" aria-selected="false" class="filerow">
              <span class="fname">{name}</span>
              <span class="badge role">{item.role === 'editor' ? 'Editor' : 'Viewer'}</span>
              <span class="fmeta">Ends {item.endDate} · {daysLeftText(item.daysLeft)}</span>
            </div>
          );
        })}
      </div>
      {items.length === 0 && <div class="empty-state">Nothing is shared with you right now.</div>}
    </div>
  );
}
