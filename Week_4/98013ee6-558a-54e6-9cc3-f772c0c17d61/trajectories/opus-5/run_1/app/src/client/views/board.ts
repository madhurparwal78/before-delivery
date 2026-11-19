import type { Board, MembersResponse, Pin } from '../../shared/types.js';
import { copy } from '../../shared/copy.js';
import {
  ApiFailure,
  announce,
  api,
  busy,
  clear,
  el,
  failureMessage,
  navigate,
  showAlert,
  state,
  toast,
} from '../core.js';
import { PinGrid, type GridContainer } from '../grid.js';
import {
  openAddSectionDialog,
  openBulkDialog,
  openCollaboratorsDialog,
  openEditBoardDialog,
  openInviteDialog,
  openSaveDialog,
  showBulkToast,
} from '../dialogs.js';
import { openPinFromGrid } from '../exhibit.js';
import { onLive, unwatch, watch } from '../live.js';
import type { RouteContext, View } from '../view.js';
import { notFoundView } from './auth.js';

interface SectionShell {
  region: HTMLElement;
  heading: HTMLElement;
  grid: PinGrid;
}

export function boardView(context: RouteContext): View {
  const { main, params } = context;
  const boardId = Number(params.id);
  main.className = 'page board-page';
  clear(main);

  const header = el('div', { class: 'board-header' });
  const viewersHolder = el('div', { class: 'viewers' });
  const toolbarHolder = el('div', { class: 'toolbar-holder' });
  const unsectionedHolder = el('div', { class: 'grid-holder' });
  const sectionsHolder = el('div', { class: 'sections' });
  main.append(header, viewersHolder, toolbarHolder, unsectionedHolder, sectionsHolder);

  let board: Board | null = null;
  let members: MembersResponse | null = null;
  let viewerNames: string[] = [];
  let sectionOrderKey = '';
  let pendingSectionFocus: number | null = null;
  const sections = new Map<number, SectionShell>();
  const selections = new Map<number | null, number[]>();

  const canEdit = (): boolean => board?.role === 'owner' || board?.role === 'editor';

  const moveRequest = async (
    pin: Pin,
    container: GridContainer,
    position: number,
  ): Promise<void> => {
    if (!board) return;
    try {
      await api.post(`/api/boards/${boardId}/moves`, {
        kind: 'pin',
        id: pin.id,
        section: container.sectionId,
        position,
        base_seq: board.seq,
      });
      const refreshed = await reload();
      const list =
        container.sectionId === null
          ? refreshed.order.unsectioned
          : refreshed.order.sections.find((section) => section.id === container.sectionId)?.pins ??
            [];
      announce(copy.movedPin(pin.title, list.indexOf(pin.id) + 1, list.length));
    } catch (error) {
      showAlert(failureMessage(error));
    }
  };

  const makeGrid = (label: string, sectionId: number | null): PinGrid =>
    new PinGrid({
      label,
      selectable: canEdit(),
      reorderable: canEdit(),
      container: { boardId, sectionId },
      onOpen: (pin, card) => openPinFromGrid(pin, card),
      onSave: (pin, card) => {
        void openSaveDialog(pin, card);
      },
      onReorder: (pin, container, position) => {
        void moveRequest(pin, container, position);
      },
      onSelectionChange: (selected) => {
        selections.set(sectionId, selected);
        paintToolbar();
        const total = allSelected().length;
        if (total > 0) announce(copy.selected(total));
      },
      onSelectionCleared: () => {
        selections.set(sectionId, []);
        paintToolbar();
      },
    });

  let unsectionedGrid = makeGrid('Pins', null);
  unsectionedHolder.append(unsectionedGrid.element);

  const allSelected = (): number[] => [...selections.values()].flat();

  const paintToolbar = (): void => {
    clear(toolbarHolder);
    const selected = allSelected();
    if (selected.length === 0) return;
    const toolbar = el('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Selection' });
    toolbar.append(el('p', { class: 'selection-count', text: copy.selected(selected.length) }));
    const move = el('button', { type: 'button', class: 'secondary', text: 'Move' });
    move.addEventListener('click', () => {
      void openBulkDialog(
        {
          kind: 'move',
          pins: selected,
          excludeBoardId: boardId,
          onDone: () => {
            clearSelections();
            void reload();
          },
        },
        move,
      );
    });
    const copyButton = el('button', { type: 'button', class: 'secondary', text: 'Copy' });
    copyButton.addEventListener('click', () => {
      void openBulkDialog(
        {
          kind: 'copy',
          pins: selected,
          excludeBoardId: boardId,
          onDone: () => {
            clearSelections();
            void reload();
          },
        },
        copyButton,
      );
    });
    const remove = el('button', { type: 'button', class: 'secondary', text: 'Delete' });
    remove.addEventListener('click', () => {
      void busy(remove, 'Deleting', async () => {
        try {
          const operation = await api.post<{ id: number; deadline: string }>('/api/operations', {
            kind: 'delete',
            pins: selected,
            board: null,
            section: null,
          });
          showBulkToast('delete', selected.length, '', operation.id, operation.deadline);
          clearSelections();
          await reload();
        } catch (error) {
          showAlert(failureMessage(error));
        }
      });
    });
    toolbar.append(move, copyButton, remove);
    toolbarHolder.append(toolbar);
  };

  const clearSelections = (): void => {
    unsectionedGrid.clearSelection();
    for (const shell of sections.values()) shell.grid.clearSelection();
    selections.clear();
    paintToolbar();
  };

  const paintHeader = (): void => {
    if (!board) return;
    clear(header);
    header.append(el('h1', { class: 'board-name', text: board.name }));
    if (board.visibility === 'secret') {
      header.append(el('p', { class: 'meta', text: 'Secret' }));
    }
    header.append(el('p', { class: 'meta', text: copy.pins(board.pin_count) }));
    const followersNode = el('p', { class: 'meta', text: copy.followers(board.followers) });
    followersNode.dataset.role = 'followers';
    header.append(followersNode);

    const controls = el('div', { class: 'row board-controls' });
    if (board.role !== 'owner' && board.visibility === 'public') {
      const follow = el('button', {
        type: 'button',
        class: 'secondary',
        'aria-pressed': board.following ? 'true' : 'false',
        'aria-label': 'Follow',
        text: board.following ? 'Following' : 'Follow',
      });
      follow.addEventListener('click', () => {
        void (async () => {
          const pressed = follow.getAttribute('aria-pressed') === 'true';
          try {
            const result = await api[pressed ? 'del' : 'put']<{
              following: boolean;
              followers: number;
            }>(`/api/follows/boards/${boardId}`);
            follow.setAttribute('aria-pressed', result.following ? 'true' : 'false');
            follow.textContent = result.following ? 'Following' : 'Follow';
            followersNode.textContent = copy.followers(result.followers);
          } catch (error) {
            showAlert(failureMessage(error));
          }
        })();
      });
      controls.append(follow);
    }
    if (canEdit()) {
      const addPin = el('button', { type: 'button', class: 'secondary', text: 'Add pin' });
      addPin.addEventListener('click', () => navigate(`/create?board=${boardId}`));
      const addSection = el('button', { type: 'button', class: 'secondary', text: 'Add section' });
      addSection.addEventListener('click', () => openAddSectionDialog(boardId, addSection));
      controls.append(addPin, addSection);
    }
    if (board.role === 'owner') {
      const edit = el('button', { type: 'button', class: 'secondary', text: 'Edit board' });
      edit.addEventListener('click', () => {
        if (!board) return;
        openEditBoardDialog(
          {
            id: board.id,
            name: board.name,
            visibility: board.visibility,
            cover: board.cover,
            chosenCover: board.cover,
            pins: board.pins.map((pin) => ({ id: pin.id, title: pin.title })),
          },
          edit,
        );
      });
      const invite = el('button', { type: 'button', class: 'secondary', text: 'Invite' });
      invite.addEventListener('click', () => {
        if (board) openInviteDialog({ id: board.id, name: board.name }, invite);
      });
      controls.append(edit, invite);
    }
    if (board.role !== null) {
      const collaborators = el('button', {
        type: 'button',
        class: 'secondary',
        text: 'Collaborators',
      });
      collaborators.addEventListener('click', () => {
        if (!board) return;
        void openCollaboratorsDialog(
          { id: board.id, name: board.name, role: board.role, ownerId: board.owner.id },
          collaborators,
        );
      });
      controls.append(collaborators);
    }
    header.append(controls);
  };

  const paintViewers = (): void => {
    clear(viewersHolder);
    if (!members || members.members.length === 0) return;
    const list = el('ul', { class: 'viewing', role: 'list', 'aria-label': 'Viewing now' });
    for (const name of viewerNames) {
      list.append(el('li', { role: 'listitem', text: name }));
    }
    viewersHolder.append(list);
    viewersHolder.append(el('p', { class: 'meta', text: copy.viewing(viewerNames.length) }));
  };

  const sectionMove = async (sectionId: number, name: string, position: number): Promise<void> => {
    if (!board) return;
    try {
      await api.post(`/api/boards/${boardId}/moves`, {
        kind: 'section',
        id: sectionId,
        position,
        base_seq: board.seq,
      });
      pendingSectionFocus = sectionId;
      const refreshed = await reload();
      const index = refreshed.order.sections.findIndex((section) => section.id === sectionId);
      announce(copy.movedSection(name, index + 1, refreshed.order.sections.length));
    } catch (error) {
      showAlert(failureMessage(error));
    }
  };

  const paintSections = (): void => {
    if (!board) return;
    const key = board.order.sections.map((section) => `${section.id}:${section.name}`).join('|');
    if (key !== sectionOrderKey) {
      sectionOrderKey = key;
      clear(sectionsHolder);
      const known = new Set(board.order.sections.map((section) => section.id));
      for (const [id, shell] of sections) {
        if (!known.has(id)) {
          shell.grid.destroy();
          sections.delete(id);
        }
      }
      for (const [index, section] of board.order.sections.entries()) {
        let shell = sections.get(section.id);
        if (!shell) {
          const grid = makeGrid(section.name, section.id);
          const heading = el('h2', { class: 'section-name', tabindex: '0', text: section.name });
          const region = el('section', { role: 'region', 'aria-label': section.name });
          region.append(heading, grid.element);
          shell = { region, heading, grid };
          sections.set(section.id, shell);
          heading.addEventListener('keydown', (event) => {
            if (!event.altKey) return;
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            if (!canEdit() || !board) return;
            const current = board.order.sections.findIndex((item) => item.id === section.id);
            const next = event.key === 'ArrowUp' ? current : current + 2;
            if (next < 1 || next > board.order.sections.length) return;
            void sectionMove(section.id, section.name, next);
          });
          attachSectionDrag(heading, section.id, section.name);
        } else {
          shell.heading.textContent = section.name;
          shell.region.setAttribute('aria-label', section.name);
        }
        shell.region.dataset.position = String(index + 1);
        sectionsHolder.append(shell.region);
      }
    }
    for (const section of board.order.sections) {
      const shell = sections.get(section.id);
      if (!shell) continue;
      const pins = section.pins
        .map((id) => board?.pins.find((pin) => pin.id === id))
        .filter((pin): pin is Pin => pin !== undefined);
      shell.grid.setPins(pins);
      const existing = shell.region.querySelector('.empty-sentence');
      if (pins.length === 0 && !existing) {
        shell.region.append(el('p', { class: 'empty-sentence', text: copy.emptyBoard }));
      } else if (pins.length > 0 && existing) {
        existing.remove();
      }
    }
    if (pendingSectionFocus !== null) {
      sections.get(pendingSectionFocus)?.heading.focus();
      pendingSectionFocus = null;
    }
  };

  const attachSectionDrag = (heading: HTMLElement, sectionId: number, name: string): void => {
    let start: { x: number; y: number } | null = null;
    heading.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY };
    });
    const finish = (event: PointerEvent): void => {
      if (!start) return;
      const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      start = null;
      if (distance <= 10 || !canEdit()) return;
      const node = document.elementFromPoint(event.clientX, event.clientY);
      const region = node instanceof Element ? node.closest('section[role="region"]') : null;
      if (!(region instanceof HTMLElement)) return;
      const position = Number(region.dataset.position ?? '1');
      void sectionMove(sectionId, name, position);
    };
    window.addEventListener('pointerup', finish);
  };

  const paintUnsectioned = (): void => {
    if (!board) return;
    const pins = board.order.unsectioned
      .map((id) => board?.pins.find((pin) => pin.id === id))
      .filter((pin): pin is Pin => pin !== undefined);
    unsectionedGrid.setPins(pins);
    const existing = unsectionedHolder.querySelector('.empty-sentence');
    if (board.pin_count === 0 && !existing) {
      unsectionedHolder.append(el('p', { class: 'empty-sentence', text: copy.emptyBoard }));
    } else if (board.pin_count > 0 && existing) {
      existing.remove();
    }
  };

  const showNotFound = (): void => {
    for (const shell of sections.values()) shell.grid.destroy();
    sections.clear();
    unsectionedGrid.destroy();
    notFoundView(context, 'Board not found');
  };

  const reload = async (): Promise<Board> => {
    const previousRole = board?.role ?? null;
    const data = await api.get<Board>(`/api/boards/${boardId}`);
    board = data;
    if (previousRole !== data.role) {
      unsectionedGrid.destroy();
      const replacement = makeGrid('Pins', null);
      unsectionedHolder.replaceChild(replacement.element, unsectionedGrid.element);
      unsectionedGrid = replacement;
      sectionOrderKey = '';
      for (const shell of sections.values()) shell.grid.destroy();
      sections.clear();
    }
    members = await api.get<MembersResponse>(`/api/boards/${boardId}/members`);
    paintHeader();
    paintUnsectioned();
    paintSections();
    paintViewers();
    return data;
  };

  const load = async (): Promise<void> => {
    try {
      await reload();
      watch({ board: boardId });
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) {
        showNotFound();
        return;
      }
      showAlert(failureMessage(error));
    }
  };

  void load();

  const off = onLive((message) => {
    if (message.type === 'not_found' && message.board === boardId) {
      showNotFound();
      return;
    }
    if (message.type === 'membership' && message.board_id === boardId) {
      if (message.role === null) {
        showNotFound();
        return;
      }
      if (message.role === 'viewer' && board?.role === 'editor') {
        announce('You can now only view this board');
        toast('You can now only view this board');
      }
      void reload();
      return;
    }
    if (message.type === 'viewers' && message.board_id === boardId) {
      const incoming = message.viewers.map((viewer) => viewer.name);
      const self = state.user?.name ?? '';
      for (const name of incoming) {
        if (!viewerNames.includes(name) && name !== self) announce(`${name} opened this board`);
      }
      for (const name of viewerNames) {
        if (!incoming.includes(name) && name !== self) announce(`${name} left this board`);
      }
      viewerNames = incoming;
      paintViewers();
      return;
    }
    if (message.type === 'follow' && message.target === 'board' && message.id === boardId) {
      const node = header.querySelector<HTMLElement>('[data-role="followers"]');
      if (node) node.textContent = copy.followers(message.followers);
      return;
    }
    if (message.type === 'board' && message.board_id === boardId) {
      const mine = state.user?.id === message.actor.id;
      if (!mine) {
        const line =
          message.change === 'added' && message.pin
            ? `${message.actor.name} added ${message.pin.title}`
            : message.change === 'removed' && message.pin
              ? `${message.actor.name} removed ${message.pin.title}`
              : message.change === 'moved' && message.pin
                ? `${message.actor.name} moved ${message.pin.title}`
                : message.change === 'section_moved' && message.section
                  ? `${message.actor.name} moved section ${message.section.name}`
                  : null;
        if (line) {
          announce(line);
          toast(line);
        }
      }
      void reload();
    }
  });

  return {
    dispose: () => {
      off();
      unwatch({ board: boardId });
      unsectionedGrid.destroy();
      for (const shell of sections.values()) shell.grid.destroy();
    },
  };
}
