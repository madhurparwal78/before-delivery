import { useApp } from '../app-context.js';
import { api } from '../api.js';
import type { Conversation, PersonCard } from '../types.js';
import { useEffect, useCallback } from 'react';

/**
 * Navigation counters derived from stored rows: conversation unread, notification
 * unread and pending received invitations. Refreshed on live events.
 */
export const useNavigationCounts = (): void => {
  const { signedIn, setUnreadCounts, liveEvents } = useApp();

  const load = useCallback(async (): Promise<void> => {
    if (!signedIn) return;
    try {
      const [convs, notifs, network] = await Promise.all([
        api.get<{ conversations: Conversation[] }>('/api/conversations'),
        api.get<{ unread_count: number }>('/api/notifications'),
        api.get<{ received: PersonCard[] }>('/api/network'),
      ]);
      const messages = convs.conversations.filter((c) => c.unread_count > 0).length;
      setUnreadCounts({
        messages,
        notifications: notifs.unread_count,
        invitations: network.received.length,
      });
    } catch {
      /* signed out mid-flight */
    }
  }, [signedIn, setUnreadCounts]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!signedIn) return;
    return liveEvents.subscribe((event) => {
      if (event === 'connection' || event === 'message' || event === 'notification' || event === 'read') {
        void load();
      }
    });
  }, [signedIn, liveEvents, load]);
};
