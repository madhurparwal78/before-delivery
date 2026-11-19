import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api';
import { EmptyState } from '../ui';
import { relativeTime } from '../../shared/format';
import type { Model } from './model';
import { useModel } from './use-model';

interface Item {
  id: number;
  sentence: string;
  at: string;
}

interface Page {
  items: Item[];
  next_cursor: string | null;
}

export function Activity({ m }: { m: Model }): JSX.Element {
  useModel(m);
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const loaded = useRef(false);
  const busy = useRef(false);

  /** The newest page: new entries go on top and merged entries update in place, so later pages never shift. */
  const refresh = async (): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    const result = await api<Page>('GET', `/api/projects/${m.projectId}/activity`);
    busy.current = false;
    if (!result.ok) return;
    setItems((current) => {
      const fresh = new Map(result.body.items.map((item) => [item.id, item]));
      const kept = current.map((item) => fresh.get(item.id) ?? item);
      const topId = kept[0]?.id ?? 0;
      return [...result.body.items.filter((item) => item.id > topId), ...kept];
    });
    if (!loaded.current) {
      loaded.current = true;
      setCursor(result.body.next_cursor);
    }
  };
  useEffect(() => void refresh(), [m.seq, m.locale.number_format]);

  const more = async (): Promise<void> => {
    if (!cursor) return;
    const result = await api<Page>('GET', `/api/projects/${m.projectId}/activity?cursor=${encodeURIComponent(cursor)}`);
    if (!result.ok) return;
    setItems((current) => [...current, ...result.body.items.filter((item) => !current.some((c) => c.id === item.id))]);
    setCursor(result.body.next_cursor);
  };

  return (
    <section class="panel card-panel" aria-label="Activity">
      <h2 class="panel-title plain">Activity</h2>
      <div class="panel-body">
        {items.length === 0 ? (
          <EmptyState text="No activity yet" variant={1} />
        ) : (
          <ul aria-label="Activity" class="activity-list">
            {items.map((item) => (
              <li key={item.id}>
                <span>{item.sentence}</span>
                <span class="muted small block">{relativeTime(Date.parse(item.at), m.businessNow())}</span>
              </li>
            ))}
          </ul>
        )}
        {cursor && (
          <button type="button" class="pill" onClick={() => void more()}>
            Load more
          </button>
        )}
      </div>
    </section>
  );
}
