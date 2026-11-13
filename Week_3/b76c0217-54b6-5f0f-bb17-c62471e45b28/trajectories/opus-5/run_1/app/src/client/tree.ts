import { messages } from '../domain/messages';
import { $, $$, announce, api } from './dom';

/** The `Pages` tree: one tab stop with roving focus, keyboard reorder and inline rename. */

interface NavigationDocument {
  versionId: string;
  tabs: { id: string; title: string; groups: { id: string; title: string; pages: string[] }[] }[];
  redirects: { from: string; to: string; kind: string }[];
}

interface PageDocument {
  id: string;
  path: string;
  revision: number;
}

export interface RenameResult {
  row: HTMLElement;
  oldPath: string;
  newPath: string;
  linksRewritten: number;
  redirectAdded: { from: string; to: string } | null;
  navigation: NavigationDocument;
}

export interface TreeOptions {
  onRenamed: (result: RenameResult, done: () => void) => void;
  onNavigation: (navigation: NavigationDocument) => void;
}

export interface Tree {
  applyNavigation: (navigation: NavigationDocument) => void;
  focusRow: (id: string) => void;
  /** Holds off tree refreshes while a splice or inline rename owns the rows. */
  setBusy: (busy: boolean) => void;
}

const level = (row: HTMLElement): number => Number(row.getAttribute('aria-level'));

