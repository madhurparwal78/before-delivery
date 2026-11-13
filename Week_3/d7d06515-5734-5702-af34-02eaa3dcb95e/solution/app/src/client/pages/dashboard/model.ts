// What the dashboard shows and how it is sorted (brief: Interactions > Dashboard).
import type { FolderItem } from '../../../shared/types.ts';

export type DashboardView =
  | { kind: 'folder'; folderId: string }
  | { kind: 'recent' }
  | { kind: 'samples' };

export type SortKey = 'type' | 'name' | 'modified' | 'size' | 'owner' | 'shared';
export type SortOrder = 'asc' | 'desc';
export interface Sort { key: SortKey; order: SortOrder }

export interface Column {
  key: SortKey;
  label: string;
  /** Direction of the first press: newest first for Date Modified, A to Z otherwise. */
  firstOrder: SortOrder;
}

export const COLUMNS: readonly Column[] = [
  { key: 'type', label: 'File Type', firstOrder: 'asc' },
  { key: 'name', label: 'Name', firstOrder: 'asc' },
  { key: 'modified', label: 'Date Modified', firstOrder: 'desc' },
  { key: 'size', label: 'Size', firstOrder: 'asc' },
  { key: 'owner', label: 'Owner', firstOrder: 'asc' },
  { key: 'shared', label: 'Shared', firstOrder: 'asc' },
];

export const DEFAULT_SORT: Sort = { key: 'modified', order: 'desc' };

export function nextSort(current: Sort, column: Column): Sort {
  if (current.key !== column.key) return { key: column.key, order: column.firstOrder };
  return { key: column.key, order: current.order === 'asc' ? 'desc' : 'asc' };
}

export function viewOf(search: URLSearchParams): DashboardView {
  const view = search.get('view');
  if (view === 'recent') return { kind: 'recent' };
  if (view === 'samples') return { kind: 'samples' };
  return { kind: 'folder', folderId: search.get('folder') ?? 'root' };
}

export const viewKey = (view: DashboardView): string => (view.kind === 'folder' ? `folder:${view.folderId}` : view.kind);

export const itemHref = (item: FolderItem): string => (item.kind === 'folder' ? `/drawings?folder=${encodeURIComponent(item.id)}` : `/d/${encodeURIComponent(item.id)}`);

/** Sample files belong to Corbel Works: they open read-only and have no row actions. */
export const isSample = (item: FolderItem): boolean => item.owner === 'Corbel Works';

export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

export interface FolderRef { id: string; name: string; parent_id: string | null }
