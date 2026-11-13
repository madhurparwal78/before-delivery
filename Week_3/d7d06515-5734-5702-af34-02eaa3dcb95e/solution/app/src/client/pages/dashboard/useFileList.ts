// Loads what the dashboard lists: a folder or the Sample Files pseudo folder through the API's sort and search, or Recent.
import { useCallback, useEffect, useState } from 'react';
import type { FolderItem } from '../../../shared/types.ts';
import { get } from '../../api.ts';
import { navigate } from '../../router.tsx';
import { isUnauthenticated } from '../errors.ts';
import { viewKey, type DashboardView, type FolderRef, type Sort } from './model.ts';

interface Loaded { key: string; items: FolderItem[]; folder: FolderRef | null }

interface FileList {
  /** Null until the first answer for this view. */
  items: FolderItem[] | null;
  folder: FolderRef | null;
  reload: () => void;
}

export function useFileList(view: DashboardView, sort: Sort, query: string): FileList {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  const key = viewKey(view);

  useEffect(() => {
    const controller = new AbortController();
    const path = view.kind === 'recent'
      ? '/api/recent'
      : `/api/folders/${view.kind === 'samples' ? 'samples' : encodeURIComponent(view.folderId)}?${new URLSearchParams({ sort: sort.key, order: sort.order, q: query })}`;
    get<{ items: FolderItem[]; folder?: FolderRef }>(path, { signal: controller.signal }).then(
      (answer) => setLoaded({ key, items: answer.items, folder: answer.folder ?? null }),
      (error: unknown) => { if (isUnauthenticated(error)) navigate('/signin', { replace: true }); },
    );
    return () => controller.abort();
  }, [key, sort.key, sort.order, query, revision]);

  const current = loaded && loaded.key === key ? loaded : null;
  return { items: current?.items ?? null, folder: current?.folder ?? null, reload };
}
