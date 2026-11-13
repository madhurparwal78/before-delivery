import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { copy } from '../../shared/copy';
import type { NavigationJson, PageSummary } from '../../shared/types';
import { announce } from '../shared/dom';
import { Icon } from './ui';

export interface SpliceView {
  pageId: string;
  phase: 'strike' | 'set' | 'file' | 'count' | 'done';
  oldPath: string;
  newPath: string;
  strike: number;
  revealed: number;
}

type Slot = { groupId: string; index: number };
type GroupSlot = { tabId: string; index: number };

interface Row {
  id: string;
  kind: 'tab' | 'group' | 'page';
  level: number;
  posinset: number;
  setsize: number;
  parent: string | null;
  title: string;
  /** For a page: its group and its place in it. For a group: its tab and its place in it. */
  containerId: string;
  index: number;
  expandable: boolean;
  empty: boolean;
}

const rowDomId = (row: Pick<Row, 'id' | 'kind'>): string => (row.kind === 'tab' ? `row-tab-${row.id}` : row.kind === 'group' ? `row-grp-${row.id}` : `row-${row.id}`);

function buildRows(nav: NavigationJson, pages: Record<string, PageSummary>, collapsed: Set<string>): Row[] {
  const rows: Row[] = [];
  nav.tabs.forEach((tab, tabIndex) => {
    rows.push({ id: tab.id, kind: 'tab', level: 1, posinset: tabIndex + 1, setsize: nav.tabs.length, parent: null, title: tab.title, containerId: '', index: tabIndex, expandable: true, empty: false });
    if (collapsed.has(tab.id)) {
      return;
    }
    tab.groups.forEach((group, groupIndex) => {
      rows.push({ id: group.id, kind: 'group', level: 2, posinset: groupIndex + 1, setsize: tab.groups.length, parent: tab.id, title: group.title, containerId: tab.id, index: groupIndex, expandable: true, empty: group.pages.length === 0 });
      if (collapsed.has(group.id)) {
        return;
      }
      group.pages.forEach((pageId, pageIndex) => {
        rows.push({ id: pageId, kind: 'page', level: 3, posinset: pageIndex + 1, setsize: group.pages.length, parent: group.id, title: pages[pageId]?.title ?? '', containerId: group.id, index: pageIndex, expandable: false, empty: false });
      });
    });
  });
  return rows;
}

interface TreeProps {
  nav: NavigationJson;
  pages: Record<string, PageSummary>;
  selectedId: string | null;
  canEdit: boolean;
  splice: SpliceView | null;
  onOpen: (pageId: string) => void;
  onMovePage: (pageId: string, slot: Slot, message: string) => Promise<boolean>;
  onMoveGroup: (groupId: string, slot: GroupSlot, message: string) => Promise<boolean>;
  onRename: (pageId: string, path: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  onRemove: (pageId: string) => void;
}

export function Tree(props: TreeProps) {
  const { nav, pages, canEdit } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = buildRows(nav, pages, collapsed);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string; error: string | null } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<number | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef<string | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef(props);
  latest.current = props;

  const rovingId = rows.some((row) => rowDomId(row) === focusId) ? focusId : rows[0] ? rowDomId(rows[0]) : null;

  useLayoutEffect(() => {
    if (focusNext.current !== null) {
      document.getElementById(focusNext.current)?.focus();
      focusNext.current = null;
    }
  });

  // ---- moves -------------------------------------------------------------------------------------------
  const groupsInOrder = nav.tabs.flatMap((tab) => tab.groups.map((group) => ({ ...group, tabId: tab.id })));
  const titleOf = (id: string): string => pages[id]?.title ?? '';

  const movePage = async (pageId: string, slot: Slot): Promise<void> => {
    const target = groupsInOrder.find((group) => group.id === slot.groupId);
    const origin = groupsInOrder.find((group) => group.pages.includes(pageId));
    if (target === undefined || origin === undefined) {
      return;
    }
    const size = origin.id === target.id ? target.pages.length : target.pages.length + 1;
    await props.onMovePage(pageId, slot, copy.pageMoved(titleOf(pageId), slot.index + 1, size, target.title));
    document.getElementById(`row-${pageId}`)?.focus();
  };

  const moveGroup = async (groupId: string, slot: GroupSlot): Promise<void> => {
    const tab = nav.tabs.find((candidate) => candidate.id === slot.tabId);
    const origin = nav.tabs.find((candidate) => candidate.groups.some((group) => group.id === groupId));
    const title = origin?.groups.find((group) => group.id === groupId)?.title ?? '';
    if (tab === undefined || origin === undefined) {
      return;
    }
    const size = origin.id === tab.id ? tab.groups.length : tab.groups.length + 1;
    await props.onMoveGroup(groupId, slot, copy.groupMoved(title, slot.index + 1, size, tab.title));
    document.getElementById(`row-grp-${groupId}`)?.focus();
  };

