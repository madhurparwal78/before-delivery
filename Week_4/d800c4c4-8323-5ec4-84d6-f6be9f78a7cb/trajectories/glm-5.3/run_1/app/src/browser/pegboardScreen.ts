// The Pegboard: tool list with live filter, the board and item detail.

import type { ScreenKit } from './main';
import { el, clear } from './dom';
import { apiJson, ApiFailure } from './apiClient';
import { renderBoard } from './pegboard';
import { money, itemStatusWord } from './format';
import type { Item } from './types';

export function renderPegboardScreen(kit: ScreenKit): () => void {
  const { main, app } = kit;
  clear(main);

  const panes = el('div', { class: 'panes' });
  const toolListPane = el('section', { class: 'pane pane-left' });
  const boardPane = el('section', { class: 'pane pane-middle' });
  const detailPane = el('section', { class: 'pane pane-right' });
  panes.append(toolListPane, boardPane, detailPane);

  const announce = el('div', { role: 'status', 'aria-label': 'Account updates', 'aria-live': 'polite', class: 'status-line' });

  const filterTimer = { current: null as ReturnType<typeof setTimeout> | null };

  let filterText = '';
  let selectedItemId: number | null = null;

  const toolListBody = el('div', { class: 'pane-body' });
  const boardBody = el('div', { class: 'pane-body pegboard-wrap' });
  const detailBody = el('div', { class: 'pane-body' });

  const search = el('input', { type: 'search', id: 'find-tool', placeholder: 'Find a tool' }) as HTMLInputElement;
  search.setAttribute('role', 'searchbox');
  const filterLabel = el('label', { for: 'find-tool', text: 'Find a tool' });

  const toolsTable = el('table', { class: 'ledger', 'aria-label': 'Tools' });

  toolListPane.append(announce, el('h2', { text: 'Tool list' }), filterLabel, search, toolListBody);
  boardPane.append(el('div', { role: 'region', 'aria-label': 'Pegboard' }, el('h2', { text: 'Pegboard' }), boardBody));
  detailPane.append(el('div', { role: 'region', 'aria-label': 'Item detail' }, el('h2', { text: 'Item detail' }), detailBody));

  search.addEventListener('input', () => {
    filterText = search.value;
    renderToolList();
    if (filterTimer.current !== null) clearTimeout(filterTimer.current);
    filterTimer.current = setTimeout(() => {
      filterTimer.current = null;
      const items = filteredItems();
      const count = items.length;
      announce.textContent = count === 1 ? '1 tool matches.' : `${count} tools match.`;
    }, 250);
  });

  function filteredItems(): Item[] {
    const items = app.board === null ? [] : app.board.items;
    if (filterText.trim() === '') return items;
    const needle = filterText.trim().toLowerCase();
    return items.filter((item) => item.tag.toLowerCase().includes(needle) || item.name.toLowerCase().includes(needle));
  }

  function renderToolList(): void {
    clear(toolListBody);
    const head = el('thead', {}, el('tr', {}, el('th', { text: 'Tag' }), el('th', { text: 'Name' }), el('th', { text: 'Status' })));
    const body = el('tbody');
    const items = filteredItems();
    if (items.length === 0) {
      body.append(el('tr', {}, el('td', { colspan: '3', text: 'No tools match that search.' })));
    } else {
      for (const item of items) {
        const row = el('tr', {}, el('td', { class: 'mono', text: item.tag }), el('td', { text: item.name }), el('td', { text: itemStatusWord(item.status) }));
        row.addEventListener('click', () => selectItem(item.id));
        row.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') selectItem(item.id);
        });
        row.setAttribute('tabindex', '0');
        body.append(row);
      }
    }
    toolsTable.replaceChildren(head, body);
    toolListBody.append(toolsTable);
  }

  function selectItem(itemId: number): void {
    selectedItemId = itemId;
    renderDetail();
    // At 375 wide, selecting a tool scrolls item detail into view.
    if (window.innerWidth < 700) detailPane.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  function renderDetail(): void {
    clear(detailBody);
    if (app.board === null) return;
    const item = app.board.items.find((i) => i.id === selectedItemId);
    if (item === undefined) {
      detailBody.append(el('p', { class: 'hint', text: 'Pick a tool from the board.' }));
      return;
    }
    const card = el('div');
    card.append(el('h3', { text: item.name }));
    card.append(el('p', {}, el('span', { class: 'mono', text: item.tag }), ' — ', itemStatusWord(item.status)));
    const partsList = el('ul');
    for (const part of item.parts) {
      partsList.append(el('li', { text: `${part.name} (${part.state})` }));
    }
    card.append(el('p', { text: 'Parts' }), partsList);
    card.append(el('p', { text: `Replacement cost ${money(item.replacement_cost_cents)}` }));
    if (item.due_date !== null) {
      card.append(el('p', { class: 'mono', text: `Due ${item.due_date}` }));
    }
    if (item.hold_queue_length > 0) {
      card.append(el('p', { class: 'mono', text: `Queued holds ${item.hold_queue_length}` }));
    } else {
      card.append(el('p', { text: 'No one is waiting for this tool.' }));
    }

    const role = app.role();
    if (role === 'member') {
      const membership = app.me?.membership;
      const active = membership !== null && membership !== undefined && membership.status === 'active';
      const holdable = item.status !== 'on-wall' || item.hold_queue_length > 0;
      if (active && holdable) {
        const holdButton = el('button', { class: 'primary', text: 'Place hold' }) as HTMLButtonElement;
        holdButton.addEventListener('click', () => void placeHold(holdButton, item.id));
        card.append(holdButton);
      } else if (!active) {
        card.append(el('p', { text: 'Holds open once your membership is active.' }));
      } else {
        card.append(el('p', { text: 'Ask at the desk to borrow it.' }));
      }
    } else if (role === null && item.status !== 'on-wall') {
      card.append(el('p', {}, el('a', { href: '/signin', text: 'Sign in to place a hold' })));
    }
    detailBody.append(card);
  }

  async function placeHold(button: HTMLButtonElement, itemId: number): Promise<void> {
    button.textContent = 'Placing hold...';
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-disabled', 'true');
    try {
      const result = await apiJson<{ hold: { position: number } }>('POST', '/api/holds', { item_id: itemId });
      announce.textContent = `Hold placed. You are number ${result.hold.position} in the queue.`;
      button.remove();
      await app.refreshBoard();
      renderDetail();
    } catch (err) {
      button.textContent = 'Place hold';
      button.removeAttribute('aria-busy');
      button.removeAttribute('aria-disabled');
      if (err instanceof ApiFailure) {
        announce.textContent = err.error;
      }
    }
  }

  function renderBoardPane(): void {
    clear(boardBody);
    if (app.board === null) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'pegboard');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Pegboard');
    renderBoard(app.board, svg, (hit) => selectItem(hit.item.id), null, new Set());
    boardBody.append(svg);
  }

  const unsub = app.subscribe(() => {
    renderBoardPane();
    renderToolList();
    renderDetail();
  });

  renderBoardPane();
  renderToolList();
  renderDetail();
  main.append(panes);

  return () => {
    unsub();
    if (filterTimer.current !== null) clearTimeout(filterTimer.current);
  };
}
