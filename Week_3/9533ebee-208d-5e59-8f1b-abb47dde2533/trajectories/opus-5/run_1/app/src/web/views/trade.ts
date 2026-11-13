/**
 * The Trade view. Every input asks the server for a preview of the exact
 * typed amount, and the preview shows only the reply to the latest input.
 */

import { ASSET_CODES, type Asset } from '../../domain/assets.ts';
import { PREVIEW_PROMPT, STALE_SWAPS } from '../../domain/copy.ts';
import { formatAmount, formatPriceFromApi } from '../../domain/deskformat.ts';
import { formatWallTime } from '../../domain/desktime.ts';
import { ApiProblem, request } from '../api.ts';
import { clear, el, labelled, setText } from '../dom.ts';
import { applyFieldErrors, button, Field, whilePending } from '../parts/fields.ts';
import type { LiveRegions } from '../parts/live.ts';
import { store } from '../store.ts';
import type { PreviewDto, QuoteDto, SwapDto } from '../types.ts';
import { amountUnits } from './supply.ts';
import { freshKey, type View } from './view.ts';

export function tradeView(live: LiveRegions, navigate: (path: string) => void): View {
  const payWith = el('select', { class: 'chooser', 'aria-label': 'Pay with' });
  const receive = el('select', { class: 'chooser', 'aria-label': 'Receive' });
  for (const asset of ASSET_CODES) {
    payWith.append(el('option', { value: asset, text: asset }));
    receive.append(el('option', { value: asset, text: asset }));
  }
  payWith.value = 'MBTC';
  receive.value = 'QUSD';

  const from = (): Asset => payWith.value as Asset;
  const to = (): Asset => receive.value as Asset;

  const amount = new Field('Amount to pay', {
    kind: 'amount',
    decimals: () => store.decimalsOf(from()),
  });
  const swapsPaused = el('p', { class: 'paused' });

  const preview = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Swap preview',
    class: 'preview',
  });

  const quoteButton = button('Get firm quote');
  amount.submitsWith(quoteButton);
  const quoteRegion = el('section', { class: 'quote', 'aria-label': 'Firm quote' });
  quoteRegion.setAttribute('role', 'region');
  const swapButton = button('Swap now');
  const receiptRegion = el('section', {
    class: 'receipt-region',
    'aria-label': 'Swap receipt',
  });
  receiptRegion.setAttribute('role', 'region');

  let quote: QuoteDto | null = null;
  /** Only the reply to the latest input is ever shown. */
  let previewSequence = 0;
  let swapKey = freshKey();
  let swapSignature = '';

  setText(preview, PREVIEW_PROMPT);

  async function runPreview(): Promise<void> {
    previewSequence += 1;
    const mine = previewSequence;
    clear(quoteRegion);
    quote = null;

    if (amount.value.trim() === '') {
      if (mine === previewSequence) setText(preview, PREVIEW_PROMPT);
      return;
    }
    if (!amount.validate() || !amount.ready) return;

    const units = amountUnits(amount.value, store.decimalsOf(from()));
    const query = `from_asset=${from()}&to_asset=${to()}&amount_in=${units}`;
    try {
      const reply = await request<PreviewDto>('GET', `/api/swap/preview?${query}`, {
        token: store.token,
      });
      if (mine !== previewSequence) return;
      clear(preview);
      preview.append(
        el('span', {
          text: `Pool fee ${formatAmount(BigInt(reply.fee), store.decimalsOf(from()))} ${from()}`,
        }),
        el('span', {
          text: `You receive ${formatAmount(BigInt(reply.amount_out), store.decimalsOf(to()))} ${to()}`,
        }),
      );
    } catch (error) {
      // A reply to an earlier input is never shown, even when it arrives last.
      if (mine !== previewSequence) return;
      if (error instanceof ApiProblem) {
        const message = error.status === 422 ? firstFieldMessage(error) : error.detail;
        setText(preview, message);
        return;
      }
      live.report(error);
    }
  }

  function firstFieldMessage(problem: ApiProblem): string {
    const named = problem.errors['amount_in'] ?? Object.values(problem.errors)[0];
    return named ?? problem.detail;
  }

  amount.input.addEventListener('input', () => void runPreview());
  for (const chooser of [payWith, receive]) {
    chooser.addEventListener('change', () => {
      update();
      void runPreview();
    });
  }

  quoteButton.addEventListener('click', () => void getQuote());
  swapButton.addEventListener('click', () => void doSwap());

  async function getQuote(): Promise<void> {
    if (!amount.validate() || !amount.ready) {
      amount.focus();
      return;
    }
    live.clearProblems();
    live.announce('Getting quote');
    try {
      await whilePending(quoteButton, async () => {
        const reply = await request<QuoteDto>('POST', '/api/swap/quotes', {
          token: store.token,
          body: {
            from_asset: from(),
            to_asset: to(),
            amount_in: amountUnits(amount.value, store.decimalsOf(from())),
          },
        });
        quote = reply;
        renderQuote(reply);
        live.announce(
          `Quote ready. Firm until ${formatWallTime(Date.parse(reply.expires_at), store.deskTimeZone)}.`,
        );
      });
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 422) {
        live.validation(applyFieldErrors([{ name: 'amount_in', field: amount }], error.errors));
      } else {
        live.report(error);
      }
    }
  }

  function renderQuote(dto: QuoteDto): void {
    clear(quoteRegion);
    const fee = labelled('Pool fee');
    const out = labelled('You receive');
    const priceFrom = labelled(`${dto.from_asset} price`);
    const priceTo = labelled(`${dto.to_asset} price`);
    const firm = labelled('Firm until');
    setText(
      fee.value,
      `${formatAmount(BigInt(dto.fee), store.decimalsOf(dto.from_asset))} ${dto.from_asset}`,
    );
    setText(
      out.value,
      `${formatAmount(BigInt(dto.amount_out), store.decimalsOf(dto.to_asset))} ${dto.to_asset}`,
    );
    setText(priceFrom.value, formatPriceFromApi(dto.price_from));
    setText(priceTo.value, formatPriceFromApi(dto.price_to));
    setText(firm.value, formatWallTime(Date.parse(dto.expires_at), store.deskTimeZone));
    quoteRegion.append(
      el('h2', { class: 'zone-head', text: 'Firm quote' }),
      fee.row,
      out.row,
      priceFrom.row,
      priceTo.row,
      firm.row,
      swapButton,
    );
  }

  async function doSwap(): Promise<void> {
    const firm = quote;
    if (firm === null) return;
    if (firm.quote_id !== swapSignature) {
      swapSignature = firm.quote_id;
      swapKey = freshKey();
    }
    live.clearProblems();
    live.announce('Swapping');
    try {
      await whilePending(swapButton, async () => {
        const reply = await request<SwapDto>('POST', '/api/swaps', {
          token: store.token,
          body: { quote_id: firm.quote_id },
          idempotencyKey: swapKey,
        });
        renderReceipt(reply);
        live.announce(
          `Swapped ${formatAmount(BigInt(reply.amount_in), store.decimalsOf(reply.from_asset))} ${reply.from_asset} for ${formatAmount(BigInt(reply.amount_out), store.decimalsOf(reply.to_asset))} ${reply.to_asset}.`,
        );
        await store.refresh();
      });
    } catch (error) {
      live.report(error);
    }
  }

  function renderReceipt(dto: SwapDto): void {
    clear(receiptRegion);
    const inAmount = labelled('Amount in');
    const fee = labelled('Pool fee');
    const out = labelled('Amount out');
    const priceFrom = labelled(`${dto.from_asset} price`);
    const priceTo = labelled(`${dto.to_asset} price`);
    const id = labelled('Swap id', { figure: true });
    setText(
      inAmount.value,
      `${formatAmount(BigInt(dto.amount_in), store.decimalsOf(dto.from_asset))} ${dto.from_asset}`,
    );
    setText(
      fee.value,
      `${formatAmount(BigInt(dto.fee), store.decimalsOf(dto.from_asset))} ${dto.from_asset}`,
    );
    setText(
      out.value,
      `${formatAmount(BigInt(dto.amount_out), store.decimalsOf(dto.to_asset))} ${dto.to_asset}`,
    );
    setText(priceFrom.value, formatPriceFromApi(dto.price_from));
    setText(priceTo.value, formatPriceFromApi(dto.price_to));
    setText(id.value, dto.swap_id);
    receiptRegion.append(
      el('h2', { class: 'zone-head', text: 'Swap receipt' }),
      inAmount.row,
      fee.row,
      out.row,
      priceFrom.row,
      priceTo.row,
      id.row,
    );
  }

  const element = el('section', { class: 'worksheet-body' }, [
    el('h1', { class: 'view-head', text: 'Trade' }),
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'label', text: 'Pay with', for: 'pay-with' }),
        payWith,
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', text: 'Receive', for: 'receive' }),
        receive,
      ]),
    ]),
    amount.row,
    swapsPaused,
    preview,
    quoteButton,
    quoteRegion,
    receiptRegion,
  ]);
  payWith.id = 'pay-with';
  receive.id = 'receive';

  function update(): void {
    // While either chosen asset is stale, the view says swaps are paused.
    const fromPool = store.poolFor(from());
    const toPool = store.poolFor(to());
    const paused =
      fromPool?.market_state === 'stale_feed' || toPool?.market_state === 'stale_feed';
    setText(swapsPaused, paused ? STALE_SWAPS : '');
  }

  return { element, update, navigateAway: () => undefined, onPost: () => undefined, navigate };
}
