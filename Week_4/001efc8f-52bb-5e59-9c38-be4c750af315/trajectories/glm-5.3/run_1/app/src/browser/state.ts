import type { ChannelView, MessageView, ScheduledView, UserView, WorkspaceView } from './types';

export interface PendingSend {
  clientId: string;
  text: string;
  threadRootId: string | null;
  quoteId: string | null;
  status: 'pending' | 'failed';
  error?: string;
  photoNames: string[];
}

export interface DetailPanel {
  kind: 'thread' | 'receipts' | 'versions' | 'photos' | 'scheduled' | 'search' | 'members';
  threadRootId?: string;
  messageId?: string;
  query?: string;
  searchTotal?: number;
}

export type LiveState = 'connecting' | 'live' | 'paused';

export class AppState {
  me: UserView | null = null;
  workspace: WorkspaceView | null = null;
  channels: ChannelView[] = [];
  openChannelId: string | null = null;
  messages: MessageView[] = [];
  hasOlder = false;
  olderCursor: string | null = null;
  panel: DetailPanel | null = null;
  pending: PendingSend[] = [];
  live: LiveState = 'connecting';
  quoteId: string | null = null;
  lastEventId = 0;
  serverOffsetMs = 0;
  reducedMotion = false;

  listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  channelById(id: string | null): ChannelView | null {
    if (id === null) return null;
    return this.channels.find((c) => c.id === id) ?? null;
  }
}
