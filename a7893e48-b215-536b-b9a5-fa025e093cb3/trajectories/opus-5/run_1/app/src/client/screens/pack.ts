import type { PackLedger } from '../../shared/types.js';
import { api, idempotencyKey } from '../api.js';
import { delayedLabel, onStatusChange } from '../app.js';
import { copy, hours, money } from '../copy.js';
import { clear, el, setStatus, statusRegion } from '../dom.js';

const PACK_PRICE_CENTS = 56000;

export function packScreen(host: HTMLElement): void {
  const status = statusRegion('Pack status');
  const available = el('span', { class: 'pack-figure mono' }, ['0.00 h available']);
  const reserved = el('span', { class: 'pack-figure mono' }, ['0.00 h reserved']);
  const used = el('span', { class: 'pack-figure mono' }, ['0.00 h used']);
  const buy = el('button', { type: 'button', class: 'button primary', 'aria-label': 'Buy 20-hour pack' }, [
    delayedLabel(`Buy 20-hour pack · ${money(PACK_PRICE_CENTS)}`),
  ]);
  const body = el('tbody');
  const table = el('table', { class: 'data-table', 'aria-label': 'Pack ledger' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, ['When']),
        el('th', { scope: 'col' }, ['Movement']),
        el('th', { scope: 'col' }, ['Account']),
        el('th', { scope: 'col' }, ['Hours']),
        el('th', { scope: 'col' }, ['Booking']),
      ]),
    ]),
    body,
  ]);

  async function load(): Promise<void> {
    const result = await api.get<PackLedger>('/api/me/pack');
    if (!result.ok) return;
    available.textContent = `${hours(result.data.available_minutes)} h available`;
    reserved.textContent = `${hours(result.data.reserved_minutes)} h reserved`;
    used.textContent = `${hours(result.data.used_minutes)} h used`;
    clear(body);
    for (const entry of result.data.entries) {
      body.append(
        el('tr', {}, [
          el('td', { class: 'mono' }, [entry.created_at.replace('T', ' ').slice(0, 16)]),
          el('td', {}, [entry.reason]),
          el('td', {}, [entry.account]),
          el('td', { class: 'mono' }, [hours(entry.minutes)]),
          el('td', { class: 'mono' }, [entry.booking_id ?? '—']),
        ]),
      );
    }
  }

  buy.addEventListener('click', () => {
    setStatus(status, copy.buyingPack);
    void api
      .post<{ available_minutes: number }>('/api/packs', { product: '20h' }, idempotencyKey())
      .then(async (result) => {
        if (!result.ok) {
          setStatus(
            status,
            result.status === 503 ? copy.billingDelayedConfirm : result.error.message,
          );
          return;
        }
        setStatus(status, copy.packBought(result.data.available_minutes));
        await load();
      });
  });

  host.append(
    el('section', { role: 'region', 'aria-label': 'Hour pack', class: 'panel' }, [
      el('h1', {}, ['Hour pack']),
      el('div', { class: 'pack-figures' }, [available, reserved, used]),
      buy,
      status,
    ]),
    el('section', { class: 'panel' }, [
      el('h2', {}, ['Pack ledger']),
      el('div', { class: 'table-frame' }, [table]),
    ]),
  );
  void load();
  onStatusChange(() => {
    clear(buy);
    buy.append(delayedLabel(`Buy 20-hour pack · ${money(PACK_PRICE_CENTS)}`));
  });
}
