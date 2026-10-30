import type {
  BeekeeperOrderListItem,
  BrokerOrder,
  DropView,
  Grower,
  OrchardListItem,
  Settlement,
} from '../shared/api-types';
import { formatMoney } from '../shared/format';
import { TIER_ORDER, dropStatusLabel, tierLabel } from '../shared/labels';
import {
  formatCalendarDate,
  formatPacificTimeInput,
  pacificCalendarDate,
  pacificWallClockToInstant,
} from '../shared/pacific';
import { el, request, runAction } from './core';
import type { AnyOrder, DeskView } from './desk';
import { Dialog } from './dialog';
import { FormField } from './forms';
import { ariaTable } from './table';

function actionButton(label: string, onClick: (button: HTMLButtonElement) => void): HTMLButtonElement {
  const button = el('button', { type: 'button', class: 'button', text: label });
  button.dataset.label = label;
  button.addEventListener('click', () => onClick(button));
  return button;
}

function newKey(): string {
  return `bd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isoDateField(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/* ------------------------------- broker ---------------------------------- */

function newOrchardDialog(view: DeskView, opener: HTMLButtonElement, growers: Grower[]): Dialog {
  const grower = new FormField({
    name: 'grower_id',
    label: 'Grower',
    kind: 'select',
    options: [
      { value: '', label: 'Choose a grower' },
      ...growers.map((entry) => ({ value: entry.id, label: entry.name })),
    ],
  });
  const name = new FormField({ name: 'name', label: 'Orchard name', kind: 'text' });
  const county = new FormField({ name: 'county', label: 'County', kind: 'text' });
  const fields: FormField[] = [grower, name, county];
  const blockHost = el('div', { class: 'block-rows' });
  const blockFields: Array<{ name: FormField; acres: FormField }> = [];

  const addRow = (): void => {
    const index = blockFields.length;
    const blockName = new FormField({
      name: `blocks.${index}.name`,
      label: 'Block name',
      kind: 'text',
      value: `Block ${index + 1}`,
    });
    const acres = new FormField({
      name: `blocks.${index}.acres`,
      label: 'Acres',
      kind: 'number',
      min: 1,
      max: 500,
      step: '0.1',
      value: '20',
    });
    blockFields.push({ name: blockName, acres });
    fields.push(blockName, acres);
    blockHost.append(
      el('div', { class: 'block-row' }, [blockName.wrapper, acres.wrapper]),
    );
  };
  addRow();
  const addBlock = actionButton('Add block', () => addRow());
  addBlock.classList.add('button--quiet');

  const dialog = new Dialog({
    name: 'New orchard',
    opener,
    fields,
    extra: [blockHost, addBlock],
    submitLabel: 'Save orchard',
    submit: async (self) => {
      self.clearErrors();
      const result = await runAction({
        button: self.submitButton,
        pending: 'Saving orchard…',
        run: () =>
          request<OrchardListItem>('POST', '/api/orchards', {
            body: {
              grower_id: grower.value,
              name: name.value,
              county: county.value,
              blocks: blockFields.map((row) => ({
                name: row.name.value,
                acres: Number(row.acres.value),
              })),
            },
          }),
        success: (created) => `Orchard ${created.name} saved.`,
        onFailure: (failure) => self.showFailure(failure),
      });
      if (result !== null) {
        self.close();
        await view.refresh();
      }
    },
  });
  return dialog;
}

function newOrderDialog(
  view: DeskView,
  opener: HTMLButtonElement,
  orchards: readonly OrchardListItem[],
): Dialog {
  const orchardField = new FormField({
    name: 'orchard_id',
    label: 'Orchard',
    kind: 'select',
    options: [
      { value: '', label: 'Choose an orchard' },
      ...orchards.map((entry) => ({ value: entry.id, label: entry.name })),
    ],
    value: view.selectedOrchard()?.id ?? '',
  });
  const bloomStart = new FormField({
    name: 'bloom_start',
    label: 'Bloom start',
    kind: 'text',
    hint: 'Pacific calendar date, like 2027-02-08',
  });
  const bloomEnd = new FormField({
    name: 'bloom_end',
    label: 'Bloom end',
    kind: 'text',
    hint: 'Pacific calendar date, like 2027-03-01',
  });
  const deadline = new FormField({
    name: 'delivery_deadline',
    label: 'Delivery deadline',
    kind: 'text',
    hint: 'Pacific calendar date, on or before bloom start',
  });
  const fields: FormField[] = [orchardField, bloomStart, bloomEnd, deadline];
  const hiveHost = el('div', { class: 'block-rows' });
  let hiveFields: Array<{ blockId: string; field: FormField }> = [];

  const rebuildHives = (): void => {
    for (const entry of hiveFields) {
      const index = fields.indexOf(entry.field);
      if (index >= 0) fields.splice(index, 1);
    }
    hiveHost.replaceChildren();
    const orchard = orchards.find((entry) => entry.id === orchardField.value);
    hiveFields = (orchard?.blocks ?? []).map((block, index) => {
      const field = new FormField({
        name: `blocks.${index}.hives`,
        label: `Hives, ${block.name}`,
        kind: 'number',
        min: 1,
        max: 2000,
        step: '1',
        value: '40',
      });
      fields.push(field);
      hiveHost.append(field.wrapper);
      return { blockId: block.id, field };
    });
  };
  rebuildHives();
  orchardField.control.addEventListener('change', rebuildHives);

  return new Dialog({
    name: 'New order',
    opener,
    fields,
    extra: [hiveHost],
    submitLabel: 'Save draft',
    submit: async (self) => {
      self.clearErrors();
      const result = await runAction({
        button: self.submitButton,
        pending: 'Saving draft order…',
        run: () =>
          request<BrokerOrder>('POST', '/api/orders', {
            body: {
              orchard_id: orchardField.value,
              bloom_start: bloomStart.value,
              bloom_end: bloomEnd.value,
              delivery_deadline: deadline.value,
              blocks: hiveFields.map((entry) => ({
                block_id: entry.blockId,
                hives: Number(entry.field.value),
              })),
            },
          }),
        success: (created) => `Draft order ${created.ref} saved.`,
        onFailure: (failure) => self.showFailure(failure),
      });
      if (result !== null) {
        self.close();
        await view.refresh();
      }
    },
  });
}

function inspectionLinkDialog(view: DeskView, opener: HTMLButtonElement, order: AnyOrder): Dialog {
  const email = new FormField({
    name: 'inspector_email',
    label: 'Inspector email',
    kind: 'text',
    inputmode: 'email',
  });
  return new Dialog({
    name: 'Send inspection link',
    opener,
    fields: [email],
    submitLabel: 'Send link',
    submit: async (self) => {
      self.clearErrors();
      const address = email.value;
      const result = await runAction({
        button: self.submitButton,
        pending: 'Sending inspection link…',
        run: () =>
          request<unknown>('POST', `/api/orders/${order.id}/inspection-links`, {
            body: { inspector_email: address },
          }),
        success: () =>
          `Inspection link for ${order.ref} is on its way to ${address}. Any earlier link has stopped working.`,
        onFailure: (failure) => self.showFailure(failure),
      });
      if (result !== null) {
        self.close();
        await view.refresh();
      }
    },
  });
}

function settlementTable(settlement: Settlement): HTMLElement {
  const rows = [
    ...settlement.shares.map((share) => ({
      party: share.beekeeper.name,
      hives: String(share.hives),
      gross: formatMoney(share.gross_cents),
      amount: formatMoney(share.payout_cents),
    })),
    {
      party: 'Broker commission',
      hives: '—',
      gross: '—',
      amount: formatMoney(settlement.commission_cents),
    },
  ];
  return ariaTable(
    'Settlement split',
    [
      { label: 'Party', cell: (row: (typeof rows)[0]) => row.party },
      { label: 'Hives', cell: (row) => row.hives, numeric: true },
      { label: 'Gross', cell: (row) => row.gross, numeric: true },
      { label: 'Amount', cell: (row) => row.amount, numeric: true },
    ],
    rows,
    'No payouts yet.',
  );
}

async function openSettleDialog(
  view: DeskView,
  opener: HTMLButtonElement,
  order: AnyOrder,
): Promise<void> {
  const settlement = await request<Settlement>('GET', `/api/orders/${order.id}/settlement`);
  const received = new FormField({
    name: 'payment_received_on',
    label: 'Payment received',
    kind: 'text',
    value: pacificCalendarDate(new Date()),
    hint: 'Pacific calendar date the grower’s payment arrived',
  });
  const key = newKey();
  const orchardName = order.orchard.name;
  const dialog = new Dialog({
    name: 'Settle orchard',
    opener,
    fields: [received],
    extra: [
      settlementTable(settlement),
      el('p', {
        class: 'dialog__note',
        text: `Orchard payable ${formatMoney(settlement.payable_cents)}`,
      }),
    ],
    submitLabel: 'Settle',
    submit: async (self) => {
      self.clearErrors();
      const result = await runAction({
        button: self.submitButton,
        pending: `Settling ${orchardName}…`,
        run: () =>
          request<{ status: string }>('POST', `/api/orders/${order.id}/settle`, {
            body: { payment_received_on: received.value },
            idempotencyKey: key,
          }),
        success: (outcome) =>
          outcome.status === 'queued'
            ? 'Settlement queued: billing is unreachable. It will finish on its own when billing returns.'
            : `${orchardName} settled.`,
        onFailure: (failure) => self.showFailure(failure),
      });
      if (result !== null) {
        self.close();
        await view.refresh();
      }
    },
  });
  dialog.open();
}

function cancelOrderDialog(view: DeskView, opener: HTMLButtonElement, order: AnyOrder): Dialog {
  return new Dialog({
    name: 'Cancel order',
    opener,
    fields: [],
    extra: [
      el('p', {
        class: 'dialog__note',
        text: `Cancelling ${order.ref} voids its deposit invoice. Orders with delivered drops cannot be cancelled.`,
      }),
    ],
    submitLabel: `Cancel order ${order.ref}`,
    closeLabel: 'Keep order',
    submit: async (self) => {
      const result = await runAction({
        button: self.submitButton,
        pending: `Cancelling ${order.ref}…`,
        run: () => request<unknown>('POST', `/api/orders/${order.id}/cancel`, { body: {} }),
        success: () => `${order.ref} cancelled. Its deposit invoice is void.`,
        refusal: (failure) =>
          failure.status === 503
            ? `Billing is unreachable, so ${order.ref} is not cancelled. Try again in a minute.`
            : null,
      });
      if (result !== null) {
        self.close();
        await view.refresh();
      }
    },
  });
}

export function mountBrokerActions(view: DeskView): void {
  const order = view.order();
  const host = view.actionsHost;

  host.append(
    actionButton('New orchard', (button) => {
      void request<Grower[]>('GET', '/api/growers').then((growers) =>
        newOrchardDialog(view, button, growers).open(),
      );
    }),
    actionButton('New order', (button) => {
      newOrderDialog(view, button, view.orchards()).open();
    }),
  );
  if (order === null) return;

  host.append(
    actionButton('Open order', (button) => {
      void runAction({
        button,
        pending: `Opening ${order.ref}…`,
        run: () => request<unknown>('POST', `/api/orders/${order.id}/open`, { body: {} }),
        success: () => `${order.ref} is open to beekeepers. Deposit invoice recorded.`,
        refusal: (failure) =>
          failure.status === 503
            ? `Billing is unreachable, so ${order.ref} is still a draft. Try again in a minute.`
            : null,
      }).then(() => view.refresh());
    }),
    actionButton('Cancel order', (button) => {
      cancelOrderDialog(view, button, order).open();
    }),
    actionButton('Mark placed', (button) => {
      void runAction({
        button,
        pending: `Marking ${order.ref} placed…`,
        run: () => request<unknown>('POST', `/api/orders/${order.id}/place`, { body: {} }),
        success: () => `${order.ref} placed. The grower's placement confirmation is on its way.`,
      }).then(() => view.refresh());
    }),
    actionButton('Send inspection link', (button) => {
      inspectionLinkDialog(view, button, order).open();
    }),
    actionButton('Settle orchard', (button) => {
      void openSettleDialog(view, button, order);
    }),
  );
}

