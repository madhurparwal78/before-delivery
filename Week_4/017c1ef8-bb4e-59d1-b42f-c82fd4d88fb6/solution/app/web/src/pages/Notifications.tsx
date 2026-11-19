import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useConfig, useNow } from '../clock';
import { relativeTime } from '../format';
import { useLive } from '../live';
import { useNavCounts } from '../navcounts';
import type { NotificationItem } from '../types';
import { EmptyState } from '../ui';
import '../components/feed/feed.css';

export default function Notifications() {
  const config = useConfig();
  const now = useNow();
  const counts = useNavCounts();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const fresh = useRef(new Set<string>());

  /**
   * Reads the list, then marks everything seen: opening the page is what clears the unread count. Marking seen
   * announces `notification` to every open page, this one included, so it is only sent while something is unread.
   */
  const load = useCallback(async (): Promise<void> => {
    const loaded = await api.get<{ items: NotificationItem[] }>('/api/notifications');
    for (const item of loaded.items) if (item.unread) fresh.current.add(item.id);
    setItems(loaded.items);
    if (!loaded.items.some((item) => item.unread)) return;
    await api.post('/api/notifications/seen');
    await counts.refresh();
  }, [counts.refresh]);

  useEffect(() => {
    void load();
  }, [load]);
  useLive(['notification', 'reconnected'], () => void load());

  return (
    <div className="stack">
      <h1 className="page-title">Notifications</h1>
      {items && items.length === 0 ? <EmptyState sentence="No notifications yet." action={{ label: 'Go to Home', to: '/feed' }} /> : null}
      {items && items.length > 0 ? (
        <ul aria-label="Notifications" className="notification-list plain-list step-2">
          {items.map((item) => (
            <li key={item.id} className="notification" data-notification-id={item.id} data-kind={item.kind} data-count={item.count}>
              <p className="notification-text">
                <Link to={item.target_url}>{item.text}</Link>
              </p>
              <p className="muted">
                <time dateTime={item.updated_at}>{relativeTime(item.updated_at, now, config.time_zone)}</time>
                {fresh.current.has(item.id) ? <span className="notification-state"> • New</span> : null}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
