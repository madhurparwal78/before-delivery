import { scentName } from '../../../shared/catalog.js';
import { COLUMNS, STUDIO, UI } from '../../../shared/copy.js';
import type { PackingOrder } from '../../../shared/types.js';
import { api, ApiFailure } from '../../api.js';
import { locale } from '../../i18n.js';
import { announce } from '../../live.js';
import { everyPoll } from '../../store.js';
import { bind, bindText, el, refresh, say } from '../../ui.js';
import { reportStudioFailure, studioRegion } from './shell.js';
import { studioTable } from './table.js';

export async function renderPacking(body: HTMLElement): Promise<void> {
  const heading = el('h1', { class: 'page-heading' });
  bindText(heading, () => say(UI.packToday));
  const region = studioRegion();
  let orders: PackingOrder[] = [];
  const table = studioTable(() => say(UI.ordersToPack), [
    { label: COLUMNS.order },
    { label: COLUMNS.shipOn },
    { label: COLUMNS.recipient },
    { label: COLUMNS.address },
    { label: COLUMNS.bars },
    { label: COLUMNS.actions },
  ]);

  const load = async (): Promise<void> => {
    try {
      const payload = await api.get<{ orders: PackingOrder[] }>('/api/staff/packing');
      orders = payload.orders;
      refresh();
    } catch (error) {
      reportStudioFailure(error, STUDIO.forbidden);
    }
  };

  const ship = (order: PackingOrder): void => {
    void (async () => {
      try {
        await api.post(`/api/staff/orders/${order.number}/ship`);
        announce('studio', STUDIO.shipped(order.number));
      } catch (error) {
        if (error instanceof ApiFailure && error.code === 'already_shipped') {
          announce('studio', STUDIO.alreadyShipped(order.number));
        } else if (error instanceof ApiFailure && error.code === 'order_refunded') {
          announce('studio', STUDIO.orderRefunded(order.number));
        } else {
          reportStudioFailure(error, STUDIO.forbidden);
        }
      }
      await load();
    })();
  };

  bind(() => {
    table.setRows(
      orders.map((order) => {
        const button = el('button', {
          type: 'button',
          class: 'button secondary',
          text:
            locale() === 'fr-CA'
              ? `Marquer ${order.number} expédiée`
              : `Mark ${order.number} shipped`,
        });
        button.addEventListener('click', () => ship(order));
        return [
          order.number,
          order.ship_on,
          order.name,
          `${order.address.line1}, ${order.address.city} ${order.address.province} ${order.address.postal_code}`,
          order.bars
            .map((bar) => `${bar.batch} \u00B7 ${bar.bar} \u00B7 ${scentName(bar.scent, locale())}`)
            .join(' / '),
          button,
        ];
      }),
    );
  });

  body.append(heading, table.element, region);
  await load();
  everyPoll(load);
}
