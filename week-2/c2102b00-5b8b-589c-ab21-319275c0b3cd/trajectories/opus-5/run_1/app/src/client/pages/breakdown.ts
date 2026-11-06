import type { Bag, BagItem, CycleSummary } from '../../shared/types.ts';
import { errorCode, errorFields, newIdempotencyKey, request } from '../api.ts';
import { copy } from '../copy.ts';
import { clear, el, isBusy, setBusy } from '../dom.ts';
import { Dialog } from '../dialog.ts';
import type { Page, Shell } from './page.ts';

export function createBreakdownPage(shell: Shell): Page {
  const cycleList = el('ul', { class: 'cycle-list', 'aria-label': 'Cycles in breakdown' });
  const emptyMessage = el('p', { class: 'empty-cycle', text: copy.noBreakdown, hidden: true });
  const bagList = el('ul', { class: 'bag-list', 'aria-label': 'Bags' });
  const bagRegion = el('section', { class: 'bag-region', role: 'region', hidden: true });
  const element = el('main', { class: 'screen breakdown' }, [
    el('h1', { text: 'Breakdown' }),
    cycleList,
    emptyMessage,
    bagList,
    bagRegion,
  ]);

  let cycleId: string | null = null;
  let pickupDisplay = '';
  let bags: Bag[] = [];
  let openHousehold: string | null = null;
  let flagDialog: Dialog | null = null;
  let timer: number | null = null;
  let destroyed = false;

  let bagListSignature = '';

  function paintBagList(): void {
    const signature = bags.map((bag) => `${bag.household_code}:${bag.household_name}:${bag.packed}`).join('|');
    if (signature === bagListSignature) return;
    bagListSignature = signature;
    clear(bagList);
    for (const bag of bags) {
      const button = el('button', {
        type: 'button',
        class: 'bag-button',
        'aria-label': `${bag.household_name} bag`,
      }) as HTMLButtonElement;
      button.append(
        el('span', { text: bag.household_name }),
        el('span', { class: 'bag-flag', text: bag.packed ? 'PACKED' : '' }),
      );
      button.addEventListener('click', () => {
        openHousehold = bag.household_code;
        paintBagRegion(true);
      });
      bagList.append(el('li', {}, [button]));
    }
  }

  const boxes = new Map<string, HTMLInputElement>();
  let regionHousehold: string | null = null;

  function paintBagRegion(moveFocus: boolean): void {
    const bag = bags.find((entry) => entry.household_code === openHousehold);
    if (!bag) {
      bagRegion.hidden = true;
      return;
    }
    bagRegion.hidden = false;
    bagRegion.setAttribute('aria-label', `${bag.household_name} bag`);
    if (regionHousehold !== bag.household_code) {
      regionHousehold = bag.household_code;
      boxes.clear();
      clear(bagRegion);
      bagRegion.append(el('h2', { class: 'section-heading', text: `${bag.household_name} BAG` }));
      for (const item of bag.items) {
        const box = el('input', {
          type: 'checkbox',
          id: `pack-${bag.household_code}-${item.product_id}`,
          'aria-label': `${item.units} of ${item.case_name}`,
        }) as HTMLInputElement;
        const flagButton = el('button', {
          type: 'button',
          class: 'flag-button',
          'aria-label': `Flag short: ${item.case_name}`,
          text: 'Flag short',
        }) as HTMLButtonElement;
        const currentItem = (): { bag: Bag; item: BagItem } | null => {
          const current = bags.find((entry) => entry.household_code === bag.household_code);
          const entry = current?.items.find((candidate) => candidate.product_id === item.product_id);
          return current && entry ? { bag: current, item: entry } : null;
        };
        flagButton.addEventListener('click', () => {
          const now = currentItem();
          if (now) openFlagDialog(now.bag, now.item, flagButton);
        });
        box.addEventListener('change', () => {
          const now = currentItem();
          if (now) void tick(now.bag, now.item, box);
        });
        boxes.set(item.product_id, box);
        bagRegion.append(
          el('div', { class: 'bag-row' }, [
            box,
            el('label', { for: box.id, class: 'bag-label', text: `${item.units} of ${item.case_name}` }),
            flagButton,
          ]),
        );
      }
    }
    for (const item of bag.items) {
      const box = boxes.get(item.product_id);
      if (box && !box.disabled && box.checked !== item.packed) box.checked = item.packed;
    }
    if (moveFocus) boxes.values().next().value?.focus();
  }

  async function tick(bag: Bag, item: BagItem, box: HTMLInputElement): Promise<void> {
    if (!cycleId) return;
    const wanted = box.checked;
    const hadFocus = document.activeElement === box;
    box.disabled = true;
    const reply = await request<Bag>(
      'PUT',
      `/api/cycles/${cycleId}/bags/${bag.household_code}/items/${item.product_id}`,
      { body: { packed: wanted }, idempotencyKey: newIdempotencyKey() },
    );
    box.disabled = false;
    if (hadFocus) box.focus();
    if (!reply.ok) {
      box.checked = !wanted;
      box.focus();
      if (errorCode(reply.body) === 'outside_pickup_window') {
        shell.say('bag', copy.outsideWindow(pickupDisplay));
      }
      return;
    }
    const updated = reply.body;
    bags = bags.map((entry) => (entry.household_code === updated.household_code ? updated : entry));
    paintBagList();
    const message = wanted
      ? copy.packed(item.units, item.case_name, bag.household_name)
      : copy.unpacked(item.units, item.case_name, bag.household_name);
    shell.say('bag', updated.packed && wanted ? `${message} ${copy.bagPacked(bag.household_name)}` : message);
  }

  function openFlagDialog(bag: Bag, item: BagItem, opener: HTMLButtonElement): void {
    const units = el('input', {
      type: 'number',
      min: '1',
      id: 'flag-units',
      class: 'units-spin',
      'aria-label': 'Units missing',
    }) as HTMLInputElement;
    const error = el('p', { class: 'field-error', id: 'flag-units-error' });
    const flag = el('button', { type: 'button', class: 'primary', text: 'Flag' }) as HTMLButtonElement;
    const cancel = el('button', { type: 'button', text: 'Cancel' }) as HTMLButtonElement;
    const dialog = new Dialog({
      title: 'Flag short',
      build: (body) => {
        body.append(
          el('p', { text: item.case_name }),
          el('label', { for: 'flag-units', class: 'label', text: 'UNITS MISSING' }),
          units,
          error,
        );
      },
      footer: [flag, cancel],
      initialFocus: () => units,
      returnFocus: () => (opener.isConnected ? opener : null),
    });
    flag.addEventListener('click', () => {
      void (async () => {
        if (!cycleId) return;
        if (isBusy(flag)) return;
        setBusy(flag, true, { busy: 'Saving...', idle: 'Flag' });
        const reply = await request('POST', `/api/cycles/${cycleId}/bags/${bag.household_code}/flags`, {
          body: { product_id: item.product_id, units: Number(units.value) },
          idempotencyKey: newIdempotencyKey(),
        });
        setBusy(flag, false, { busy: 'Saving...', idle: 'Flag' });
        if (reply.status === 201) {
          dialog.close();
          shell.say('bag', copy.flagged(Number(units.value), item.case_name));
          await load();
          return;
        }
        const text = errorFields(reply.body).units ?? copy.flagRangeError(item.units);
        error.textContent = text;
        units.setAttribute('aria-describedby', 'flag-units-error');
        shell.say('bag', text);
      })();
    });
    cancel.addEventListener('click', () => dialog.close());
    flagDialog?.destroy();
    flagDialog = dialog;
    dialog.open();
  }

  async function load(): Promise<void> {
    if (destroyed) return;
    const cycles = await request<{ cycles: CycleSummary[] }>('GET', '/api/cycles');
    if (!cycles.ok || destroyed) return;
    const breakdown = cycles.body.cycles.filter((cycle) => cycle.status === 'breakdown');
    clear(cycleList);
    for (const cycle of breakdown) {
      cycleList.append(el('li', {}, [el('span', { class: 'cycle-link', text: cycle.name })]));
    }
    emptyMessage.hidden = breakdown.length > 0;
    cycleList.hidden = breakdown.length === 0;
    const first = breakdown[0];
    if (!first) {
      cycleId = null;
      bags = [];
      paintBagList();
      bagRegion.hidden = true;
      return;
    }
    cycleId = first.id;
    const detail = await request<{ pickup_display: string | null }>('GET', `/api/cycles/${first.id}`);
    if (detail.ok) pickupDisplay = detail.body.pickup_display ?? '';
    const reply = await request<{ bags: Bag[] }>('GET', `/api/cycles/${first.id}/bags`);
    if (!reply.ok || destroyed) return;
    bags = reply.body.bags;
    const active = document.activeElement as HTMLElement | null;
    paintBagList();
    if (openHousehold) paintBagRegion(false);
    if (active && active.isConnected && document.activeElement !== active) active.focus();
  }

  return {
    element,
    start() {
      void load();
      timer = window.setInterval(() => void load(), 10_000);
    },
    destroy() {
      destroyed = true;
      if (timer !== null) window.clearInterval(timer);
      flagDialog?.destroy();
    },
  };
}
