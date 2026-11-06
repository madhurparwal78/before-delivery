import { scentName } from '../../shared/catalog.js';
import { confirmationGoesTo, UI } from '../../shared/copy.js';
import { taxCodeLabel } from '../../shared/money.js';
import type { Order } from '../../shared/types.js';
import { api, ApiFailure } from '../api.js';
import { cash, locale, longDate } from '../i18n.js';
import { bind, el, say } from '../ui.js';
import { renderNotFound } from './not-found.js';

export async function renderPlaced(main: HTMLElement, params: Record<string, string>): Promise<void> {
  const number = params['number'] ?? '';
  let order: Order;
  try {
    order = await api.get<Order>(`/api/account/orders/${number}`);
  } catch (error) {
    if (error instanceof ApiFailure) {
      renderNotFound(main);
      return;
    }
    throw error;
  }
  const heading = el('h1', { class: 'page-heading' });
  const sentTo = el('p', { class: 'placed-note' });
  const lines = el('dl', { class: 'money-rows tabular' });
  const shipOn = el('p', { class: 'placed-ship tabular' });
  bind(() => {
    heading.textContent =
      locale() === 'fr-CA' ? `Commande ${order.number} passée` : `Order ${order.number} placed`;
    sentTo.textContent = say(confirmationGoesTo(order.email));
    while (lines.firstChild) lines.firstChild.remove();
    for (const line of order.lines) {
      lines.append(
        el('dt', {
          text: `${locale() === 'fr-CA' ? 'Pain' : 'Bar'} ${line.bar} \u00B7 ${line.batch} \u00B7 ${scentName(line.scent, locale())}`,
        }),
        el('dd', { text: cash(line.unit_price) }),
      );
    }
    lines.append(el('dt', { text: say(UI.lineSubtotal) }), el('dd', { text: cash(order.subtotal) }));
    lines.append(el('dt', { text: say(UI.lineShipping) }), el('dd', { text: cash(order.shipping_fee) }));
    for (const tax of order.taxes) {
      lines.append(
        el('dt', { text: taxCodeLabel(tax.code, locale()) }),
        el('dd', { text: cash(tax.amount) }),
      );
    }
    lines.append(el('dt', { text: say(UI.lineTotal) }), el('dd', { text: cash(order.total) }));
    shipOn.textContent = `${say(UI.lineShipping)}: ${longDate(order.ship_on)}`;
  });
  main.append(heading, sentTo, lines, shipOn);
}
