import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { bookmarkRemovedNotice, bookmarkedNotice } from '../../shared/copy.js';
import type { Bookmark } from '../../shared/types.js';

let cache: Bookmark[] | null = null;
const listeners = new Set<(bookmarks: Bookmark[]) => void>();

async function loadBookmarks(): Promise<void> {
  try {
    const result = await api<{ bookmarks: Bookmark[] }>('/api/me/bookmarks');
    cache = result.bookmarks;
  } catch {
    cache = [];
  }
  for (const listener of listeners) listener(cache ?? []);
}

export function useBookmarks(signedIn: boolean): Bookmark[] {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(cache ?? []);
  useEffect(() => {
    if (!signedIn) {
      setBookmarks([]);
      return undefined;
    }
    listeners.add(setBookmarks);
    if (cache === null) void loadBookmarks();
    else setBookmarks(cache);
    return () => {
      listeners.delete(setBookmarks);
    };
  }, [signedIn]);
  return bookmarks;
}

export function refreshBookmarks(): void {
  cache = null;
  void loadBookmarks();
}

export function BookmarkButton({
  targetType,
  targetId,
  title,
  label,
}: {
  targetType: 'chapter' | 'event';
  targetId: string;
  title: string;
  label: string;
}): JSX.Element | null {
  const { user, announce } = useStore();
  const bookmarks = useBookmarks(Boolean(user));
  if (!user) return null;
  const existing = bookmarks.find((bookmark) => bookmark.target_id === targetId);

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={Boolean(existing)}
      onClick={() => {
        if (existing) {
          void api(`/api/me/bookmarks/${existing.id}`, { method: 'DELETE' })
            .then(() => {
              announce(bookmarkRemovedNotice);
              refreshBookmarks();
            })
            .catch(() => undefined);
          return;
        }
        void api('/api/me/bookmarks', {
          method: 'POST',
          body: { target_type: targetType, target_id: targetId },
        })
          .then((result) => {
            const created = (result as { bookmark: Bookmark }).bookmark;
            announce(bookmarkedNotice(created.title || title));
            refreshBookmarks();
          })
          .catch(() => undefined);
      }}
    >
      {label}
    </button>
  );
}