  /** Alt+Arrow: one place within the group, or across into the neighbouring group; nothing at the ends. */
  const nudge = (row: Row, direction: -1 | 1): void => {
    if (row.kind === 'page') {
      const at = groupsInOrder.findIndex((group) => group.id === row.containerId);
      const group = groupsInOrder[at];
      if (group === undefined) {
        return;
      }
      const inside = row.index + direction;
      if (inside >= 0 && inside < group.pages.length) {
        void movePage(row.id, { groupId: group.id, index: inside });
        return;
      }
      const neighbour = groupsInOrder[at + direction];
      if (neighbour !== undefined) {
        void movePage(row.id, { groupId: neighbour.id, index: direction === -1 ? neighbour.pages.length : 0 });
      }
    } else if (row.kind === 'group') {
      const at = nav.tabs.findIndex((tab) => tab.id === row.containerId);
      const tab = nav.tabs[at];
      if (tab === undefined) {
        return;
      }
      const inside = row.index + direction;
      if (inside >= 0 && inside < tab.groups.length) {
        void moveGroup(row.id, { tabId: tab.id, index: inside });
        return;
      }
      const neighbour = nav.tabs[at + direction];
      if (neighbour !== undefined) {
        void moveGroup(row.id, { tabId: neighbour.id, index: direction === -1 ? neighbour.groups.length : 0 });
      }
    }
  };