/* ------------------------------ beekeeper -------------------------------- */

function commitDialog(
  view: DeskView,
  opener: HTMLButtonElement,
  entry: BeekeeperOrderListItem,
): Dialog {
  const yard = new FormField({ name: 'yard_name', label: 'Yard name', kind: 'text' });
  const hives = new FormField({
    name: 'hives',
    label: 'Hives',
    kind: 'number',
    min: 1,
    max: entry.hives_remaining,
    step: '1',
    value: String(entry.hives_remaining),
  });
  return new Dialog({
    name: 'Commit truckload',
    opener,
    fields: [yard, hives],
    submitLabel: 'Commit',
    submit: async (self) => {
      self.clearErrors();
      const count = Number(hives.value);
      const result = await runAction({
        button: self.submitButton,
        pending: `Committing ${count} hives to ${entry.ref}…`,
        run: () =>
          request<DropView>('POST', `/api/orders/${entry.id}/drops`, {
            body: { yard_name: yard.value, hives: count },
          }),
        success: () => `${count} hives committed to ${entry.ref}.`,
        refusal: (failure) =>
          failure.code === 'not_enough_open_hives'
            ? `Only ${failure.remaining ?? 0} hives are still open on ${entry.ref}.`
            : null,
        onFailure: (failure) => {
          if (failure.code === 'not_enough_open_hives') {
            const remaining = failure.remaining ?? 0;
            hives.setMax(remaining);
            hives.setError(`Only ${remaining} hives are still open on ${entry.ref}.`);
            self.summary.show([
              {
                field: hives,
                message: `Only ${remaining} hives are still open on ${entry.ref}.`,
              },
            ]);
            updateRemaining(entry.id, remaining);
            return;
          }
          self.showFailure(failure);
        },
      });
      if (result !== null) {
        self.close();
        await view.refresh();
      }
    },
  });
}

