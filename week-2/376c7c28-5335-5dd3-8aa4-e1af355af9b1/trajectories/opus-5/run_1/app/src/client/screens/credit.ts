import { get, newIdempotencyKey, post, RequestFailed } from '../api.ts';
import type { ScreenRender } from '../app.ts';
import { openDialog } from '../dialog.ts';
import { el, replace } from '../dom.ts';
import { dollars, money } from '../format.ts';
import { failureCopy, Region, withPending } from '../feedback.ts';
import { onLive } from '../live.ts';
import type { CreditView, Pack } from '../types.ts';

export const renderCredit: ScreenRender = ({ mount }) => {
  const balanceLine = el('p', { class: 'mono huge' });
  const cardLine = el('p', { class: 'label' });
  const balanceRegion = el('section', {
    class: 'panel',
    role: 'region',
    'aria-label': 'Credit balance',
  }, [el('h1', { class: 'heading', text: 'CREDIT' }), balanceLine, cardLine]);
  const packRow = el('div', { class: 'pack-row' });
  const ledgerBody = el('tbody');
  const region = new Region('Credit status');

  mount.appendChild(
    el('div', { class: 'stack' }, [
      balanceRegion,
      el('section', { class: 'panel' }, [packRow, region.node]),
      el('section', { class: 'panel' }, [
        el('table', { class: 'table ledger', 'aria-label': 'Ledger' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { scope: 'col', text: 'Movement' }),
              el('th', { scope: 'col', text: 'Account' }),
              el('th', { scope: 'col', text: 'Amount' }),
            ]),
          ]),
          ledgerBody,
        ]),
      ]),
    ]),
  );

  let view: CreditView | null = null;

  const draw = (): void => {
    if (!view) return;
    balanceLine.textContent =
      view.balance_cents < 0
        ? `OWING $${dollars(-view.balance_cents)}`
        : `BALANCE $${dollars(view.balance_cents)}`;
    cardLine.textContent = view.card_status === 'on_file' ? 'CARD ON FILE' : 'NO CARD ON FILE';
    replace(
      ledgerBody,
      view.entries.map((entry) =>
        el('tr', {}, [
          el('td', { text: entry.kind }),
          el('td', { text: entry.account }),
          el('td', { class: 'mono', text: money(entry.amount_cents) }),
        ]),
      ),
    );
  };

  const load = async (): Promise<void> => {
    view = await get<CreditView>('/api/me/credit').catch(() => view);
    draw();
  };

  const buy = (pack: Pack, opener: HTMLButtonElement): void => {
    const key = newIdempotencyKey();
    const confirm = el('button', { type: 'button', class: 'btn primary', text: 'CONFIRM PURCHASE' });
    const cancel = el('button', { type: 'button', class: 'btn ghost', text: 'CANCEL' });
    const dialog = openDialog({
      label: 'Buy credit',
      opener,
      children: [
        el('h2', { class: 'heading small', text: `BUY ${pack.name.toUpperCase()}` }),
        el('p', { class: 'mono big', text: `$${dollars(pack.amount_cents)}` }),
        el('div', { class: 'row' }, [confirm, cancel]),
      ],
    });
    cancel.addEventListener('click', () => dialog.close());
    confirm.addEventListener('click', () => {
      void withPending(region, confirm, 'Processing payment…', async () => {
        try {
          const answer = await post<{ balance_cents: number; purchase: { status: string } }>(
            `/api/credit-packs/${pack.id}/purchase`,
            {},
            key,
          );
          dialog.close();
          await load();
          if (answer.purchase.status === 'completed') {
            region.say(`Credit added. Balance $${dollars(answer.balance_cents)}.`);
          } else {
            region.say(
              'Payment sent to billing. Your balance updates as soon as billing confirms it.',
            );
          }
        } catch (error) {
          if (!(error instanceof RequestFailed)) throw error;
          dialog.close();
          region.say(
            failureCopy(error.failure, {
              no_card_on_file: 'Add a card at the front desk before buying credit.',
              pack_limit_reached:
                'You can buy at most 3 credit packs a day. Try again after midnight studio time.',
              billing_unavailable:
                'Billing is unavailable. Try again in a few minutes; this purchase is never charged twice.',
            }),
          );
        }
      });
    });
  };

  void (async () => {
    const packs = await get<Pack[]>('/api/credit-packs').catch(() => [] as Pack[]);
    replace(
      packRow,
      packs.map((pack) => {
        const button = el('button', {
          type: 'button',
          class: 'btn primary',
          'aria-label': `Buy ${pack.name}`,
          text: `BUY ${pack.name.toUpperCase()}`,
        });
        button.addEventListener('click', () => buy(pack, button));
        return button;
      }),
    );
    await load();
  })();

  return onLive((message) => {
    if (message.kind === 'credit' || message.kind === 'charge') void load();
  });
};
