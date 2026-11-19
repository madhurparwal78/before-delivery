import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { DocTopic } from '../../shared/model.ts';
import { Glyph } from './glyphs.tsx';
import type { ArrowKey } from './nav.ts';
import type { MapSession } from './session.ts';
import { useSession } from './useSession.ts';

const ROW = 44;
const WINDOW_FROM = 120;
const OVERSCAN = 20;

const branch = (colour: string): string => (colour.startsWith('#') ? colour : colour === 'accent' ? 'var(--accent)' : `var(--c-${colour})`);

function RowInput(props: { session: MapSession }) {
  const { session } = props;
  const editing = session.editing;
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input || !editing) return;
    input.value = editing.value;
    input.focus({ preventScroll: true });
    if (editing.version === 1 && editing.mode === 'select') input.setSelectionRange(0, input.value.length);
    else input.setSelectionRange(editing.caret, editing.caret);
  }, [editing?.version]);
  if (!editing) return null;
  return (
    <input
      ref={ref}
      class="title-input"
      type="text"
      aria-label="Topic title"
      defaultValue={editing.value}
      onInput={(event) => session.editInput(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          session.commitEdit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          session.cancelEdit();
        } else if (event.key === 'Tab') event.preventDefault();
      }}
    />
  );
}

/** The outline: a second, live, two-way view of the same tree in list order. */
export function Outline(props: { session: MapSession }) {
  const { session } = props;
  useSession(session);
  const treeRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const inside = useRef(false);
  const order = session.layout.order;
  const windowed = order.length > WINDOW_FROM;
  const height = treeRef.current?.clientHeight || 600;
  const first = windowed ? Math.max(0, Math.floor(scroll / ROW) - OVERSCAN) : 0;
  const last = windowed ? Math.min(order.length, Math.ceil((scroll + height) / ROW) + OVERSCAN) : order.length;

  useLayoutEffect(() => {
    const wanted = session.focusWanted;
    if (!wanted || session.focusIn !== 'outline' || !session.display.topics[wanted]) return;
    const row = treeRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(wanted)}"]`);
    if (!row) {
      const at = order.indexOf(wanted);
      if (at !== -1 && treeRef.current) {
        treeRef.current.scrollTop = Math.max(0, at * ROW - height / 2);
        setScroll(treeRef.current.scrollTop);
      }
      return;
    }
    if (document.activeElement !== row) row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'nearest' });
    session.focusWanted = null;
  });

  // Moving a row in the document reorders it in the page, which drops focus: take it back.
  useLayoutEffect(() => {
    if (inside.current && document.activeElement === document.body) {
      treeRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(session.focusId)}"]`)?.focus({ preventScroll: true });
    }
  });

  useLayoutEffect(
    () => () => {
      session.focusIn = 'map';
    },
    [session],
  );

  const onKeyDown = (event: KeyboardEvent): void => {
    if ((event.target as HTMLElement).tagName === 'INPUT') return;
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-row]')?.dataset.row;
    if (!id) return;
    if (id !== session.focusId) session.setFocus(id);
    const key = event.key;
    const ctrl = event.ctrlKey || event.metaKey;
    const done = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (ctrl && key.toLowerCase() === 'z') {
      done();
      if (event.shiftKey) session.redo();
      else session.undo();
    } else if (key === 'Tab') {
      done();
      if (session.guardEdit()) session.move(event.shiftKey ? 'ArrowLeft' : 'ArrowRight', 'list');
    } else if (event.altKey && key.startsWith('Arrow')) {
      done();
      session.move(key as ArrowKey, 'list');
    } else if (!ctrl && !event.altKey && key.startsWith('Arrow')) {
      done();
      session.arrow(key as ArrowKey, 'list');
    } else if (key === 'Enter') {
      done();
      session.addSibling(id);
    } else if (key === 'F2') {
      done();
      session.startRename(id, null);
    } else if (key === 'Delete') {
      done();
      session.deleteSelection();
    } else if (key === ' ') {
      done();
      session.toggleCollapse(id);
    } else if (key === 'Home' || key === 'End') {
      done();
      session.jump(key);
    } else if (key.length === 1 && !ctrl && !event.altKey) {
      done();
      session.startRename(id, key);
    }
  };

  const rows = order.slice(first, last).map((id) => session.display.topics[id]).filter((t): t is DocTopic => t !== undefined);
  return (
    <div
      ref={treeRef}
      role="tree"
      aria-label="Outline"
      class="outline-tree"
      onKeyDown={onKeyDown}
      onScroll={(event) => windowed && setScroll(event.currentTarget.scrollTop)}
      onFocusOut={(event) => {
        if (event.relatedTarget) inside.current = false;
      }}
      onFocusIn={(event) => {
        inside.current = true;
        session.focusIn = 'outline';
        const id = (event.target as HTMLElement).closest<HTMLElement>('[data-row]')?.dataset.row;
        if (id && id !== session.focusId) session.setFocus(id);
      }}
    >
      {windowed ? <div class="outline-spacer" aria-hidden="true" style={{ height: `${first * ROW}px` }} /> : null}
      {rows.map((topic) => {
        const place = session.places.get(topic.id) ?? { level: 1, pos: 1, size: 1 };
        const derived = session.derived.get(topic.id);
        const editing = session.editing?.topicId === topic.id && session.editing.where === 'outline';
        const collapsed = session.collapsed.has(topic.id);
        const hasKids = (derived?.subtopics ?? 0) > 0;
        return (
          <div
            key={topic.id}
            role="treeitem"
            class="outline-row"
            data-row={topic.id}
            aria-level={place.level}
            aria-setsize={place.size}
            aria-posinset={place.pos}
            aria-expanded={hasKids ? !collapsed : undefined}
            aria-selected={session.selection.includes(topic.id) ? 'true' : undefined}
            tabIndex={session.focusId === topic.id ? 0 : -1}
            style={{ paddingInlineStart: `${12 + (place.level - 1) * 18}px`, '--branch': branch(derived?.colour ?? 'accent') }}
            onClick={() => {
              session.focusIn = 'outline';
              session.setFocus(topic.id);
            }}
          >
            <span class="outline-bullet" aria-hidden="true" />
            {editing ? <RowInput session={session} /> : <span class="outline-title">{topic.title}</span>}
            {topic.icon ? <Glyph name={topic.icon} size={14} /> : null}
            {collapsed && hasKids ? <span class="outline-count figure">{derived?.subtopics}</span> : null}
          </div>
        );
      })}
      {windowed ? <div class="outline-spacer" aria-hidden="true" style={{ height: `${(order.length - last) * ROW}px` }} /> : null}
    </div>
  );
}
