import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../app-context.js';
import type { NotificationItem } from '../types.js';

export const NotificationsPage = (): JSX.Element => {
  const { navigate, liveEvents } = useApp();
  const [items, setItems] = useState<NotificationItem[]>([]);

  const load = useCallback(async (): Promise<void> => {
    const result = await api.get<{ items: NotificationItem[]; unread_count: number }>('/api/notifications');
    setItems(result.items);
    await api.post('/api/notifications/seen', {});
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    return liveEvents.subscribe((event) => {
      if (event === 'notification' || event === 'clock') void load();
    });
  }, [liveEvents, load]);

  return (
    <>
      <h1 className="profile-name">Notifications</h1>
      {items.length === 0 && (
        <div className="big-empty">
          <p>No notifications yet.</p>
          <a href="/feed" onClick={(e) => { e.preventDefault(); navigate('/feed'); }}>Go to Home</a>
        </div>
      )}
      <ul aria-label="Notifications">
        {items.map((item) => (
          <li key={item.id} data-notification-id={item.id} data-kind={item.kind} data-count={item.count}>
            <a href={item.target_url} onClick={(e) => { e.preventDefault(); navigate(item.target_url); }}>{item.text}</a>
          </li>
        ))}
      </ul>
    </>
  );
};
