import { useEffect, useRef, useState } from 'react';
import { emptyCopy } from '../../shared/copy.js';
import type { LockRow } from '../../shared/api.js';
import type { SceneDocument } from '../../shared/scene.js';

const GLYPHS: Record<string, string> = {
  ramp: '/',
  pendulum: 'o',
  launcher: '^',
  crate: '#',
  model: '*',
};

export interface OutlineProps {
  document: SceneDocument;
  selectedId: string | null;
  locks: readonly LockRow[];
  hiddenIds: ReadonlySet<string>;
  canEdit: boolean;
  myUserId: string;
  onSelect: (objectId: string) => void;
  onRename: (objectId: string, name: string) => void;
  onToggleHidden: (objectId: string) => void;
  onAdd: () => void;
  renameRequest: string | null;
  onRenameHandled: () => void;
}

export function Outline(props: OutlineProps): JSX.Element {
  const [filter, setFilter] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const field = useRef<HTMLInputElement | null>(null);
  const rows = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (props.renameRequest === null) return;
    const object = props.document.objects.find(
      (candidate) => candidate.id === props.renameRequest,
    );
    if (object) {
      setRenaming(object.id);
      setDraft(object.name);
    }
    props.onRenameHandled();
  }, [props.renameRequest]);

  useEffect(() => {
    if (renaming && field.current) {
      field.current.focus();
      field.current.select();
    }
  }, [renaming]);

  const objects = props.document.objects.filter((object) =>
    object.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  const focusIndex = Math.max(
    0,
    objects.findIndex((object) => object.id === props.selectedId),
  );

  const commitRename = (objectId: string): void => {
    const name = draft.trim();
    setRenaming(null);
    if (name !== '') props.onRename(objectId, name);
    const row = rows.current?.querySelector<HTMLElement>(`[data-row="${objectId}"]`);
    row?.focus();
  };

  return (
    <>
      <div className="sub-toolbar">
        <span className="muted num">{props.document.objects.length} objects</span>
        {props.canEdit ? (
          <button type="button" className="chip" onClick={props.onAdd}>
            Add
          </button>
        ) : null}
        <input
          type="search"
          aria-label="Find objects"
          placeholder="Find objects"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          style={{ flex: 1, minWidth: 90 }}
        />
      </div>
      {props.document.objects.length === 0 ? <p className="empty">{emptyCopy.outline}</p> : null}
      <ul className="tree" role="tree" aria-label="Scene outline" ref={rows}>
        {objects.map((object, index) => {
          const lock = props.locks.find((entry) => entry.objectId === object.id);
          const hidden = props.hiddenIds.has(object.id);
          return (
            <li
              key={object.id}
              role="treeitem"
              aria-selected={props.selectedId === object.id}
              aria-label={object.name}
              data-row={object.id}
              tabIndex={index === focusIndex ? 0 : -1}
              className={hidden ? 'hidden-object' : undefined}
              onClick={() => props.onSelect(object.id)}
              onDoubleClick={() => {
                if (!props.canEdit) return;
                setRenaming(object.id);
                setDraft(object.name);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && renaming !== object.id) {
                  event.preventDefault();
                  props.onSelect(object.id);
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const all = [...(rows.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])];
                  const index = all.findIndex((row) => row === event.currentTarget);
                  const next = all[index + (event.key === 'ArrowDown' ? 1 : -1)];
                  next?.focus();
                }
              }}
            >
              <span className="glyph" aria-hidden="true">
                {GLYPHS[object.kind]}
              </span>
              {renaming === object.id ? (
                <input
                  ref={field}
                  className="name"
                  aria-label={`Rename ${object.name}`}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitRename(object.id);
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      setRenaming(null);
                      rows.current
                        ?.querySelector<HTMLElement>(`[data-row="${object.id}"]`)
                        ?.focus();
                    }
                  }}
                />
              ) : (
                <span className="name">{object.name}</span>
              )}
              {lock && lock.holder.userId !== props.myUserId ? (
                <span className="holder-initial" title={lock.holder.displayName}>
                  {lock.holder.displayName.slice(0, 1)}
                </span>
              ) : null}
              <button
                type="button"
                className="ghost"
                aria-label={hidden ? `Show ${object.name}` : `Hide ${object.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onToggleHidden(object.id);
                }}
              >
                {hidden ? '-' : 'o'}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
