import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import type { FileItem, Folder } from '../../shared/types.js';
import { formatDateTime, formatSize } from '../lib/format.js';

export type ListEntry =
  | { kind: 'folder'; id: string; name: string; folder: Folder }
  | { kind: 'file'; id: string; name: string; file: FileItem };

export type ListShortcut =
  | 'cut'
  | 'paste'
  | 'rename'
  | 'delete'
  | 'escape'
  | 'select-all'
  | 'download';

export interface SelectionChange {
  ids: string[];
  anchor: string | null;
  focus: string;
}

interface FileListProps {
  entries: ListEntry[];
  view: 'list' | 'grid';
  selection: string[];
  focusId: string | null;
  anchor: string | null;
  cut: string[];
  stayed: string[];
  pending: string[];
  locationOf?: (entry: ListEntry) => string | null;
  selectionMode: boolean;
  onSelection: (change: SelectionChange) => void;
  onOpenFolder: (id: string) => void;
  onOpenFile: (id: string) => void;
  onShortcut: (shortcut: ListShortcut) => void;
  onDropOnFolder?: (folderId: string) => void;
  onDragFiles?: (id: string) => void;
  onLongPress?: (id: string) => void;
}

export const FileList = ({
  entries,
  view,
  selection,
  focusId,
  anchor,
  cut,
  stayed,
  pending,
  locationOf,
  selectionMode,
  onSelection,
  onOpenFolder,
  onOpenFile,
  onShortcut,
  onDropOnFolder,
  onDragFiles,
  onLongPress,
}: FileListProps): JSX.Element => {
  const typeahead = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const container = useRef<HTMLDivElement>(null);
  const press = useRef<number | null>(null);
  const touched = useRef(false);

  const current = focusId ?? entries[0]?.id ?? null;

  useEffect(() => {
    if (focusId === null) return;
    const row = container.current?.querySelector<HTMLElement>(`[data-file-row="${focusId}"]`);
    if (row !== null && row !== undefined && document.activeElement !== row) {
      if (container.current?.contains(document.activeElement) === true) row.focus();
    }
  }, [focusId]);

  const indexOf = (id: string | null): number =>
    id === null ? -1 : entries.findIndex((entry) => entry.id === id);

  const rangeBetween = (from: string, to: string): string[] => {
    const a = indexOf(from);
    const b = indexOf(to);
    if (a === -1 || b === -1) return [to];
    const [start, end] = a <= b ? [a, b] : [b, a];
    return entries.slice(start, end + 1).map((entry) => entry.id);
  };

  const moveFocus = (target: number, event: KeyboardEvent): void => {
    const entry = entries[target];
    if (entry === undefined) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      onSelection({ ids: selection, anchor, focus: entry.id });
      return;
    }
    if (event.shiftKey) {
      const base = anchor ?? current ?? entry.id;
      onSelection({ ids: rangeBetween(base, entry.id), anchor: base, focus: entry.id });
      return;
    }
    onSelection({ ids: [entry.id], anchor: entry.id, focus: entry.id });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = indexOf(current);
    const entry = entries[index];
    const combo = event.ctrlKey || event.metaKey;

    if (combo && (event.key === 'x' || event.key === 'X')) {
      event.preventDefault();
      onShortcut('cut');
      return;
    }
    if (combo && (event.key === 'v' || event.key === 'V')) {
      event.preventDefault();
      onShortcut('paste');
      return;
    }
    if (combo && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault();
      onShortcut('select-all');
      return;
    }
    if (event.key === 'F2') {
      event.preventDefault();
      onShortcut('rename');
      return;
    }
    if (event.key === 'Delete') {
      event.preventDefault();
      onShortcut('delete');
      return;
    }
    if (event.key === 'Escape') {
      onShortcut('escape');
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        moveFocus(index + 1, event);
        return;
      case 'ArrowUp':
        moveFocus(index - 1, event);
        return;
      case 'ArrowRight':
        if (view === 'grid') moveFocus(index + 1, event);
        return;
      case 'ArrowLeft':
        if (view === 'grid') moveFocus(index - 1, event);
        return;
      case 'Home':
        moveFocus(0, event);
        return;
      case 'End':
        moveFocus(entries.length - 1, event);
        return;
      case ' ': {
        if (entry === undefined) return;
        event.preventDefault();
        if (combo) {
          const next = selection.includes(entry.id)
            ? selection.filter((id) => id !== entry.id)
            : [...selection, entry.id];
          onSelection({ ids: next, anchor: entry.id, focus: entry.id });
        } else {
          onSelection({ ids: [entry.id], anchor: entry.id, focus: entry.id });
        }
        return;
      }
      case 'Enter':
        if (entry === undefined) return;
        event.preventDefault();
        if (entry.kind === 'folder') onOpenFolder(entry.id);
        else onOpenFile(entry.id);
        return;
      default:
        break;
    }

    if (event.key.length === 1 && !combo && !event.altKey) {
      const now = Date.now();
      const text =
        now - typeahead.current.at < 500 ? typeahead.current.text + event.key : event.key;
      typeahead.current = { text, at: now };
      const lower = text.toLowerCase();
      const start = index + (text.length === 1 ? 1 : 0);
      for (let offset = 0; offset < entries.length; offset += 1) {
        const candidate = entries[(Math.max(start, 0) + offset) % entries.length];
        if (candidate !== undefined && candidate.name.toLowerCase().startsWith(lower)) {
          onSelection({ ids: selection, anchor, focus: candidate.id });
          return;
        }
      }
    }
  };

  const onRowClick = (entry: ListEntry, event: MouseEvent): void => {
    if (touched.current && !selectionMode && !event.ctrlKey && !event.shiftKey) {
      touched.current = false;
      if (entry.kind === 'folder') onOpenFolder(entry.id);
      else onOpenFile(entry.id);
      return;
    }
    touched.current = false;
    if (event.ctrlKey || event.metaKey) {
      const next = selection.includes(entry.id)
        ? selection.filter((id) => id !== entry.id)
        : [...selection, entry.id];
      onSelection({ ids: next, anchor: entry.id, focus: entry.id });
      return;
    }
    if (event.shiftKey) {
      const base = anchor ?? entry.id;
      onSelection({ ids: rangeBetween(base, entry.id), anchor: base, focus: entry.id });
      return;
    }
    if (selectionMode) {
      const next = selection.includes(entry.id)
        ? selection.filter((id) => id !== entry.id)
        : [...selection, entry.id];
      onSelection({ ids: next, anchor: entry.id, focus: entry.id });
      return;
    }
    onSelection({ ids: [entry.id], anchor: entry.id, focus: entry.id });
  };

  return (
    <div className="list-pane" ref={container}>
      <div
        role="listbox"
        aria-label="Files"
        aria-multiselectable="true"
        className={view === 'grid' ? 'grid-view' : ''}
        onKeyDown={onKeyDown}
      >
        {entries.map((entry) => {
          const selected = selection.includes(entry.id);
          const isCut = cut.includes(entry.id);
          const didStay = stayed.includes(entry.id);
          const isPending = pending.includes(entry.id);
          const location = locationOf?.(entry) ?? null;
          return (
            <div
              key={entry.id}
              role="option"
              aria-label={entry.name}
              aria-selected={selected}
              {...(isPending ? { 'aria-busy': true } : {})}
              tabIndex={current === entry.id ? 0 : -1}
              data-file-row={entry.id}
              className="row"
              draggable={entry.kind === 'file'}
              onClick={(event) => onRowClick(entry, event)}
              onDoubleClick={() => {
                if (entry.kind === 'folder') onOpenFolder(entry.id);
                else onOpenFile(entry.id);
              }}
              onDragStart={(event) => {
                if (!selection.includes(entry.id)) {
                  onSelection({ ids: [entry.id], anchor: entry.id, focus: entry.id });
                }
                const dragging = selection.includes(entry.id) ? selection.length : 1;
                const stack = document.createElement('div');
                stack.className = 'drag-stack';
                stack.textContent = dragging === 1 ? entry.name : `${dragging} files`;
                document.body.append(stack);
                event.dataTransfer.setDragImage(stack, 12, 12);
                window.setTimeout(() => stack.remove(), 0);
                onDragFiles?.(entry.id);
              }}
              onDragOver={(event) => {
                if (entry.kind !== 'folder' || onDropOnFolder === undefined) return;
                event.preventDefault();
                event.currentTarget.classList.add('drop-target');
              }}
              onDragLeave={(event) => event.currentTarget.classList.remove('drop-target')}
              onDrop={(event) => {
                if (entry.kind !== 'folder' || onDropOnFolder === undefined) return;
                event.preventDefault();
                event.currentTarget.classList.remove('drop-target');
                onDropOnFolder(entry.id);
              }}
              onPointerDown={(event) => {
                if (event.pointerType !== 'touch') return;
                touched.current = true;
                if (onLongPress === undefined) return;
                press.current = window.setTimeout(() => {
                  touched.current = false;
                  onLongPress(entry.id);
                }, 500);
              }}
              onPointerUp={() => {
                if (press.current !== null) window.clearTimeout(press.current);
                press.current = null;
              }}
              onPointerCancel={() => {
                if (press.current !== null) window.clearTimeout(press.current);
                press.current = null;
              }}
            >
              <span className="select-slot" aria-hidden="true">
                {isPending ? <span className="pending-dot" /> : null}
              </span>
              <span className="name">{entry.name}</span>
              <span className="meta">
                {entry.kind === 'file' ? (
                  <>
                    <span className="num">{formatSize(entry.file.size)}</span>
                    <span className="num">{formatDateTime(entry.file.modifiedAt)}</span>
                  </>
                ) : (
                  <span className="num">{entry.folder.fileCount}</span>
                )}
                {location === null ? null : <span>{location}</span>}
              </span>
              <span className="badges">
                {entry.kind === 'file' && entry.file.locked ? (
                  <span className="badge">Locked</span>
                ) : null}
                {didStay ? <span className="badge stayed">Stayed</span> : null}
                {isCut ? <span className="badge cut">Cut</span> : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