export function setupTree(options: TreeOptions): Tree {
  const container = document.getElementById('pages-tree');
  if (container === null) {
    return {
      applyNavigation: () => undefined,
      focusRow: () => undefined,
      setBusy: () => undefined,
    };
  }
  let busy = false;
  let pending: NavigationDocument | null = null;

  const rows = (): HTMLElement[] =>
    $$<HTMLElement>('[role="treeitem"]', container).filter((row) => {
      let parent = row.parentElement;
      while (parent !== null && parent !== container) {
        if (parent.getAttribute('role') === 'group' && parent.hidden) return false;
        parent = parent.parentElement;
      }
      return true;
    });

  const focusRow = (row: HTMLElement | null): void => {
    if (row === null) return;
    for (const candidate of $$<HTMLElement>('[role="treeitem"]', container)) {
      candidate.tabIndex = candidate === row ? 0 : -1;
    }
    row.focus();
  };

  const focusRowById = (id: string): void => {
    const row = document.getElementById(id);
    if (row !== null) focusRow(row);
  };

  const childGroup = (row: HTMLElement): HTMLElement | null => {
    const next = row.nextElementSibling;
    return next !== null && next.getAttribute('role') === 'group' ? (next as HTMLElement) : null;
  };

  /** Re-reads the tree from the server, keeping focus and any finished splice state. */
  const refresh = async (focusRowId?: string): Promise<void> => {
    const active = (document.activeElement as HTMLElement | null)?.closest('[role="treeitem"]');
    const splices = new Map<string, string>();
    for (const row of $$<HTMLElement>('[role="treeitem"][data-splice]', container)) {
      splices.set(row.id, row.dataset.splice as string);
    }
    const response = await fetch(window.location.href, { headers: { Accept: 'text/html' } });
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    const fresh = parsed.querySelector('#pages-tree');
    if (fresh === null) return;
    container.innerHTML = fresh.innerHTML;
    for (const [id, phase] of splices) {
      const row = document.getElementById(id);
      if (row !== null) row.dataset.splice = phase;
    }
    const target = focusRowId ?? active?.id;
    if (target !== undefined && target !== '') focusRowById(target);
  };

  const applyNavigation = (navigation: NavigationDocument): void => {
    if (busy) {
      pending = navigation;
      return;
    }
    void refresh().then(() => options.onNavigation(navigation));
  };

  const setBusy = (next: boolean): void => {
    busy = next;
    if (busy || pending === null) return;
    const navigation = pending;
    pending = null;
    applyNavigation(navigation);
  };

  /* ----- reorder ----- */

  const groupRows = (): HTMLElement[] => rows().filter((row) => level(row) === 2);
  const tabRows = (): HTMLElement[] => rows().filter((row) => level(row) === 1);
  const pagesOfGroup = (groupId: string): HTMLElement[] =>
    $$<HTMLElement>('[role="treeitem"][aria-level="3"]', container).filter(
      (row) => row.dataset.groupId === groupId,
    );
  const groupsOfTab = (tabId: string): HTMLElement[] =>
    $$<HTMLElement>('[role="treeitem"][aria-level="2"]', container).filter(
      (row) => row.dataset.tabId === tabId,
    );

  const announceMove = (navigation: NavigationDocument, row: HTMLElement): void => {
    if (level(row) === 3) {
      for (const tab of navigation.tabs) {
        for (const group of tab.groups) {
          const index = group.pages.indexOf(row.dataset.pageId ?? '');
          if (index < 0) continue;
          announce(
            messages.pageMoved(
              row.dataset.title ?? '',
              index + 1,
              group.pages.length,
              group.title,
            ),
          );
          return;
        }
      }
      return;
    }
    for (const tab of navigation.tabs) {
      const index = tab.groups.findIndex((group) => group.id === row.dataset.groupId);
      if (index < 0) continue;
      announce(
        messages.groupMoved(row.dataset.title ?? '', index + 1, tab.groups.length, tab.title),
      );
      return;
    }
  };

  const movePage = async (row: HTMLElement, groupId: string, index: number): Promise<void> => {
    const response = await api<NavigationDocument>(
      'POST',
      `/api/pages/${row.dataset.pageId ?? ''}/move`,
      { groupId, index },
    );
    if (!response.ok) return;
    const rowId = row.id;
    const title = row.dataset.title ?? '';
    await refresh(rowId);
    const fresh = document.getElementById(rowId);
    if (fresh !== null) {
      fresh.dataset.title = title;
      announceMove(response.data, fresh);
    }
    options.onNavigation(response.data);
  };

  const moveGroup = async (row: HTMLElement, tabId: string, index: number): Promise<void> => {
    const response = await api<NavigationDocument>(
      'POST',
      `/api/groups/${row.dataset.groupId ?? ''}/move`,
      { tabId, index },
    );
    if (!response.ok) return;
    const rowId = row.id;
    const title = row.dataset.title ?? '';
    await refresh(rowId);
    const fresh = document.getElementById(rowId);
    if (fresh !== null) {
      fresh.dataset.title = title;
      announceMove(response.data, fresh);
    }
    options.onNavigation(response.data);
  };

  const shiftPage = (row: HTMLElement, direction: -1 | 1): void => {
    const groupId = row.dataset.groupId ?? '';
    const siblings = pagesOfGroup(groupId);
    const index = siblings.indexOf(row);
    if (direction === -1 && index > 0) {
      void movePage(row, groupId, index - 1);
      return;
    }
    if (direction === 1 && index < siblings.length - 1) {
      void movePage(row, groupId, index + 1);
      return;
    }
    const groups = groupRows();
    const groupIndex = groups.findIndex((group) => group.dataset.groupId === groupId);
    const target = groups[groupIndex + direction];
    if (target === undefined) return;
    const targetId = target.dataset.groupId ?? '';
    void movePage(row, targetId, direction === -1 ? pagesOfGroup(targetId).length : 0);
  };

  const shiftGroup = (row: HTMLElement, direction: -1 | 1): void => {
    const tabId = row.dataset.tabId ?? '';
    const siblings = groupsOfTab(tabId);
    const index = siblings.indexOf(row);
    if (direction === -1 && index > 0) {
      void moveGroup(row, tabId, index - 1);
      return;
    }
    if (direction === 1 && index < siblings.length - 1) {
      void moveGroup(row, tabId, index + 1);
      return;
    }
    const tabs = tabRows();
    const tabIndex = tabs.findIndex((tab) => tab.dataset.tabId === tabId);
    const target = tabs[tabIndex + direction];
    if (target === undefined) return;
    const targetId = target.dataset.tabId ?? '';
    void moveGroup(row, targetId, direction === -1 ? groupsOfTab(targetId).length : 0);
  };

  /* ----- rename ----- */

  const startRename = (row: HTMLElement): void => {
    if (row.querySelector('input') !== null) return;
    setBusy(true);
    const path = row.dataset.path ?? '';
    const titleSpan = $<HTMLElement>('.row-title', row);
    const pathSpan = $<HTMLElement>('.row-path', row);
    if (titleSpan !== null) titleSpan.hidden = true;
    if (pathSpan !== null) pathSpan.hidden = true;
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('aria-label', 'Path');
    input.className = 'rename-input mono';
    input.value = `/${path}`;
    const error = document.createElement('p');
    error.className = 'field-error';
    error.id = `rename-error-${row.dataset.pageId ?? ''}`;
    error.hidden = true;
    row.append(input, error);
    input.focus();
    input.select();

    const finish = (): void => {
      input.remove();
      error.remove();
      if (titleSpan !== null) titleSpan.hidden = false;
      if (pathSpan !== null) pathSpan.hidden = false;
      focusRow(row);
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish();
        setBusy(false);
        return;
      }
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        const pageId = row.dataset.pageId ?? '';
        const current = await api<PageDocument>('GET', `/api/pages/${pageId}`);
        if (!current.ok) return;
        const response = await api<{
          page: PageDocument;
          navigation: NavigationDocument;
          linksRewritten: number;
          redirectAdded: { from: string; to: string } | null;
        }>('POST', `/api/pages/${pageId}/rename`, {
          path: input.value,
          revision: current.data.revision,
        });
        if (!response.ok) {
          error.textContent = response.error.message;
          error.hidden = false;
          input.setAttribute('aria-invalid', 'true');
          input.setAttribute('aria-describedby', error.id);
          announce(response.error.message);
          input.focus();
          return;
        }
        const oldPath = `/${row.dataset.path ?? ''}`;
        const newPath = `/${response.data.page.path}`;
        finish();
        row.dataset.path = response.data.page.path;
        options.onRenamed(
          {
            row,
            oldPath,
            newPath,
            linksRewritten: response.data.linksRewritten,
            redirectAdded: response.data.redirectAdded,
            navigation: response.data.navigation,
          },
          () => setBusy(false),
        );
      })();
    });
  };

  const removePage = (row: HTMLElement): void => {
    void api('DELETE', `/api/pages/${row.dataset.pageId ?? ''}`).then(() => void refresh());
  };

  const openActions = (button: HTMLElement, row: HTMLElement): void => {
    $$<HTMLElement>('[role="menu"]', container).forEach((menu) => menu.remove());
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const items: [string, () => void][] = [
      ['Rename', () => startRename(row)],
      ['Remove', () => removePage(row)],
    ];
    const buttons = items.map(([label, run]) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.textContent = label;
      item.tabIndex = -1;
      item.addEventListener('click', () => {
        menu.remove();
        button.setAttribute('aria-expanded', 'false');
        run();
      });
      menu.appendChild(item);
      return item;
    });
    menu.addEventListener('keydown', (event) => {
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = index + (event.key === 'ArrowDown' ? 1 : -1);
        buttons[(next + buttons.length) % buttons.length].focus();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        menu.remove();
        button.setAttribute('aria-expanded', 'false');
        button.focus();
      }
    });
    row.appendChild(menu);
    button.setAttribute('aria-expanded', 'true');
    buttons[0].focus();
  };

  /* ----- keyboard ----- */

  container.addEventListener('keydown', (event) => {
    const row = (event.target as HTMLElement).closest('[role="treeitem"]') as HTMLElement | null;
    if (row === null) return;
    if ((event.target as HTMLElement).tagName === 'INPUT') return;
    const visible = rows();
    const index = visible.indexOf(row);
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const direction = event.key === 'ArrowUp' ? -1 : 1;
      if (level(row) === 3) shiftPage(row, direction);
      else if (level(row) === 2) shiftGroup(row, direction);
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusRow(visible[Math.min(index + 1, visible.length - 1)]);
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusRow(visible[Math.max(index - 1, 0)]);
        return;
      case 'Home':
        event.preventDefault();
        focusRow(visible[0]);
        return;
      case 'End':
        event.preventDefault();
        focusRow(visible[visible.length - 1]);
        return;
      case 'ArrowRight': {
        event.preventDefault();
        const group = childGroup(row);
        if (group === null) return;
        if (row.getAttribute('aria-expanded') === 'false') {
          row.setAttribute('aria-expanded', 'true');
          group.hidden = false;
          return;
        }
        focusRow($<HTMLElement>('[role="treeitem"]', group));
        return;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        const group = childGroup(row);
        if (group !== null && row.getAttribute('aria-expanded') === 'true') {
          row.setAttribute('aria-expanded', 'false');
          group.hidden = true;
          return;
        }
        const parentGroup = row.parentElement?.closest('[role="group"]');
        const parentRow = parentGroup?.previousElementSibling as HTMLElement | null;
        focusRow(parentRow ?? null);
        return;
      }
      case 'Enter':
        if (level(row) !== 3) return;
        event.preventDefault();
        window.location.assign(
          `${window.location.pathname.replace(/\/pages\/.*$/, '/pages')}/${row.dataset.path ?? ''}`,
        );
        return;
      case 'F2':
        if (level(row) !== 3) return;
        event.preventDefault();
        startRename(row);
        return;
      default:
        return;
    }
  });

  container.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const actions = target.closest('.row-actions') as HTMLElement | null;
    const row = target.closest('[role="treeitem"]') as HTMLElement | null;
    if (row === null) return;
    if (actions !== null) {
      event.stopPropagation();
      openActions(actions, row);
      return;
    }
    if (target.closest('[role="menu"]') !== null || target.tagName === 'INPUT') return;
    focusRow(row);
    if (level(row) === 3) {
      window.location.assign(
        `${window.location.pathname.replace(/\/pages\/.*$/, '/pages')}/${row.dataset.path ?? ''}`,
      );
    }
  });

  /* ----- pointer drag ----- */

  let dragRow: HTMLElement | null = null;
  let indicator: HTMLElement | null = null;
  let dropTarget: { parentId: string; index: number } | null = null;

  const clearDrag = (): void => {
    indicator?.remove();
    indicator = null;
    dragRow = null;
    dropTarget = null;
  };

  container.addEventListener('pointerdown', (event) => {
    const row = (event.target as HTMLElement).closest('[role="treeitem"]') as HTMLElement | null;
    if (row === null || level(row) === 1) return;
    if ((event.target as HTMLElement).closest('.row-actions') !== null) return;
    dragRow = row;
  });

  window.addEventListener('pointermove', (event) => {
    if (dragRow === null) return;
    const dragLevel = level(dragRow);
    const candidates = $$<HTMLElement>(`[role="treeitem"][aria-level="${dragLevel}"]`, container);
    const parentOf = (row: HTMLElement): string =>
      (dragLevel === 3 ? row.dataset.groupId : row.dataset.tabId) ?? '';
    let target: { parentId: string; index: number } | null = null;
    let anchor: HTMLElement | null = null;
    let after = false;
    for (const candidate of candidates) {
      const box = candidate.getBoundingClientRect();
      if (event.clientY < box.top || event.clientY > box.bottom) continue;
      const parentId = parentOf(candidate);
      const siblings = candidates.filter((row) => parentOf(row) === parentId);
      const index = siblings.indexOf(candidate);
      after = event.clientY > box.top + box.height / 2;
      target = { parentId, index: after ? index + 1 : index };
      anchor = candidate;
    }
    if (target === null || anchor === null) return;
    if (indicator === null) {
      indicator = document.createElement('div');
      indicator.id = 'drop-indicator';
    }
    anchor.insertAdjacentElement(after ? 'afterend' : 'beforebegin', indicator);
    dropTarget = target;
  });

  window.addEventListener('pointerup', () => {
    if (dragRow === null || dropTarget === null) {
      clearDrag();
      return;
    }
    const row = dragRow;
    const target = dropTarget;
    clearDrag();
    if (level(row) === 3) void movePage(row, target.parentId, target.index);
    else void moveGroup(row, target.parentId, target.index);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dragRow !== null) clearDrag();
  });

  return { applyNavigation, focusRow: focusRowById, setBusy };
}
