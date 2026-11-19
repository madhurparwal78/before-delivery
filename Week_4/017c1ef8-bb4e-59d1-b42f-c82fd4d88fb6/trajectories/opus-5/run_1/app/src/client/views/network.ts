import { relativeTime } from '../../shared/format';
import { api } from '../api';
import { announce, dialog, h, qs, qsa, showAlert } from '../dom';
import {
  acceptFrom,
  ignoreFrom,
  personCardNode,
  withdrawTo,
  type PersonCard,
} from '../components/person';
import { cfg, nowIso, on, refreshCounters } from '../state';
import { S } from '../strings';

type NetworkLists = {
  received: PersonCard[];
  sent: PersonCard[];
  connections: PersonCard[];
};

export function networkView(): HTMLElement {
  const host = h('div', { class: 'narrow' });
  let lists: NetworkLists = { received: [], sent: [], connections: [] };
  let selected = new Set<string>();
  let cell: { row: number; column: number } = { row: 0, column: 0 };

  void load();
  const off = on('network', () => {
    if (!document.contains(host)) {
      off();
      return;
    }
    void load(true);
  });
  return host;

  async function load(keepFocus = false): Promise<void> {
    const result = await api.get<NetworkLists>('/api/network');
    if (!result.ok) return;
    lists = result.body;
    selected = new Set([...selected].filter((id) => lists.sent.some((card) => card.id === id)));
    const active = document.activeElement as HTMLElement | null;
    const activeLabel = active?.getAttribute('aria-label') ?? null;
    draw();
    if (keepFocus && activeLabel) {
      const again = qsa<HTMLElement>(`[aria-label="${activeLabel}"]`, host)[0];
      again?.focus();
    }
  }

  function draw(): void {
    host.replaceChildren(h('h1', { class: 'page-title', text: 'My network' }));

    host.append(
      h('h2', { class: 'section-title', tabindex: '-1', text: 'Invitations' }),
      h('p', { class: 'count tabular', text: String(lists.received.length) }),
    );
    const received = h('ul', { 'aria-label': 'Invitations', class: 'card-list' });
    if (lists.received.length === 0) {
      host.append(
        h('div', { class: 'empty' }, [
          h('p', { class: 'big-sentence', text: S.empty.invitations }),
          h('a', { href: '/search?type=people&q=', class: 'link underline' }, ['Search for people']),
        ]),
      );
    } else {
      lists.received.forEach((card, index) => {
        received.append(invitationCard(card, index));
      });
      host.append(received);
    }

    host.append(h('h2', { class: 'section-title', tabindex: '-1', text: 'Sent invitations' }));
    host.append(sentGrid());

    host.append(
      h('h2', { class: 'section-title', text: 'Connections' }),
      h('p', { class: 'count tabular', text: String(lists.connections.length) }),
    );
    const connections = h('ul', { 'aria-label': 'Connections', class: 'card-list' });
    for (const card of lists.connections) {
      connections.append(personCardNode(card, { reload: () => void load() }));
    }
    host.append(connections);
  }

  function invitationCard(card: PersonCard, index: number): HTMLElement {
    const item = h('li', {
      class: 'person-card',
      'data-member-id': card.id,
      'data-degree': card.degree,
      'data-connection-state': card.connection_state,
    });
    const moveFocus = (label: string): void => {
      const next = lists.received[index + 1] ?? lists.received[index - 1];
      if (!next) {
        qsa<HTMLElement>('h2.section-title', host)[0]?.focus();
        return;
      }
      const button = qsa<HTMLElement>(`[aria-label="${label} ${next.name}"]`, host)[0];
      button?.focus();
    };
    const accept = h(
      'button',
      {
        type: 'button',
        class: 'button',
        'aria-label': `Accept ${card.name}`,
        click: async () => {
          accept.setAttribute('disabled', '');
          const outcome = await acceptFrom(card, host, false);
          if (!outcome.failed) {
            await load();
            moveFocus('Accept');
            void refreshCounters();
          } else accept.removeAttribute('disabled');
        },
      },
      [`Accept ${card.name}`],
    );
    const ignore = h(
      'button',
      {
        type: 'button',
        class: 'button quiet',
        'aria-label': `Ignore ${card.name}`,
        click: async () => {
          ignore.setAttribute('disabled', '');
          const outcome = await ignoreFrom(card.id, host);
          if (!outcome.failed) {
            await load();
            moveFocus('Ignore');
            void refreshCounters();
          } else ignore.removeAttribute('disabled');
        },
      },
      [`Ignore ${card.name}`],
    );
    item.append(
      h('div', { class: 'card-main' }, [
        h('a', { href: `/in/${card.handle}`, class: 'person-name' }, [card.name]),
        h('p', { class: 'headline', text: card.headline }),
      ]),
      h('div', { class: 'card-actions' }, [accept, ignore]),
    );
    return item;
  }

  function sentGrid(): HTMLElement {
    if (lists.sent.length === 0) {
      return h('p', { class: 'big-sentence small', text: S.empty.invitations });
    }
    const wrap = h('div', { class: 'grid-wrap' });
    const withdrawSelected = h(
      'button',
      {
        type: 'button',
        class: 'button',
        disabled: selected.size === 0,
        click: () => openBatchDialog(),
      },
      [`Withdraw selected (${selected.size})`],
    );
    const grid = h('div', { role: 'grid', 'aria-label': 'Sent invitations', class: 'grid' });
    const headerRow = h('div', { role: 'row', class: 'grid-row head' });
    for (const label of ['Name', 'Headline', 'Sent', 'Action']) {
      headerRow.append(h('div', { role: 'columnheader', class: 'grid-cell', text: label }));
    }
    grid.append(headerRow);

    lists.sent.forEach((card, rowIndex) => {
      const row = h('div', {
        role: 'row',
        class: 'grid-row',
        'data-member-id': card.id,
        'aria-selected': selected.has(card.id) ? 'true' : 'false',
      });
      const cells = [
        h('div', { role: 'gridcell', class: 'grid-cell person-name small', text: card.name }),
        h('div', { role: 'gridcell', class: 'grid-cell', text: card.headline }),
        h('div', { role: 'gridcell', class: 'grid-cell tabular' }, [
          card.requested_at
            ? relativeTime(card.requested_at, nowIso(), cfg().time_zone)
            : '',
        ]),
        h('div', { role: 'gridcell', class: 'grid-cell' }, [
          h(
            'button',
            {
              type: 'button',
              class: 'button',
              tabindex: '-1',
              'aria-label': `Withdraw request to ${card.name}`,
              click: async () => {
                const outcome = await withdrawTo(card.id, wrap);
                if (!outcome.failed) void load();
              },
            },
            [`Withdraw request to ${card.name}`],
          ),
        ]),
      ];
      cells.forEach((node, columnIndex) => {
        node.setAttribute(
          'tabindex',
          rowIndex === cell.row && columnIndex === cell.column ? '0' : '-1',
        );
        node.addEventListener('focus', () => {
          cell = { row: rowIndex, column: columnIndex };
          setTabStop();
        });
        row.append(node);
      });
      grid.append(row);
    });

    grid.addEventListener('keydown', (event) => {
      const rows = qsa<HTMLElement>('[role="row"]:not(.head)', grid);
      const columns = 4;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        cell.column = Math.min(cell.column + 1, columns - 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        cell.column = Math.max(cell.column - 1, 0);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        cell.row = Math.min(cell.row + 1, rows.length - 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        cell.row = Math.max(cell.row - 1, 0);
      } else if (event.key === 'Home') {
        event.preventDefault();
        if (event.ctrlKey) cell = { row: 0, column: 0 };
        else cell.column = 0;
      } else if (event.key === 'End') {
        event.preventDefault();
        if (event.ctrlKey) cell = { row: rows.length - 1, column: columns - 1 };
        else cell.column = columns - 1;
      } else if (event.key === ' ') {
        event.preventDefault();
        if (cell.column === 3) return;
        const card = lists.sent[cell.row];
        if (!card) return;
        if (selected.has(card.id)) selected.delete(card.id);
        else selected.add(card.id);
        rows[cell.row].setAttribute('aria-selected', selected.has(card.id) ? 'true' : 'false');
        withdrawSelected.textContent = `Withdraw selected (${selected.size})`;
        if (selected.size === 0) withdrawSelected.setAttribute('disabled', '');
        else withdrawSelected.removeAttribute('disabled');
        return;
      } else if (event.key === 'Enter') {
        if (cell.column !== 3) return;
        event.preventDefault();
        qs<HTMLElement>('button', rows[cell.row].children[3] as HTMLElement)?.click();
        return;
      } else return;
      setTabStop();
      focusCell();
    });

    wrap.append(withdrawSelected, grid);
    return wrap;

    function setTabStop(): void {
      const rows = qsa<HTMLElement>('[role="row"]:not(.head)', grid);
      rows.forEach((row, rowIndex) => {
        [...row.children].forEach((node, columnIndex) => {
          (node as HTMLElement).setAttribute(
            'tabindex',
            rowIndex === cell.row && columnIndex === cell.column ? '0' : '-1',
          );
        });
      });
    }

    function focusCell(): void {
      const rows = qsa<HTMLElement>('[role="row"]:not(.head)', grid);
      (rows[cell.row]?.children[cell.column] as HTMLElement | undefined)?.focus();
    }

    function openBatchDialog(): void {
      const ids = lists.sent.filter((card) => selected.has(card.id)).map((card) => card.id);
      const count = ids.length;
      const name = count === 1 ? 'Withdraw 1 invitation?' : `Withdraw ${count} invitations?`;
      dialog(
        name,
        (close) => {
          const confirm = h(
            'button',
            {
              type: 'button',
              class: 'button',
              click: async () => {
                confirm.setAttribute('disabled', '');
                const firstIndex = lists.sent.findIndex((card) => card.id === ids[0]);
                const result = await api.post<{ error?: string; member_id?: string }>(
                  '/api/invitations/withdraw',
                  { member_ids: ids },
                );
                close();
                if (!result.ok) {
                  const refused = lists.sent.find((card) => card.id === result.body.member_id);
                  showAlert(
                    wrap,
                    refused
                      ? S.alert.batchWithdrawRefused(refused.name)
                      : S.alert.somethingWrong,
                  );
                  void load();
                  return;
                }
                selected = new Set();
                announce('Network announcements', S.announce.withdrewMany(count));
                await load();
                const rows = qsa<HTMLElement>('[role="row"]:not(.head)', host);
                if (rows.length === 0) {
                  qsa<HTMLElement>('h2.section-title', host)[1]?.focus();
                  return;
                }
                const target = rows[Math.min(firstIndex, rows.length - 1)];
                cell = { row: Math.min(firstIndex, rows.length - 1), column: 0 };
                (target.children[0] as HTMLElement).focus();
              },
            },
            ['Withdraw'],
          );
          return [
            h('h2', { text: name }),
            confirm,
            h('button', { type: 'button', class: 'button quiet', click: () => close() }, ['Cancel']),
          ];
        },
        withdrawSelected,
      );
    }
  }
}