function updateRemaining(orderId: string, remaining: number): void {
  for (const node of document.querySelectorAll<HTMLElement>(
    `[data-remaining-for="${orderId}"]`,
  )) {
    node.textContent = String(remaining);
  }
}

async function openLogDropDialog(
  view: DeskView,
  opener: HTMLButtonElement,
  drop: DropView,
): Promise<void> {
  const order = await request<AnyOrder>('GET', `/api/orders/${drop.order.id}`);
  const blocks = order.blocks.map((block) => ({ value: block.id, label: block.name }));
  const now = new Date();
  const block = new FormField({
    name: 'block_id',
    label: 'Block',
    kind: 'select',
    options: [{ value: '', label: 'Choose a block' }, ...blocks],
  });
  const date = new FormField({
    name: 'delivered_at',
    label: 'Delivery date',
    kind: 'text',
    value: pacificCalendarDate(now),
    hint: 'Pacific calendar date, like 2027-02-05',
  });
  const time = new FormField({
    name: 'delivery_time',
    label: 'Delivery time',
    kind: 'text',
    value: formatPacificTimeInput(now),
    hint: 'Pacific time on a 24-hour clock, like 14:30',
  });
  const dialog = new Dialog({
    name: 'Log drop',
    opener,
    fields: [block, date, time],
    submitLabel: 'Log drop',
    submit: async (self) => {
      self.clearErrors();
      if (!isoDateField(date.value)) {
        const message = 'Use a date like 2027-02-05';
        date.setError(message);
        self.summary.show([{ field: date, message }]);
        return;
      }
      const [hour, minute] = time.value.split(':');
      const instant = pacificWallClockToInstant({
        year: Number(date.value.slice(0, 4)),
        month: Number(date.value.slice(5, 7)),
        day: Number(date.value.slice(8, 10)),
        hour: Number(hour ?? '0'),
        minute: Number(minute ?? '0'),
      });
      const result = await runAction({
        button: self.submitButton,
        pending: 'Logging drop…',
        run: () =>
          request<DropView>('POST', `/api/drops/${drop.id}/deliver`, {
            body: { block_id: block.value, delivered_at: instant.toISOString() },
          }),
        success: (saved) =>
          `Drop logged: ${saved.hives} hives in ${saved.block?.name ?? ''}, delivered ${formatCalendarDate(saved.delivered_on as string)}.`,
        onFailure: (failure) => self.showFailure(failure),
      });
      if (result !== null) {
        self.close();
        await view.refresh();
      }
    },
  });
  dialog.open();
}

