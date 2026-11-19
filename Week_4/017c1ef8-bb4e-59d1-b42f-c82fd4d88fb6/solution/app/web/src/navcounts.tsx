import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { useLive } from './live';
import type { ConversationSummary, Network } from './types';

interface NavCounts {
  /** Conversations holding any unread message. */
  unreadConversations: number;
  unreadNotifications: number;
  /** Invitations received and still pending. */
  invitations: number;
  /** Re-reads all three; call it after an action that changes one of them. */
  refresh: () => Promise<void>;
}

const NavCountsContext = createContext<NavCounts | null>(null);

/** Counts for the navigation links, read from the stored rows and re-read when the server says they changed. */
export function NavCountsProvider({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState({ unreadConversations: 0, unreadNotifications: 0, invitations: 0 });

  const refresh = useCallback(async () => {
    const [conversations, notifications, network] = await Promise.all([
      api.get<{ conversations: ConversationSummary[] }>('/api/conversations'),
      api.get<{ unread_count: number }>('/api/notifications'),
      api.get<Network>('/api/network'),
    ]);
    setCounts({
      unreadConversations: conversations.conversations.filter((conversation) => conversation.unread_count > 0).length,
      unreadNotifications: notifications.unread_count,
      invitations: network.received.length,
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useLive(['network', 'graph', 'message', 'read', 'notification', 'reconnected'], () => void refresh());

  return <NavCountsContext.Provider value={{ ...counts, refresh }}>{children}</NavCountsContext.Provider>;
}

/** Only the member layout's pages call it, and the layout provides it. */
export const useNavCounts = (): NavCounts => useContext(NavCountsContext) as NavCounts;
