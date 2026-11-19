import { announce, setAlert, withPending } from '../announce.js';
import { api } from '../api.js';
import { copy } from '../copy.js';
import { clear, focus, h } from '../dom.js';
import { money, signedMoney } from '../../shared/format.js';
import { plate } from '../plates.js';
import { connectLive } from '../live.js';
import { navigate, onLeave, type RouteContext } from '../router.js';
import { mainRegion } from '../shell.js';
import { currentMember } from '../state.js';
import { openDialog } from '../components/dialog.js';
import { stepper } from '../components/stepper.js';
import type { WalletLine } from '../types.js';

interface WalletBody {
  balance_cents: number;
  lines: WalletLine[];
}

export function renderWallet(_ctx: RouteContext): void {
  const main = mainRegion();
  clear(main);
  if (!currentMember()) {
    navigate('/sign-in?next=%2Fwallet');
    return;
  }
  const heading = h('h1', { text: 'Wallet' });
  const balanceLine = h('p', { class: 'balance' });
  const listBox = h('div', { class: 'wallet-box' });
  const addSlot = h('div', { class: 'alert-slot' });

  const addMoney = h('button', { type: 'button', class: 'secondary', text: 'Add money' });
  addMoney.addEventListener('click', () => {
    openDialog({
      name: 'Add money',
      opener: addMoney,
      build: ({ close }) => {
        const amount = stepper({
          label: 'Amount in euros',
          min: 5,
          max: 200,
          step: 5,
          pageStep: 25,
          value: 20,
        });
        const slot = h('div', { class: 'alert-slot' });
        const confirm = h('button', { type: 'button', class: 'secondary', text: 'Add to wallet' });
        confirm.addEventListener('click', () => {
          void (async () => {
            const result = await withPending(confirm, () =>
              api<WalletBody>('POST', '/api/wallet/top-ups', {
                body: { amount_cents: amount.value() * 100 },
              }),
            );
            if (!result) return;
            if (!result.ok) {
              setAlert(slot, result.failure.message);
              return;
            }
            close();
            paint(result.data);
            announce(copy.walletAdded(amount.value() * 100));
          })();
        });
        return [
          h('span', { class: 'label', text: 'Amount in euros' }),
          amount.element,
          confirm,
          slot,
        ];
      },
    });
  });

  const paint = (body: WalletBody) => {
    balanceLine.textContent = `Balance ${money(body.balance_cents)}`;
    clear(listBox);
    if (body.lines.length === 0) {
      listBox.append(
        plate({
          seed: 'wallet-empty',
          leg: 'Brisanne to Tollemarch',
          kind: 'road',
          ratio: 1,
          className: 'plate-empty',
        }),
        h('p', { class: 'empty-line', text: copy.emptyWallet }),
      );
      return;
    }
    const list = h('ul', { 'aria-label': 'Wallet', class: 'wallet-list' });
    for (const line of body.lines) {
      list.appendChild(
        h('li', {
          'data-id': line.id,
          text: `${line.label} ${signedMoney(line.amount_cents)}`,
        }),
      );
    }
    listBox.appendChild(list);
  };

  const load = async () => {
    const result = await api<WalletBody>('GET', '/api/wallet');
    if (result.ok) paint(result.data);
  };

  main.append(heading, balanceLine, addMoney, addSlot, listBox);
  focus(heading);
  void load();

  const connection = connectLive({
    onHello: () => void load(),
    onEvent: () => void load(),
  });
  onLeave(() => connection.close());
}