  // ---- keyboard ----------------------------------------------------------------------------------------
  const focusRow = (row: Row | undefined): void => {
    if (row !== undefined) {
      document.getElementById(rowDomId(row))?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const element = event.target as HTMLElement;
    if (element.getAttribute('role') !== 'treeitem') {
      return;
    }
    const at = rows.findIndex((candidate) => rowDomId(candidate) === element.id);
    const row = rows[at];
    if (row === undefined) {
      return;
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      if (canEdit) {
        nudge(row, event.key === 'ArrowUp' ? -1 : 1);
      }
      return;
    }
    const isCollapsed = collapsed.has(row.id);
    const toggle = (open: boolean): void => {
      setCollapsed((previous) => {
        const next = new Set(previous);
        if (open) {
          next.delete(row.id);
        } else {
          next.add(row.id);
        }
        return next;
      });
    };
    const handlers: Record<string, () => void> = {
      ArrowDown: () => focusRow(rows[at + 1]),
      ArrowUp: () => focusRow(rows[at - 1]),
      Home: () => focusRow(rows[0]),
      End: () => focusRow(rows[rows.length - 1]),
      ArrowRight: () => {
        if (row.expandable && isCollapsed) {
          toggle(true);
        } else if (rows[at + 1] && rows[at + 1]!.level > row.level) {
          focusRow(rows[at + 1]);
        }
      },
      ArrowLeft: () => {
        if (row.expandable && !isCollapsed) {
          toggle(false);
        } else {
          focusRow([...rows.slice(0, at)].reverse().find((candidate) => candidate.level < row.level));
        }
      },
      Enter: () => (row.kind === 'page' ? props.onOpen(row.id) : toggle(isCollapsed)),
      F2: () => {
        if (row.kind === 'page' && canEdit) {
          startRename(row.id);
        }
      },
      Delete: () => {
        if (row.kind === 'page' && canEdit) {
          props.onRemove(row.id);
        }
      },
      ContextMenu: () => row.kind === 'page' && canEdit && setMenuFor(row.id),
    };
    const run = event.shiftKey && event.key === 'F10' ? handlers.ContextMenu : handlers[event.key];
    if (run !== undefined) {
      event.preventDefault();
      run();
    }
  };

  // ---- rename ------------------------------------------------------------------------------------------
  const startRename = (id: string): void => {
    setMenuFor(null);
    setRenaming({ id, value: `/${pages[id]?.path ?? ''}`, error: null });
  };

  const input = useRef<HTMLInputElement>(null);
  const renamingId = renaming?.id;
  useLayoutEffect(() => {
    if (renamingId !== undefined) {
      input.current?.focus();
      input.current?.select();
    }
  }, [renamingId]);

  const submitRename = async (): Promise<void> => {
    if (renaming === null) {
      return;
    }
    const wanted = renaming.value.trim();
    if (wanted.replace(/^\/+/, '') === (pages[renaming.id]?.path ?? '')) {
      cancelRename();
      return;
    }
    const outcome = await props.onRename(renaming.id, wanted.replace(/^\/+/, ''));
    if (outcome.ok) {
      focusNext.current = `row-${renaming.id}`;
      setRenaming(null);
    } else {
      setRenaming({ ...renaming, error: outcome.message });
      announce(outcome.message);
      input.current?.focus();
    }
  };

  const cancelRename = (): void => {
    if (renaming !== null) {
      focusNext.current = `row-${renaming.id}`;
    }
    setRenaming(null);
  };

  // ---- drag --------------------------------------------------------------------------------------------
  const startDrag = (event: PointerEvent, row: Row): void => {
    if (!canEdit || event.button !== 0 || row.kind === 'tab' || (event.target as HTMLElement).closest('button, input')) {
      return;
    }
    const origin = { x: event.clientX, y: event.clientY };
    let active = false;
    let cancelled = false;
    let drop: { slot: Slot | GroupSlot; y: number } | null = null;

    const locate = (clientY: number): void => {
      const tree = treeRef.current as HTMLDivElement;
      const treeTop = tree.getBoundingClientRect().top;
      const geometry = rows.map((candidate) => ({ row: candidate, rect: (document.getElementById(rowDomId(candidate)) as HTMLElement).getBoundingClientRect() }));
      const first = geometry[0];
      const last = geometry[geometry.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      const hit = geometry.find((g) => clientY >= g.rect.top && clientY < g.rect.bottom) ?? (clientY < first.rect.top ? first : last);
      const above = clientY < hit.rect.top + hit.rect.height / 2;
      if (row.kind === 'page') {
        let slot: Slot | null = null;
        let y = hit.rect.bottom;
        if (hit.row.kind === 'page') {
          slot = { groupId: hit.row.containerId, index: hit.row.index + (above ? 0 : 1) };
          y = above ? hit.rect.top : hit.rect.bottom;
        } else if (hit.row.kind === 'group') {
          slot = { groupId: hit.row.id, index: 0 };
        } else {
          const firstGroup = nav.tabs.find((tab) => tab.id === hit.row.id)?.groups[0];
          slot = firstGroup ? { groupId: firstGroup.id, index: 0 } : null;
        }
        const home = groupsInOrder.find((group) => group.pages.includes(row.id));
        if (slot !== null && home?.id === slot.groupId && row.index < slot.index) {
          slot = { ...slot, index: slot.index - 1 };
        }
        drop = slot ? { slot, y: y - treeTop } : null;
      } else {
        let slot: GroupSlot | null = null;
        let y = hit.rect.bottom;
        const owner = hit.row.kind === 'group' ? hit.row : rows.find((candidate) => candidate.id === hit.row.parent);
        if (hit.row.kind === 'tab') {
          slot = { tabId: hit.row.id, index: 0 };
        } else if (owner?.kind === 'group') {
          const before = hit.row.kind === 'group' && above;
          slot = { tabId: owner.containerId, index: owner.index + (before ? 0 : 1) };
          y = before ? hit.rect.top : (geometry.filter((g) => g.row.id === owner.id || g.row.parent === owner.id).pop()?.rect.bottom ?? hit.rect.bottom);
          const home = nav.tabs.find((tab) => tab.groups.some((group) => group.id === row.id));
          if (home?.id === slot.tabId && row.index < slot.index) {
            slot = { ...slot, index: slot.index - 1 };
          }
        }
        drop = slot ? { slot, y: y - treeTop } : null;
      }
      setIndicator(drop ? drop.y : null);
    };

    const move = (e: PointerEvent): void => {
      if (cancelled) {
        return;
      }
      if (!active && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 5) {
        active = true;
      }
      if (active) {
        locate(e.clientY);
      }
    };
    const stop = (): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', stop);
      document.removeEventListener('keydown', key, true);
      setIndicator(null);
    };
    const up = (): void => {
      stop();
      if (active) {
        suppressClick.current = true;
        window.setTimeout(() => (suppressClick.current = false), 0);
      }
      if (active && !cancelled && drop !== null) {
        if (row.kind === 'page') {
          void movePage(row.id, drop.slot as Slot);
        } else {
          void moveGroup(row.id, drop.slot as GroupSlot);
        }
      }
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && active) {
        e.preventDefault();
        e.stopPropagation();
        cancelled = true;
        suppressClick.current = true;
        setIndicator(null);
      }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', stop);
    document.addEventListener('keydown', key, true);
  };

  // ---- actions menu ------------------------------------------------------------------------------------
  useLayoutEffect(() => {
    if (menuFor === null) {
      return undefined;
    }
    const close = (event: Event): void => {
      if (!(event.target as HTMLElement).closest('.row-actions')) {
        setMenuFor(null);
      }
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuFor]);

  const menuRef = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menuFor]);