function payPerHiveSummary(entry: BeekeeperOrderListItem): string {
  return TIER_ORDER.map(
    (tier) => `${tierLabel(tier)} ${formatMoney(entry.pay_per_hive_cents[tier])}`,
  ).join(' · ');
}

export function mountBeekeeperActions(view: DeskView): void {
  const open = view.openOrders();
  const region = el('section', { class: 'open-orders', 'aria-label': 'Open orders' }, [
    el('h2', { class: 'section__title', text: 'Open orders' }),
  ]);
  if (open.length === 0) {
    region.append(el('p', { class: 'empty', text: 'No open orders right now.' }));
  }
  for (const entry of open) {
    const commit = actionButton(`Commit truckload to ${entry.ref}`, (button) => {
      commitDialog(view, button, entry).open();
    });
    commit.classList.add('button--primary');
    region.append(
      el('article', { class: 'open-order' }, [
        el('h3', { class: 'open-order__ref', text: `${entry.ref} · ${entry.orchard.name}` }),
        el('dl', { class: 'open-order__facts' }, [
          el('dt', { text: 'Deadline' }),
          el('dd', { class: 'figure', text: formatCalendarDate(entry.delivery_deadline) }),
          el('dt', { text: 'Still open' }),
          el('dd', { class: 'figure' }, [
            el('span', {
              'data-remaining-for': entry.id,
              text: String(entry.hives_remaining),
            }),
            ' hives',
          ]),
          el('dt', { text: 'Pay per hive' }),
          el('dd', { class: 'figure', text: payPerHiveSummary(entry) }),
        ]),
        commit,
      ]),
    );
  }

  const drops = view.myDrops();
  const dropsTable = ariaTable(
    'My drops',
    [
      {
        label: 'Drop',
        cell: (drop: DropView) =>
          el('a', {
            class: 'link',
            href: `/desk/drops/${drop.id}`,
            text: `View drop ${drop.yard_name}, ${drop.hives} hives`,
          }),
      },
      { label: 'Order', cell: (drop) => drop.order.ref },
      { label: 'Block', cell: (drop) => drop.block?.name ?? '—' },
      {
        label: 'Delivered',
        cell: (drop) =>
          drop.delivered_on === null ? '—' : formatCalendarDate(drop.delivered_on),
        numeric: true,
      },
      { label: 'Status', cell: (drop) => dropStatusLabel(drop.status) },
      {
        label: 'Action',
        cell: (drop) =>
          drop.status === 'committed'
            ? actionButton('Log drop', (button) => {
                void openLogDropDialog(view, button, drop);
              })
            : '—',
      },
    ],
    drops,
    "You haven't committed any truckloads yet.",
  );

  view.extrasHost.append(
    region,
    el('section', { class: 'my-drops' }, [
      el('h2', { class: 'section__title', text: 'My drops' }),
      dropsTable,
    ]),
  );
}
