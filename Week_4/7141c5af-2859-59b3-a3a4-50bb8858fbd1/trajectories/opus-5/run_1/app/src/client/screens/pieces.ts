/**
 * The Pieces list: its filters, its cursor paging and each row's action menu.
 */
import { F, EMPTY } from '../../shared/feedback.ts';
import { PIECE_STATE_KEYS, PIECE_STATE_NAMES, SORT_OPTIONS, TOWN_NAMES_EN, LANGUAGE_OPTIONS } from '../../shared/deskLinks.ts';
import { api, ApiError, fieldProblems } from '../ui/api.ts';
import { all, el, find, need, patchList, setHidden, setText } from '../ui/dom.ts';
import { announce, clearProblems, showProblems, withPending } from '../ui/shell.ts';
import { field, openModal, placeInView } from '../ui/dialog.ts';
import { navigate, setQuery } from '../router.ts';
import { body, setRefresher, wireMainAction } from './deskShell.ts';

interface Piece {
  id: string;
  title: string;
  clientId: string;
  clientName?: string;
  state: string;
  dueDate: string | null;
  stampNumber: string | null;
  maker: string | null;
}

interface Client {
  id: string;
  name: string;
  state: string;
}

let clients: Client[] = [];
let today = '';

async function readToday(): Promise<string> {
  if (today) return today;
  const answer = (await api.get('/api/session')) as { session: { today: string } };
  today = answer.session.today;
  return today;
}

function addDaysText(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const moved = new Date(Date.UTC(y!, m! - 1, d! + days));
  return moved.toISOString().slice(0, 10);
}