  const menuKeys = (event: KeyboardEvent, id: string): void => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setMenuFor(null);
      document.getElementById(`row-${id}`)?.focus();
    }
  };

  // ---- render ------------------------------------------------------------------------------------------
  const pathLine = (row: Row) => {
    const splice = props.splice;
    const path = pages[row.id]?.path ?? '';
    if (splice !== null && splice.pageId === row.id && splice.phase !== 'done') {
      const chars = splice.newPath.split('');
      return (
        <>
          <span class="row-path mono">
            <span>/{splice.oldPath}</span>
            <span class="strike" style={`transform: scaleX(${splice.strike})`} />
          </span>
          {splice.phase !== 'strike' && (
            <span class="row-path mono" aria-hidden="true">
              /
              {chars.map((char, at) => (
                <span key={at} class={at < splice.revealed ? '' : 'hidden-char'}>
                  {char}
                </span>
              ))}
            </span>
          )}
        </>
      );
    }
    return <span class="row-path mono">/{path}</span>;
  };

  return (
    <div
      class="tree"
      role="tree"
      aria-label="Pages"
      ref={treeRef}
      onKeyDown={onKeyDown}
    >
      {rows.map((row) => {
        const domId = rowDomId(row);
        const splicing = props.splice?.pageId === row.id ? props.splice.phase : undefined;
        const editing = renaming?.id === row.id;
        return (
          <div
            key={domId}
            id={domId}
            role="treeitem"
            class={`tree-row ${row.kind}-row`}
            style={`--level:${row.level}`}
            aria-level={row.level}
            aria-posinset={row.posinset}
            aria-setsize={row.setsize}
            aria-expanded={row.expandable ? !collapsed.has(row.id) : undefined}
            aria-selected={row.kind === 'page' && row.id === props.selectedId ? true : undefined}
            aria-current={row.kind === 'page' && row.id === props.selectedId ? 'page' : undefined}
            data-splice={splicing}
            tabIndex={domId === rovingId ? 0 : -1}
            onFocus={(event) => event.target === event.currentTarget && setFocusId(domId)}
            onPointerDown={(event) => startDrag(event, row)}
            onClick={(event) => {
              if (suppressClick.current || (event.target as HTMLElement).closest('.row-actions, input')) {
                return;
              }
              if (row.kind === 'page') {
                props.onOpen(row.id);
              } else {
                setCollapsed((previous) => {
                  const next = new Set(previous);
                  if (!next.delete(row.id)) {
                    next.add(row.id);
                  }
                  return next;
                });
              }
            }}
          >
            <div class="row-label">
              <span class="row-title">{row.title}</span>
              {row.kind === 'page' && !editing && pathLine(row)}
              {row.kind === 'group' && row.empty && <span class="row-path">Nothing filed here yet.</span>}
              {editing && renaming && (
                <>
                  <input
                    ref={input}
                    class="path-input"
                    type="text"
                    aria-label="Path"
                    value={renaming.value}
                    spellcheck={false}
                    aria-invalid={renaming.error ? 'true' : undefined}
                    aria-describedby={renaming.error ? `${domId}-error` : undefined}
                    onInput={(event) => setRenaming({ ...renaming, value: event.currentTarget.value, error: null })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void submitRename();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        cancelRename();
                      }
                    }}
                  />
                  {renaming.error && (
                    <p class="row-error" id={`${domId}-error`}>
                      {renaming.error}
                    </p>
                  )}
                </>
              )}
            </div>
            {row.kind === 'page' && canEdit && (
              <div class="row-actions">
                <button type="button" tabIndex={-1} aria-label={`Actions for ${row.title}`} aria-haspopup="menu" aria-expanded={menuFor === row.id} onClick={() => setMenuFor(menuFor === row.id ? null : row.id)}>
                  <Icon name="ellipsis" />
                </button>
                {menuFor === row.id && (
                  <ul class="row-menu" role="menu" aria-label={`Actions for ${row.title}`} ref={menuRef} onKeyDown={(event) => menuKeys(event, row.id)}>
                    <li role="none">
                      <button type="button" role="menuitem" onClick={() => startRename(row.id)}>
                        Rename
                      </button>
                    </li>
                    <li role="none">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuFor(null);
                          props.onRemove(row.id);
                        }}
                      >
                        Remove
                      </button>
                    </li>
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}
      {indicator !== null && <div id="drop-indicator" style={`top:${indicator}px`} />}
    </div>
  );
}
