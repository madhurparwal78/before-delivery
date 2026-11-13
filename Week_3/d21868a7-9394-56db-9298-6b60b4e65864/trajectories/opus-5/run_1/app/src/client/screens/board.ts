import { boardOrderStatusLabel } from '../../domain/orders.ts';
import { WINDOW_STATUS_LABELS } from '../../domain/time.ts';
import { api, failureOf } from '../api.ts';
import { copy } from '../copy.ts';
import { formatMlNumber } from '../counters.ts';
import { managedDialog } from '../dialog.ts';
import { clear, countTo, el, focusableIn, renderWhenChanged, setText, trapFocus } from '../dom.ts';
import { navigate, pushAddress } from '../navigation.ts';
import type { Screen } from '../screen.ts';
import { dataRow, dataTable } from '../table.ts';
import type { CardRecord, ChannelRecord, NoticeRecord, OrderRecord, WindowRecord } from '../types.ts';

/** The dispatcher's three-pane channel desk. */

type Tab = 'capacity' | 'orders' | 'restrictions';

interface BoardState {
  channels: string[];
  windowId: string | null;
  tab: Tab;
  railOpen: boolean;
}

const PHONE = '(max-width: 767px)';
const DESKTOP = '(min-width: 1200px)';

function readAddress(): BoardState {
  const query = new URLSearchParams(window.location.search);
  const channels = (query.get('channels') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  const tab = query.get('tab');
  return {
    channels,
    windowId: query.get('window'),
    tab: tab === 'orders' || tab === 'restrictions' ? tab : 'capacity',
    railOpen: window.matchMedia(DESKTOP).matches,
  };
}

function addressFor(state: BoardState): string {
  const query = new URLSearchParams();
  if (state.channels.length > 0) query.set('channels', state.channels.join(','));
  if (state.windowId !== null) query.set('window', state.windowId);
  query.set('tab', state.tab);
  return `/board?${query.toString()}`;
}

export async function boardScreen(): Promise<Screen> {
  const state = readAddress();

  const status = el('p', {
    class: 'status',
    attrs: { role: 'status', 'aria-label': 'Board status', 'aria-live': 'polite' },
  });
  const railHost = el('div', { class: 'rail-host' });
  const grid = el('div', {
    class: 'window-grid',
    attrs: { role: 'grid', 'aria-label': 'Window grid' },
  });
  const detailHost = el('div', { class: 'detail-host' });
  const dialogHost = el('div');

  const channelsToggle = el('button', {
    class: 'button',
    text: 'Channels',
    attrs: { type: 'button', 'aria-expanded': 'false' },
  });

  const element = el('main', {
    class: 'page board',
    children: [
      el('div', { class: 'board-bar', children: [channelsToggle, status] }),
      el('div', { class: 'board-panes', children: [railHost, grid, detailHost] }),
      dialogHost,
    ],
  });

  let channels: ChannelRecord[] = [];
  let windows: WindowRecord[] = [];
  let orders: OrderRecord[] = [];
  let cards: CardRecord[] = [];
  let notices: NoticeRecord[] = [];
  let pending = false;

  const expanders = { details: true, cards: false, notices: false };
  const cellViews = new Map<string, { button: HTMLButtonElement; figure: HTMLElement; tag: HTMLElement; statusText: HTMLElement }>();
  const rowViews = new Map<string, { row: HTMLElement; cells: Record<string, HTMLElement>; actions: HTMLElement }>();

  const selectedWindow = (): WindowRecord | null =>
    windows.find((window) => window.id === state.windowId) ?? null;

  const visibleWindows = (): WindowRecord[] =>
    windows.filter((window) => state.channels.length === 0 || state.channels.includes(window.channel_id));

  const syncAddress = (): void => pushAddress(addressFor(state));

  // --- dialogs -------------------------------------------------------------

  const capInput = el('input', {
    class: 'input tabular',
    attrs: { type: 'text', inputmode: 'decimal', 'aria-label': 'Cap (ML/day)', autocomplete: 'off' },
  });
  const capError = el('p', { class: 'field-error' });
  const reasonInput = el('input', {
    class: 'input',
    attrs: { type: 'text', 'aria-label': 'Reason', autocomplete: 'off' },
  });
  const reasonError = el('p', { class: 'field-error' });
  const publishButton = el('button', { class: 'button button-primary', text: 'Publish', attrs: { type: 'button' } });
  const publishCancel = el('button', { class: 'button', text: 'Cancel', attrs: { type: 'button' } });
  const restrictionDialog = managedDialog(dialogHost, {
    role: 'dialog',
    label: 'Publish restriction',
    onEscape: () => closeRestrictionDialog(),
  });
  restrictionDialog.element.append(
    el('h2', { text: 'Publish restriction' }),
    capInput,
    capError,
    reasonInput,
    reasonError,
    el('div', { class: 'dialog-actions', children: [publishCancel, publishButton] }),
  );

  const openRestrictionDialog = (): void => {
    if (state.windowId === null) return;
    restrictionDialog.open();
    capInput.focus();
  };
  const closeRestrictionDialog = (): void => {
    restrictionDialog.close();
    publishRestrictionButton.focus();
  };

  publishCancel.addEventListener('click', closeRestrictionDialog);
  publishButton.addEventListener('click', () => {
    const window = selectedWindow();
    if (window === null) return;
    setText(status, copy.publishingRestriction);
    void (async () => {
      try {
        const reply = await api.post<{ restriction: { id: string } }>(
          `/api/windows/${encodeURIComponent(window.id)}/restrictions`,
          { cap_ml_day: capInput.value.trim(), reason: reasonInput.value },
        );
        restrictionDialog.close();
        navigate(`/restrictions/${reply.restriction.id}`);
      } catch (cause) {
        const failure = failureOf(cause);
        if (failure === null) return;
        setText(capError, failure.errors?.cap_ml_day ?? '');
        setText(reasonError, failure.errors?.reason ?? '');
        if (failure.code === 'restriction_exists') setText(status, copy.restrictionExists);
        else if (failure.code === 'window_closed') setText(status, copy.windowClosed);
        else if (failure.status !== 422) setText(status, failure.message ?? '');
        else setText(status, '');
      }
    })();
  });

  const rationBody = el('p');
  const rationButton = el('button', { class: 'button button-primary', text: 'Ration', attrs: { type: 'button' } });
  const rationCancel = el('button', { class: 'button', text: 'Cancel', attrs: { type: 'button' } });
  const rationDialog = managedDialog(dialogHost, {
    role: 'alertdialog',
    label: 'Ration',
    onEscape: () => closeRationDialog(),
  });
  rationDialog.element.append(
    el('h2', { text: 'Ration window' }),
    rationBody,
    el('div', { class: 'dialog-actions', children: [rationCancel, rationButton] }),
  );

  const paintRationBody = (): void => {
    const window = selectedWindow();
    if (window === null) return;
    rationDialog.element.setAttribute('aria-label', `Ration ${window.label}`);
    const requested = orders.filter((order) => order.status === 'requested').length;
    setText(rationBody, copy.rationDialogBody(window.remaining_ml, requested));
  };

  const openRationDialog = (): void => {
    paintRationBody();
    rationDialog.open();
    rationButton.focus();
  };
  const closeRationDialog = (): void => {
    rationDialog.close();
    rationWindowButton.focus();
  };
  rationCancel.addEventListener('click', closeRationDialog);
  rationButton.addEventListener('click', () => {
    const window = selectedWindow();
    if (window === null || pending) return;
    pending = true;
    rationDialog.close();
    paintActionsDisabled();
    setText(status, copy.rationing);
    void (async () => {
      try {
        const reply = await api.post<{
          window: WindowRecord;
          rationed: { order_number: string }[];
          left_requested: string[];
        }>(`/api/windows/${encodeURIComponent(window.id)}/ration`);
        applyWindow(reply.window);
        await reloadOrders();
        setText(status, copy.windowRationed(reply.rationed.length, reply.left_requested.length));
      } catch (cause) {
        const failure = failureOf(cause);
        await reloadOrders();
        if (failure?.code === 'nothing_to_ration') setText(status, copy.nothingToRation);
        else if (failure?.code === 'window_closed') setText(status, copy.windowClosed);
        else setText(status, failure?.message ?? '');
      } finally {
        pending = false;
        paintDetail();
      }
    })();
  });

  // --- detail pane ---------------------------------------------------------

  const counterRemaining = counter('Remaining ML');
  const counterDelivered = counter('Delivered ML');
  const counterFlow = counter('Channel flow');
  const publishRestrictionButton = el('button', {
    class: 'button',
    text: 'Publish restriction',
    attrs: { type: 'button' },
  });
  publishRestrictionButton.addEventListener('click', openRestrictionDialog);

  const tabButtons: Record<Tab, HTMLButtonElement> = {
    capacity: tabButton('Capacity'),
    orders: tabButton('Orders'),
    restrictions: tabButton('Restrictions'),
  };
  const tabList = el('div', {
    class: 'tablist',
    attrs: { role: 'tablist', 'aria-label': 'Window views' },
    children: [tabButtons.capacity, tabButtons.orders, tabButtons.restrictions],
  });
  for (const [name, button] of Object.entries(tabButtons) as [Tab, HTMLButtonElement][]) {
    button.addEventListener('click', () => {
      state.tab = name;
      syncAddress();
      paintDetail();
    });
  }

  const panel = el('div', { class: 'tabpanel', attrs: { role: 'tabpanel', 'aria-label': 'Window views' } });
  const rationWindowButton = el('button', { class: 'button', text: 'Ration window', attrs: { type: 'button' } });
  rationWindowButton.addEventListener('click', () => {
    if (pending) return;
    openRationDialog();
  });

  const ordersTable = dataTable('Window orders', ['Order', 'Turnout', 'Grower', 'Volume (ML)', 'Status', 'Actions']);
  const detailBody = el('div', {
    class: 'detail-body',
    children: [
      el('div', {
        class: 'counter-row',
        children: [counterRemaining.element, counterDelivered.element, counterFlow.element],
      }),
      publishRestrictionButton,
      tabList,
      panel,
    ],
  });

  const emptyDetail = el('p', { class: 'detail-empty', text: copy.selectAWindow });
  const closeDetail = el('button', {
    class: 'button',
    text: 'Close window detail',
    attrs: { type: 'button' },
  });
  let releaseDetail: (() => void) | null = null;

  const closeDetailSheet = (): void => {
    const previous = state.windowId;
    state.windowId = null;
    syncAddress();
    paintAll();
    if (previous !== null) cellViews.get(previous)?.button.focus();
  };
  closeDetail.addEventListener('click', closeDetailSheet);

  // --- rail ---------------------------------------------------------------

  const railBox = el('div', { class: 'rail-body' });
  const closeChannels = el('button', { class: 'button', text: 'Close channels', attrs: { type: 'button' } });
  let releaseRail: (() => void) | null = null;

  const closeRail = (): void => {
    state.railOpen = false;
    paintRail();
    channelsToggle.focus();
  };
  closeChannels.addEventListener('click', closeRail);

  channelsToggle.addEventListener('click', () => {
    state.railOpen = !state.railOpen;
    paintRail();
  });

  const paintRail = (): void => {
    releaseRail?.();
    releaseRail = null;
    clear(railHost);
    channelsToggle.setAttribute('aria-expanded', state.railOpen ? 'true' : 'false');
    if (!state.railOpen) return;
    clear(railBox);
    for (const channel of channels) {
      const box = el('input', {
        class: 'checkbox',
        attrs: {
          type: 'checkbox',
          id: `rail-${channel.id}`,
          'aria-label': channel.name,
          checked: state.channels.length === 0 || state.channels.includes(channel.id),
        },
      });
      box.addEventListener('change', () => {
        const checked = [...railBox.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
          .filter((input) => input.checked)
          .map((input) => input.id.replace('rail-', ''));
        state.channels = checked.length === channels.length ? [] : checked;
        syncAddress();
        paintGrid();
      });
      railBox.appendChild(
        el('div', {
          class: 'rail-row',
          children: [box, el('label', { text: channel.name, attrs: { for: `rail-${channel.id}` } })],
        }),
      );
    }
    if (window.matchMedia(PHONE).matches) {
      const drawer = el('div', {
        class: 'drawer',
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Channels' },
        children: [el('h2', { text: 'Channels' }), railBox, closeChannels],
      });
      releaseRail = trapFocus(drawer, closeRail);
      railHost.appendChild(el('div', { class: 'overlay overlay-drawer', children: [drawer] }));
      (focusableIn(drawer)[0] as HTMLElement | undefined)?.focus();
      return;
    }
    railHost.appendChild(
      el('div', {
        class: 'rail',
        attrs: { role: 'region', 'aria-label': 'Channel rail' },
        children: [el('h2', { text: 'Channels' }), railBox],
      }),
    );
  };

  // --- grid ---------------------------------------------------------------

  const paintGrid = (): void => {
    const shown = visibleWindows();
    const wanted = shown.map((window) => window.id).join(',');
    if (grid.dataset.keys !== wanted) {
      grid.dataset.keys = wanted;
      cellViews.clear();
      clear(grid);
      for (const window of shown) {
        const figure = el('span', { class: 'cell-remaining tabular', text: window.remaining_ml });
        const statusText = el('span', { class: 'cell-status', text: WINDOW_STATUS_LABELS[window.status] });
        const tag = el('span', { class: 'tag-restricted', text: 'Restricted' });
        const button = el('button', {
          class: 'cell-button',
          attrs: {
            type: 'button',
            'aria-label': `${window.channel_name}, ${window.label}, ${window.remaining_ml} ML remaining`,
          },
          children: [
            el('span', { class: 'cell-channel', text: window.channel_name }),
            el('span', { class: 'cell-window', text: window.label }),
            statusText,
            figure,
            tag,
          ],
        });
        button.addEventListener('click', () => {
          state.windowId = window.id;
          syncAddress();
          paintAll();
        });
        grid.appendChild(el('div', { class: 'grid-cell', attrs: { role: 'gridcell' }, children: [button] }));
        cellViews.set(window.id, { button, figure, tag, statusText });
      }
    }

    for (const window of shown) {
      const view = cellViews.get(window.id);
      if (view === undefined) continue;
      if (view.figure.textContent !== window.remaining_ml) {
        countTo(view.figure, Number(view.figure.textContent), Number(window.remaining_ml), formatMlNumber);
        view.figure.classList.remove('cell-changed');
        void view.figure.offsetWidth;
        view.figure.classList.add('cell-changed');
      }
      setText(view.statusText, WINDOW_STATUS_LABELS[window.status]);
      view.tag.hidden = window.restriction_cap_ml_day === null;
      view.button.setAttribute(
        'aria-label',
        `${window.channel_name}, ${window.label}, ${window.remaining_ml} ML remaining`,
      );
      view.button.classList.toggle('selected', window.id === state.windowId);
    }
  };

  // --- detail panels ------------------------------------------------------

  const paintCapacityPanel = (window: WindowRecord): void => {
    const signature = [
      'capacity',
      expanders.details,
      expanders.cards,
      expanders.notices,
      window.id,
      window.table_cap_ml_day,
      window.effective_cap_ml_day,
      window.cap_volume_ml,
      window.rostered_operator,
      cards.map((card) => [card.id, card.state, card.holder_code].join(':')).join(','),
      notices.map((notice) => [notice.kind, notice.grower_id, notice.state].join(':')).join(','),
    ].join('|');
    if (panel.dataset.signature === signature) return;
    panel.dataset.signature = signature;
    clear(panel);
    panel.appendChild(
      expander('Window details', expanders.details, () => {
        expanders.details = !expanders.details;
        paintDetail();
      }, () =>
        el('dl', {
          class: 'details',
          children: [
            el('dt', { text: 'Opens' }),
            el('dd', { text: window.opens_at }),
            el('dt', { text: 'Closes' }),
            el('dd', { text: window.closes_at }),
            el('dt', { text: 'Hours' }),
            el('dd', { text: String(window.hours) }),
            el('dt', { text: 'Table cap (ML/day)' }),
            el('dd', { class: 'tabular', text: window.table_cap_ml_day }),
            el('dt', { text: 'Effective cap (ML/day)' }),
            el('dd', { class: 'tabular', text: window.effective_cap_ml_day }),
            el('dt', { text: 'Cap volume (ML)' }),
            el('dd', { class: 'tabular', text: window.cap_volume_ml }),
            el('dt', { text: 'Rostered operator' }),
            el('dd', { text: window.rostered_operator }),
            el('dt', { text: 'Capacity table' }),
            el('dd', {
              children: [
                el('a', {
                  text: 'Edit capacity table',
                  attrs: { href: `/channels/${window.channel_id}/capacity` },
                }),
              ],
            }),
          ],
        }),
      ),
    );

    panel.appendChild(
      expander('Gate cards', expanders.cards, () => {
        expanders.cards = !expanders.cards;
        paintDetail();
      }, () =>
        el('ul', {
          class: 'plain-list',
          children: cards
            .filter((card) => card.state !== 'spent')
            .map((card) =>
              el('li', {
                class: 'card-row',
                children: [
                  el('span', { text: `${card.turnout}, ${card.kind === 'start' ? 'Start' : 'Finish'}` }),
                  el('span', { text: card.holder_code }),
                  el('span', { text: card.state }),
                  removeHolderButton(card),
                ],
              }),
            ),
        }),
      ),
    );

    panel.appendChild(
      expander('Notices', expanders.notices, () => {
        expanders.notices = !expanders.notices;
        paintDetail();
      }, () =>
        el('ul', {
          class: 'plain-list',
          children: notices.map((notice) =>
            el('li', {
              class: 'notice-row',
              children: [
                el('span', { text: notice.kind }),
                el('span', { text: notice.grower_name }),
                el('span', { text: notice.subject }),
                el('span', { text: notice.state === 'sent' ? 'Sent' : 'Queued' }),
              ],
            }),
          ),
        }),
      ),
    );
  };

  const removeHolderButton = (card: CardRecord): HTMLElement => {
    const button = el('button', {
      class: 'button',
      text: 'Remove holder',
      attrs: { type: 'button', 'aria-label': `Remove holder ${card.turnout}` },
    });
    button.addEventListener('click', () => {
      if (pending) return;
      pending = true;
      button.setAttribute('aria-disabled', 'true');
      setText(status, copy.handingOver);
      void (async () => {
        try {
          const reply = await api.post<{ card: CardRecord }>(
            `/api/gate-cards/${encodeURIComponent(card.id)}/remove-holder`,
          );
          setText(status, copy.cardHandedTo(reply.card.turnout, reply.card.holder_code));
        } catch (cause) {
          const failure = failureOf(cause);
          if (failure?.code === 'no_successor') setText(status, copy.noSuccessor);
          else if (failure?.code === 'card_not_open') setText(status, copy.cardNotOpen);
          else setText(status, failure?.message ?? '');
        } finally {
          pending = false;
          await refresh();
        }
      })();
    });
    return button;
  };

  const paintOrdersPanel = (window: WindowRecord): void => {
    const showRation = window.status !== 'closed' && orders.some((order) => order.status === 'requested');
    renderWhenChanged(panel, 'orders', () => {
      panel.appendChild(ordersTable.element);
    });
    if (showRation && !panel.contains(rationWindowButton)) panel.insertBefore(rationWindowButton, ordersTable.element);
    if (!showRation && panel.contains(rationWindowButton)) rationWindowButton.remove();

    const signature = orders
      .map((order) =>
        [
          order.number,
          order.turnout,
          order.grower_name,
          order.volume_ml,
          order.requested_ml,
          order.status,
          order.conflict ?? '',
          order.rationed,
          order.closed_after_flow,
          window.status,
          hasOpenFinishCard(order.number),
        ].join('|'),
      )
      .join('\u0001');
    if (ordersTable.body.dataset.signature === signature) return;
    ordersTable.body.dataset.signature = signature;
    clear(ordersTable.body);
    rowViews.clear();

    for (const order of orders) {
      const volume = el('span', { class: 'tabular', text: order.volume_ml });
      const volumeCell: (HTMLElement | string)[] = [volume];
      if (order.rationed) {
        volumeCell.push(el('span', { class: 'asked', text: copy.askedVolume(order.requested_ml) }));
      }
      const actions = el('div', { class: 'row-actions' });
      const row = dataRow([
        { label: 'Order', content: el('a', { text: order.number, attrs: { href: `/orders/${order.number}` } }) },
        { label: 'Turnout', content: order.turnout },
        { label: 'Grower', content: order.grower_name },
        { label: 'Volume (ML)', content: volumeCell },
        { label: 'Status', content: boardOrderStatusLabel(order.status, order.conflict) },
        { label: 'Actions', content: actions },
      ]);
      paintRowActions(order, window, actions);
      ordersTable.body.appendChild(row);
      rowViews.set(order.number, { row, cells: {}, actions });
    }
  };

  const paintRowActions = (order: OrderRecord, window: WindowRecord, actions: HTMLElement): void => {
    clear(actions);
    const closed = window.status === 'closed';
    if (order.status === 'requested' && !closed) {
      actions.appendChild(orderAction('Schedule order', order.number, 'schedule'));
    }
    if (order.status === 'requested' || order.status === 'scheduled' || order.status === 'running') {
      actions.appendChild(orderAction('Close order', order.number, 'close'));
    }
    if (order.status === 'closed' && order.closed_after_flow && !closed && hasOpenFinishCard(order.number)) {
      actions.appendChild(orderAction('Reopen order', order.number, 'reopen'));
    }
  };

  const hasOpenFinishCard = (orderNumber: string): boolean =>
    cards.some((card) => card.order_number === orderNumber && card.kind === 'finish' && card.state === 'open');

  const orderAction = (label: string, orderNumber: string, action: 'schedule' | 'close' | 'reopen'): HTMLElement => {
    const button = el('button', {
      class: 'button',
      text: label.split(' ')[0] as string,
      attrs: { type: 'button', 'aria-label': `${label} ${orderNumber}`, 'aria-disabled': pending ? 'true' : 'false' },
    });
    button.addEventListener('click', () => {
      if (pending || button.getAttribute('aria-disabled') === 'true') return;
      pending = true;
      paintActionsDisabled();
      setText(status, copy.updatingOrder(orderNumber));
      void (async () => {
        try {
          const reply = await api.post<{ order: OrderRecord; window: WindowRecord }>(
            `/api/orders/${encodeURIComponent(orderNumber)}/${action}`,
          );
          applyWindow(reply.window);
          applyOrder(reply.order);
          setText(status, copy.orderNowStatus(reply.order.number, reply.order.status));
        } catch (cause) {
          const failure = failureOf(cause);
          await reloadOrders();
          setText(status, boardErrorCopy(failure?.code ?? null) ?? failure?.message ?? '');
        } finally {
          pending = false;
          paintDetail();
        }
      })();
    });
    return button;
  };

  const paintActionsDisabled = (): void => {
    for (const view of rowViews.values()) {
      for (const button of view.actions.querySelectorAll('button')) {
        button.setAttribute('aria-disabled', pending ? 'true' : 'false');
      }
    }
    rationWindowButton.setAttribute('aria-disabled', pending ? 'true' : 'false');
  };

  const paintRestrictionsPanel = (window: WindowRecord): void => {
    const signature = [
      'restrictions',
      window.id,
      window.restriction_cap_ml_day ?? '',
      window.restriction_effective_at ?? '',
      window.cap_volume_ml,
    ].join('|');
    if (panel.dataset.signature === signature) return;
    panel.dataset.signature = signature;
    clear(panel);
    if (window.restriction_cap_ml_day === null) {
      panel.appendChild(el('p', { text: 'No restriction on this window.' }));
      return;
    }
    panel.appendChild(
      el('dl', {
        class: 'details',
        children: [
          el('dt', { text: 'Cap (ML/day)' }),
          el('dd', { class: 'tabular', text: window.restriction_cap_ml_day }),
          el('dt', { text: 'Effective at' }),
          el('dd', { text: window.restriction_effective_at ?? '' }),
          el('dt', { text: 'Cap volume (ML)' }),
          el('dd', { class: 'tabular', text: window.cap_volume_ml }),
          el('dt', { text: 'Restriction' }),
          el('dd', {
            children: [
              window.restriction_id === null
                ? null
                : el('a', { text: window.restriction_id, attrs: { href: `/restrictions/${window.restriction_id}` } }),
            ],
          }),
        ],
      }),
    );
  };

  const paintDetail = (): void => {
    const window = selectedWindow();
    // The pane's frame is rebuilt only when the viewport or the selection
    // changes, so a live refresh never moves the control that holds focus.
    const mode = window === null ? 'empty' : window1280() ? 'region' : 'sheet';
    if (detailHost.dataset.mode !== mode) {
      detailHost.dataset.mode = mode;
      releaseDetail?.();
      releaseDetail = null;
      clear(detailHost);
      if (mode === 'empty') {
        detailHost.appendChild(
          el('div', {
            class: 'detail',
            attrs: { role: 'region', 'aria-label': 'Window detail' },
            children: [emptyDetail],
          }),
        );
      } else if (mode === 'region') {
        detailHost.appendChild(
          el('div', {
            class: 'detail',
            attrs: { role: 'region', 'aria-label': 'Window detail' },
            children: [detailBody],
          }),
        );
      } else {
        const sheet = el('div', {
          class: 'detail detail-sheet',
          attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Window detail' },
          children: [closeDetail, detailBody],
        });
        releaseDetail = trapFocus(sheet, closeDetailSheet);
        detailHost.appendChild(el('div', { class: 'overlay overlay-sheet', children: [sheet] }));
        closeDetail.focus();
      }
    }
    if (window === null) return;

    countTo(counterRemaining.figure, Number(counterRemaining.figure.textContent), Number(window.remaining_ml), formatMlNumber);
    countTo(counterDelivered.figure, Number(counterDelivered.figure.textContent), Number(window.delivered_ml), formatMlNumber);
    countTo(counterFlow.figure, Number(counterFlow.figure.textContent), Number(window.channel_flow_ml_day), formatMlNumber);

    for (const [name, button] of Object.entries(tabButtons) as [Tab, HTMLButtonElement][]) {
      button.setAttribute('aria-selected', name === state.tab ? 'true' : 'false');
      button.tabIndex = name === state.tab ? 0 : -1;
    }

    if (state.tab === 'capacity') paintCapacityPanel(window);
    else if (state.tab === 'orders') paintOrdersPanel(window);
    else paintRestrictionsPanel(window);
    paintActionsDisabled();
  };

  const window1280 = (): boolean => window.matchMedia(DESKTOP).matches;

  const applyWindow = (next: WindowRecord): void => {
    const index = windows.findIndex((window) => window.id === next.id);
    if (index >= 0) windows[index] = next;
    paintGrid();
  };

  const applyOrder = (next: OrderRecord): void => {
    const index = orders.findIndex((order) => order.number === next.number);
    if (index >= 0) orders[index] = next;
    else orders.push(next);
  };

  const reloadOrders = async (): Promise<void> => {
    if (state.windowId === null) return;
    const [orderReply, windowReply] = await Promise.all([
      api.get<{ orders: OrderRecord[] }>(`/api/orders?window=${encodeURIComponent(state.windowId)}`),
      api.get<{ window: WindowRecord }>(`/api/windows/${encodeURIComponent(state.windowId)}`),
    ]);
    orders = orderReply.orders;
    applyWindow(windowReply.window);
  };

  const paintAll = (): void => {
    paintRail();
    paintGrid();
    paintDetail();
  };

  const refresh = async (): Promise<void> => {
    const windowReply = await api.get<{ windows: WindowRecord[] }>('/api/windows');
    windows = windowReply.windows;
    if (state.windowId !== null) {
      const [orderReply, cardReply, noticeReply] = await Promise.all([
        api.get<{ orders: OrderRecord[] }>(`/api/orders?window=${encodeURIComponent(state.windowId)}`),
        api.get<{ cards: CardRecord[] }>(`/api/gate-cards?window=${encodeURIComponent(state.windowId)}`),
        api.get<{ notices: NoticeRecord[] }>(`/api/windows/${encodeURIComponent(state.windowId)}/notices`),
      ]);
      orders = orderReply.orders;
      cards = cardReply.cards;
      notices = noticeReply.notices;
    }
    paintGrid();
    if (!pending) paintDetail();
    if (rationDialog.isOpen()) paintRationBody();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'r' && event.key !== 'R') return;
    const target = event.target as HTMLElement | null;
    if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (state.windowId === null) return;
    event.preventDefault();
    openRestrictionDialog();
  };
  document.addEventListener('keydown', onKeydown);

  const channelReply = await api.get<{ channels: ChannelRecord[] }>('/api/channels');
  channels = channelReply.channels;
  await refresh();
  paintAll();

  return {
    element,
    refresh,
    destroy: () => {
      document.removeEventListener('keydown', onKeydown);
      restrictionDialog.destroy();
      rationDialog.destroy();
    },
  };
}

function boardErrorCopy(code: string | null): string | null {
  switch (code) {
    case 'illegal_transition':
      return copy.illegalTransition;
    case 'turnout_busy':
      return copy.turnoutBusy;
    case 'window_full':
      return copy.windowFullBoard;
    case 'allocation_exceeded':
      return copy.allocationExceeded;
    case 'not_reopenable':
      return copy.notReopenable;
    case 'window_closed':
      return copy.windowClosed;
    default:
      return null;
  }
}

function counter(label: string): { element: HTMLElement; figure: HTMLElement } {
  const figure = el('span', { class: 'counter-value tabular', text: '0.000' });
  const element = el('div', {
    class: 'counter',
    attrs: { role: 'group', 'aria-label': label },
    children: [el('span', { class: 'counter-label', text: label }), figure],
  });
  return { element, figure };
}

function tabButton(label: string): HTMLButtonElement {
  return el('button', {
    class: 'tab',
    text: label,
    attrs: { type: 'button', role: 'tab', 'aria-selected': 'false' },
  });
}

function expander(
  label: string,
  open: boolean,
  toggle: () => void,
  content: () => HTMLElement,
): HTMLElement {
  const button = el('button', {
    class: 'expander',
    text: label,
    attrs: { type: 'button', 'aria-expanded': open ? 'true' : 'false' },
  });
  button.addEventListener('click', toggle);
  return el('section', {
    class: 'expander-section',
    children: [button, open ? content() : null],
  });
}