function queryText(): string {
  const url = new URL(window.location.href);
  const parts: string[] = [];
  for (const name of ['client', 'state', 'sort', 'cursor']) {
    const value = url.searchParams.get(name);
    if (value !== null) parts.push(`${name}=${encodeURIComponent(value)}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/** The action menu opens uncut inside the viewport, even on the last row. */
function openActionMenu(button: HTMLButtonElement, piece: Piece, reload: () => Promise<void>): void {
  const existing = find<HTMLElement>('.row-menu');
  existing?.remove();

  const menu = el('div', { class: 'row-menu', role: 'menu' });
  const item = (label: string, run: () => void): HTMLElement => {
    const node = el('button', { type: 'button', role: 'menuitem', text: label });
    node.addEventListener('click', run);
    return node;
  };

  const close = (returnFocus = true): void => {
    menu.remove();
    button.setAttribute('aria-expanded', 'false');
    if (returnFocus && document.body.contains(button)) button.focus();
  };

  menu.append(
    item('Open', () => {
      close(false);
      void navigate(`/pieces/${piece.id}`);
    }),
    item('Duplicate', () => {
      void withPending(button, async () => {
        close(false);
        await api.post('/api/pieces', { duplicateOf: piece.id });
        announce(F.pieceDuplicated(piece.title));
        await reload();
      });
    }),
    item('Archive', () => {
      void withPending(button, async () => {
        close(false);
        await api.patch(`/api/pieces/${piece.id}`, { state: 'archived' });
        announce(F.pieceArchived(piece.title));
        await reload();
      });
    }),
  );

  menu.addEventListener('keydown', (event) => {
    const items = all<HTMLElement>('[role="menuitem"]', menu);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(at + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(at - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Tab') {
      close();
    }
  });

  document.body.append(menu);
  placeInView(menu, button);
  button.setAttribute('aria-expanded', 'true');
  all<HTMLElement>('[role="menuitem"]', menu)[0]?.focus();

  const away = (event: PointerEvent): void => {
    if (menu.contains(event.target as Node) || event.target === button) return;
    document.removeEventListener('pointerdown', away);
    close(false);
  };
  document.addEventListener('pointerdown', away);
}

function newPieceDialog(opener: HTMLElement, reload: () => Promise<void>): void {
  openModal({
    name: 'New piece',
    opener,
    build(dialogBody, handle) {
      const clientSelect = el('select', { name: 'clientId' });
      for (const client of clients) {
        clientSelect.append(el('option', { value: client.id, text: client.name }));
      }
      const inputs: Record<string, HTMLInputElement> = {};
      const rows: HTMLElement[] = [field('np-client', 'Client', clientSelect)];
      const texts: [string, string, string][] = [
        ['title', 'Title', 'text'],
        ['maker', 'Maker', 'text'],
        ['year', 'Year', 'text'],
        ['stampNumber', 'Stamp number', 'text'],
        ['widthCm', 'Width in cm', 'text'],
        ['depthCm', 'Depth in cm', 'text'],
        ['heightCm', 'Height in cm', 'text'],
        ['weightKg', 'Weight in kg', 'text'],
        ['dueDate', 'Due date', 'text'],
      ];
      for (const [name, label, type] of texts) {
        const input = el('input', { type, name, inputmode: name === 'dueDate' ? 'numeric' : 'text' });
        inputs[name] = input;
        rows.push(field(`np-${name}`, label, input));
      }
      const notes = el('textarea', { name: 'notes', rows: 3 });
      const save = el('button', { type: 'button', class: 'button-primary', text: 'Save piece' });
      const close = el('button', { type: 'button', text: 'Close' });
      dialogBody.append(...rows, field('np-notes', 'Notes', notes), el('p', { class: 'dialog-actions' }, [save, close]));

      close.addEventListener('click', () => handle.close());
      save.addEventListener('click', () => {
        void withPending(save, async () => {
          clearProblems(handle.problems, [...Object.values(inputs), notes, clientSelect]);
          const payload: Record<string, unknown> = {
            clientId: clientSelect.value,
            title: inputs.title!.value,
          };
          for (const [name] of texts) {
            if (name === 'title') continue;
            const value = inputs[name]!.value;
            if (value !== '') payload[name] = value;
          }
          if (notes.value !== '') payload.notes = notes.value;
          try {
            const answer = (await api.post('/api/pieces', payload)) as { piece: Piece };
            handle.close();
            announce(F.pieceSaved(answer.piece.title));
            await reload();
          } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            const problems = fieldProblems(error);
            showProblems(
              handle.problems,
              problems.length > 0 ? problems : [{ field: 'title', message: error.failure.message }],
              (name) => inputs[name] ?? (name === 'notes' ? notes : clientSelect),
              'Problems',
            );
          }
        });
      });
    },
  });
}

export async function startPieces(): Promise<void> {
  const screen = body();
  const url = new URL(window.location.href);

  const filterTile = el('div', { class: 'tile tile-filter' });
  const clientSelect = el('select', { 'aria-label': 'Client' });
  const stateSelect = el('select', { 'aria-label': 'State' });
  const sortSelect = el('select', { 'aria-label': 'Sort' });
  filterTile.append(
    el('p', { class: 'field' }, [el('label', { for: 'filter-client', text: 'Client' }), clientSelect]),
    el('p', { class: 'field' }, [el('label', { for: 'filter-state', text: 'State' }), stateSelect]),
    el('p', { class: 'field' }, [el('label', { for: 'filter-sort', text: 'Sort' }), sortSelect]),
  );
  clientSelect.id = 'filter-client';
  stateSelect.id = 'filter-state';
  sortSelect.id = 'filter-sort';

  const table = el('table', { class: 'desk-table' });
  table.append(
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Piece' }),
        el('th', { scope: 'col', text: 'Client' }),
        el('th', { scope: 'col', text: 'State' }),
        el('th', { scope: 'col', text: 'Stamp' }),
        el('th', { scope: 'col', text: 'Due' }),
        el('th', { scope: 'col', text: 'Actions' }),
      ]),
    ]),
  );
  const tbody = el('tbody', {});
  table.append(tbody);
  const frame = el('div', { class: 'frame', role: 'region', 'aria-label': 'Pieces table', tabindex: '0' }, [table]);
  const tableTile = el('div', { class: 'tile tile-large' }, [frame]);
  const empty = el('p', { class: 'tile tile-empty', text: EMPTY.pieces, hidden: true });
  const paging = el('p', { class: 'paging' });
  const mint = el('div', { class: 'tile tile-mint' }, [
    el('p', { class: 'figure-label', text: 'Due in 14 days' }),
    el('p', { class: 'figure', id: 'due-soon', text: '0' }),
  ]);
  const newPiece = el('button', { type: 'button', class: 'button-primary', text: 'New piece', id: 'new-piece' });

  screen.textContent = '';
  screen.append(filterTile, mint, tableTile, empty, paging, el('p', { class: 'screen-action' }, [newPiece]));

  clients = ((await api.get('/api/clients')) as { clients: Client[] }).clients.filter(
    (client) => client.state !== 'erased',
  );

  clientSelect.append(el('option', { value: '', text: 'All clients' }));
  for (const client of clients) {
    clientSelect.append(el('option', { value: client.id, text: client.name }));
  }
  stateSelect.append(el('option', { value: '', text: 'All but archived' }));
  for (const key of PIECE_STATE_KEYS) {
    stateSelect.append(el('option', { value: key, text: PIECE_STATE_NAMES[key] }));
  }
  for (const option of SORT_OPTIONS) {
    sortSelect.append(el('option', { value: option.value, text: option.label }));
  }

  clientSelect.value = url.searchParams.get('client') ?? '';
  stateSelect.value = url.searchParams.get('state') ?? '';
  sortSelect.value = url.searchParams.get('sort') ?? 'title';

  const load = async (): Promise<void> => {
    const answer = (await api.get(`/api/pieces${queryText()}`)) as {
      pieces: Piece[];
      nextCursor: string | null;
    };
    const start = await readToday();
    const end = addDaysText(start, 14);

    patchList(
      tbody,
      answer.pieces,
      (piece) => piece.id,
      (piece) => {
        const row = el('tr', {});
        row.append(
          el('td', {}, [el('a', { href: `/pieces/${piece.id}`, 'data-piece-link': piece.id, text: piece.title })]),
          el('td', { class: 'cell-client' }),
          el('td', { class: 'cell-state' }),
          el('td', { class: 'cell-stamp' }),
          el('td', { class: 'cell-due' }),
          el('td', {}, [el('button', { type: 'button', class: 'row-actions', 'aria-expanded': 'false' })]),
        );
        return row;
      },
      (row, piece) => {
        const link = need<HTMLAnchorElement>('a', row);
        setText(link, piece.title);
        link.href = `/pieces/${piece.id}`;
        setText(need('.cell-client', row), piece.clientName ?? '');
        setText(need('.cell-state', row), PIECE_STATE_NAMES[piece.state as 'received'] ?? piece.state);
        setText(need('.cell-stamp', row), piece.stampNumber ?? '');
        setText(need('.cell-due', row), piece.dueDate ?? '');
        const actions = need<HTMLButtonElement>('.row-actions', row);
        const name = `Actions for ${piece.title}`;
        setText(actions, 'Actions');
        actions.setAttribute('aria-label', name);
        actions.onclick = () => openActionMenu(actions, piece, load);
      },
    );

    setHidden(empty, answer.pieces.length > 0);
    setHidden(tableTile, answer.pieces.length === 0);

    paging.textContent = '';
    if (answer.nextCursor !== null) {
      const next = el('a', { href: '#', text: 'Next page' });
      next.addEventListener('click', (event) => {
        event.preventDefault();
        setQuery({ cursor: answer.nextCursor });
        void load();
      });
      paging.append(next);
    }

    const dueSoon = answer.pieces.filter(
      (piece) =>
        piece.state !== 'archived' &&
        piece.dueDate !== null &&
        piece.dueDate >= start &&
        piece.dueDate <= end,
    ).length;
    setText(need('#due-soon'), String(dueSoon));
  };

  const commit = (): void => {
    setQuery({
      client: clientSelect.value === '' ? null : clientSelect.value,
      state: stateSelect.value === '' ? null : stateSelect.value,
      sort: sortSelect.value === 'title' ? null : sortSelect.value,
      cursor: null,
    });
    void load();
  };
  clientSelect.addEventListener('change', commit);
  stateSelect.addEventListener('change', commit);
  sortSelect.addEventListener('change', commit);

  newPiece.addEventListener('click', () => newPieceDialog(newPiece, load));
  wireMainAction(() => newPieceDialog(newPiece, load));

  await load();
  setRefresher(load);
}

export { TOWN_NAMES_EN, LANGUAGE_OPTIONS };
