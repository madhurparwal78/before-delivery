import {
  actorLabel, deskAmountFieldError, deskAmountOf, deskHealthFactor, deskPercent, deskPriceFieldError,
  deskPriceOf, deskWallTime, parseDeskAmount, parseDeskPrice, parseDeskPercent, deskPercentField,
  parseDeskTime, deskDateTime,
} from './desk.js';
import { ApiError, NetworkError, getPositions, getQueue, getSettlement, getPostings, getLedgerTotals, request } from './api.js';
import type { Actor, AssetCode, Position, Posting, Settlement } from './types.js';
import { ASSET_CODES, ASSET_DECIMALS, STATE_LABELS } from './types.js';
import { announce, clearProblem, clearFieldError, createEl, setFieldError, showProblem } from './ui.js';
import type { WorldState } from './world.js';
import { ShockRuler } from './shock.js';
import { randomKey } from './uuid.js';

export interface ViewContext {
  main: HTMLElement;
  world: () => WorldState | null;
  actor: () => Actor | null;
  cleanup: (fn: () => void) => void;
}

export function reportError(err: unknown): void {
  if (err instanceof ApiError) {
    if (err.status === 422 && err.errors !== undefined) {
      const fields = Object.entries(err.errors);
      const links: Array<{ field: string; message: string }> = [];
      for (const [field, message] of fields) {
        const input = document.getElementById(field) as HTMLInputElement | null;
        if (input !== null) {
          setFieldError(input, message);
          links.push({ field, message });
        }
      }
      showProblem('Check the highlighted fields.', links);
      const first = document.getElementById(fields[0][0]) as HTMLInputElement | null;
      if (first !== null) first.focus();
      return;
    }
    showProblem(err.message);
    return;
  }
  if (err instanceof NetworkError) {
    showProblem(err.message);
    return;
  }
  showProblem('Something went wrong on our side \u2013 nothing is confirmed.');
}

export function isNetworkError(err: unknown): boolean {
  return err instanceof NetworkError;
}

function field(parent: HTMLElement, label: string, id: string, onEnter?: () => void): HTMLInputElement {
  const wrapper = createEl('div', '', 'field');
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  labelEl.setAttribute('for', id);
  const input = document.createElement('input');
  input.type = 'text';
  input.id = id;
  wrapper.append(labelEl, input);
  parent.append(wrapper);
  if (onEnter !== undefined) {
    input.addEventListener('keydown', (event): void => {
      if (event.key === 'Enter') {
        event.preventDefault();
        onEnter();
      }
    });
  }
  return input;
}

function button(parent: HTMLElement, label: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.setAttribute('aria-label', label);
  btn.addEventListener('click', (): void => {
    void onClick();
  });
  parent.append(btn);
  return btn;
}

function assetSelect(parent: HTMLElement, label: string, id: string): HTMLSelectElement {
  const wrapper = createEl('div', '', 'field');
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  labelEl.setAttribute('for', id);
  const select = document.createElement('select');
  select.id = id;
  select.setAttribute('aria-label', label);
  for (const code of ASSET_CODES) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = code;
    select.append(option);
  }
  wrapper.append(labelEl, select);
  parent.append(wrapper);
  return select;
}

function labelledValue(parent: HTMLElement, label: string, value: string): HTMLElement {
  const row = createEl('div', '', 'kv');
  const key = createEl('span', '', 'k');
  key.textContent = label;
  const val = createEl('span', '', 'v num');
  val.textContent = value;
  row.append(key, val);
  parent.append(row);
  return val;
}

function heading(parent: HTMLElement, text: string, level = 2): HTMLHeadingElement {
  const h = document.createElement(level === 1 ? 'h1' : 'h2');
  h.textContent = text;
  parent.append(h);
  return h;
}

/** Validate an amount field on input, showing its browser-side error. */
function amountValidator(input: HTMLInputElement, asset: () => AssetCode): void {
  input.addEventListener('input', (): void => {
    const decimals = ASSET_DECIMALS[asset()];
    const error = deskAmountFieldError(input.value, decimals);
    if (error === null) clearFieldError(input);
    else setFieldError(input, error);
  });
}

// ---------- Trade view ----------

export async function renderTrade(ctx: ViewContext): Promise<void> {
  const main = ctx.main;
  main.replaceChildren();
  heading(main, 'Trade');
  const paySelect = assetSelect(main, 'Pay with', 'pay-with');
  const receiveSelect = assetSelect(main, 'Receive', 'receive');
  receiveSelect.selectedIndex = 1;
  const amountInput = field(main, 'Amount to pay', 'amount-to-pay');
  const preview = createEl('div', 'Swap preview', 'status-role');
  preview.setAttribute('role', 'status');
  preview.textContent = 'Type an amount to see the output.';
  main.append(preview);
  const staleSwapLine = createEl('p', '', 'mono');
  staleSwapLine.id = 'stale-swap-line';
  main.append(staleSwapLine);

  const quoteButton = button(main, 'Get firm quote', (): void => {
    void submitQuote();
  });
  const quoteRegion = createEl('div', 'Firm quote', 'quoteregion');
  quoteRegion.setAttribute('role', 'region');
  main.append(quoteRegion);
  const receiptRegion = createEl('div', 'Swap receipt', 'swapreceipt');
  receiptRegion.setAttribute('role', 'region');
  main.append(receiptRegion);

  let previewSeq = 0;
  let currentQuote: { quote_id: string; amount_in: string; fee: string; amount_out: string; from_asset: string; to_asset: string } | null = null;
  let swapKey: string | null = null;

  const runPreview = (): void => {
    const seq = ++previewSeq;
    const from = paySelect.value;
    const to = receiveSelect.value;
    const raw = amountInput.value.trim();
    if (raw === '') {
      preview.textContent = 'Type an amount to see the output.';
      return;
    }
    const decimals = ASSET_DECIMALS[from as AssetCode];
    const amountIn = parseDeskAmount(raw, decimals);
    if (amountIn === null) {
      preview.textContent = 'Enter an amount above zero.';
      return;
    }
    void request<{ fee: string; amount_out: string }>('GET', `/api/swap/preview?from_asset=${from}&to_asset=${to}&amount_in=${amountIn}`)
      .then((result): void => {
        if (seq !== previewSeq) return;
        preview.textContent = `Pool fee ${deskAmountOf(result.data.fee, from as AssetCode)} ${from} and You receive ${deskAmountOf(result.data.amount_out, to as AssetCode)} ${to}`;
      })
      .catch((err): void => {
        if (seq !== previewSeq) return;
        if (err instanceof ApiError) {
          if (err.status === 422 && err.errors !== undefined) {
            const amountError = err.errors.amount_in ?? err.errors.amount ?? 'Enter an amount above zero.';
            preview.textContent = amountError;
            return;
          }
          preview.textContent = err.message;
          return;
        }
        preview.textContent = 'Couldn\u2019t reach Quillmoor. Press the same button again to retry safely.';
      });
  };

  const clearQuote = (): void => {
    currentQuote = null;
    quoteRegion.replaceChildren();
  };

  const inputs = [paySelect, receiveSelect, amountInput];
  for (const input of inputs) {
    input.addEventListener('input', (): void => {
      clearQuote();
      runPreview();
    });
  }
  amountInput.addEventListener('keydown', (event): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitQuote();
    }
  });
  amountValidator(amountInput, (): AssetCode => paySelect.value as AssetCode);

  async function submitQuote(): Promise<void> {
    const from = paySelect.value as AssetCode;
    const decimals = ASSET_DECIMALS[from];
    const amountIn = parseDeskAmount(amountInput.value, decimals);
    if (amountIn === null) {
      setFieldError(amountInput, 'Enter an amount above zero.');
      amountInput.focus();
      return;
    }
    clearProblem();
    announce('Getting quote');
    quoteButton.disabled = true;
    try {
      const result = await request<{
        quote_id: string; from_asset: string; to_asset: string; amount_in: string; fee: string; amount_out: string;
        price_from: string; price_to: string; expires_at: string;
      }>('POST', '/api/swap/quotes', {
        from_asset: from,
        to_asset: receiveSelect.value,
        amount_in: amountIn,
      });
      currentQuote = result.data;
      quoteRegion.replaceChildren();
      labelledValue(quoteRegion, 'Pool fee', `${deskAmountOf(result.data.fee, from)} ${from}`);
      labelledValue(quoteRegion, 'You receive', `${deskAmountOf(result.data.amount_out, result.data.to_asset as AssetCode)} ${result.data.to_asset}`);
      labelledValue(quoteRegion, `${result.data.from_asset} price`, deskPriceOf(result.data.price_from));
      labelledValue(quoteRegion, `${result.data.to_asset} price`, deskPriceOf(result.data.price_to));
      labelledValue(quoteRegion, 'Firm until', deskWallTime(new Date(result.data.expires_at)));
      announce(`Quote ready. Firm until ${deskWallTime(new Date(result.data.expires_at))}.`);
    } catch (err) {
      reportError(err);
    } finally {
      quoteButton.disabled = false;
    }
  }

  const swapNow = button(main, 'Swap now', async (): Promise<void> => {
    if (currentQuote === null) return;
    if (swapKey === null) swapKey = randomKey();
    clearProblem();
    announce('Swapping');
    swapNow.disabled = true;
    try {
      const result = await request<{
        swap_id: string; amount_in: string; fee: string; amount_out: string; from_asset: string; to_asset: string;
        price_from: string; price_to: string;
      }>('POST', '/api/swaps', { quote_id: currentQuote.quote_id }, { 'Idempotency-Key': swapKey });
      receiptRegion.replaceChildren();
      labelledValue(receiptRegion, 'Amount in', `${deskAmountOf(result.data.amount_in, result.data.from_asset as AssetCode)} ${result.data.from_asset}`);
      labelledValue(receiptRegion, 'Pool fee', `${deskAmountOf(result.data.fee, result.data.from_asset as AssetCode)} ${result.data.from_asset}`);
      labelledValue(receiptRegion, 'Amount out', `${deskAmountOf(result.data.amount_out, result.data.to_asset as AssetCode)} ${result.data.to_asset}`);
      labelledValue(receiptRegion, `${result.data.from_asset} price`, deskPriceOf(result.data.price_from));
      labelledValue(receiptRegion, `${result.data.to_asset} price`, deskPriceOf(result.data.price_to));
      labelledValue(receiptRegion, 'Swap id', result.data.swap_id);
      announce(`Swapped ${deskAmountOf(result.data.amount_in, result.data.from_asset as AssetCode)} ${result.data.from_asset} for ${deskAmountOf(result.data.amount_out, result.data.to_asset as AssetCode)} ${result.data.to_asset}.`);
      swapKey = null;
      void refreshWorld();
    } catch (err) {
      reportError(err);
      if (err instanceof ApiError && (err.status === 410 || err.status === 409)) swapKey = null;
    } finally {
      swapNow.disabled = false;
    }
  });

  const refreshWorld = async (): Promise<void> => {
    const fresh = ctx.world();
    if (fresh === null) return;
    const fromStale = fresh.pools.find((pool): boolean => pool.asset === paySelect.value)?.market_state === 'stale_feed';
    const toStale = fresh.pools.find((pool): boolean => pool.asset === receiveSelect.value)?.market_state === 'stale_feed';
    staleSwapLine.textContent = fromStale || toStale ? 'Swaps are paused while the price feed is stale.' : '';
  };
  void refreshWorld();

  paySelect.addEventListener('change', refreshWorld);
  receiveSelect.addEventListener('change', refreshWorld);
}

// ---------- Borrow view ----------

export async function renderBorrow(ctx: ViewContext): Promise<void> {
  const main = ctx.main;
  main.replaceChildren();
  heading(main, 'Borrow');
  const collateralSelect = assetSelect(main, 'Collateral asset', 'collateral-asset');
  const debtSelect = assetSelect(main, 'Borrow asset', 'borrow-asset');
  debtSelect.selectedIndex = 1;
  const collateralInput = field(main, 'Collateral amount', 'collateral-amount');
  amountValidator(collateralInput, (): AssetCode => collateralSelect.value as AssetCode);
  const openButton = button(main, 'Open position', async (): Promise<void> => {
    const collateral = parseDeskAmount(collateralInput.value, ASSET_DECIMALS[collateralSelect.value as AssetCode]);
    if (collateral === null) {
      setFieldError(collateralInput, 'Enter an amount above zero.');
      collateralInput.focus();
      return;
    }
    clearProblem();
    announce('Opening position');
    openButton.disabled = true;
    try {
      const result = await request<Position>('POST', '/api/positions', {
        collateral_asset: collateralSelect.value,
        debt_asset: debtSelect.value,
        collateral_amount: collateral,
      });
      announce(`Position opened with ${deskAmountOf(result.data.collateral_amount, result.data.collateral_asset)} ${result.data.collateral_asset} collateral.`);
      await loadPositions();
      const link = document.querySelector(`a[href="/positions/${result.data.position_id}"]`);
      if (link !== null) {
        link.setAttribute('data-new-position', 'true');
      }
    } catch (err) {
      reportError(err);
    } finally {
      openButton.disabled = false;
    }
  });
  collateralInput.addEventListener('keydown', (event): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      openButton.click();
    }
  });

  const list = createEl('ul', 'My positions', 'poslist');
  main.append(list);
  const loadPositions = async (): Promise<void> => {
    try {
      const result = await getPositions();
      list.replaceChildren();
      for (const position of result.positions) {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = `/positions/${position.position_id}`;
        link.textContent = `Position ${position.position_id}`;
        link.setAttribute('aria-label', `Position ${position.position_id}`);
        link.addEventListener('click', (event): void => {
          event.preventDefault();
          window.history.pushState({}, '', link.getAttribute('href') ?? '/borrow');
          window.dispatchEvent(new PopStateEvent('popstate'));
        });
        li.append(link);
        const detail = createEl('span', '', 'mono');
        detail.textContent = `${STATE_LABELS[position.state]} ${deskHealthFactor(position.health_factor)}`;
        li.append(detail);
        list.append(li);
      }
    } catch {
      // leave the list as it is
    }
  };
  await loadPositions();
  ctx.cleanup((): void => {
    void loadPositions();
  });
  const timer = setInterval((): void => {
    void loadPositions();
  }, 5_000);
  ctx.cleanup((): void => clearInterval(timer));
}

// ---------- Position view ----------

export async function renderPosition(ctx: ViewContext, positionId: string): Promise<void> {
  const main = ctx.main;
  main.replaceChildren();
  const load = async (): Promise<Position | null> => {
    try {
      const result = await request<Position>('GET', `/api/positions/${encodeURIComponent(positionId)}`);
      return result.data;
    } catch (err) {
      reportError(err);
      return null;
    }
  };
  const initial = await load();
  if (initial === null) return;

  const title = document.createElement('h1');
  title.textContent = `Position ${positionId}`;
  main.append(title);

  const plumb = createEl('div', '', 'plumb');
  plumb.setAttribute('role', 'img');
  plumb.setAttribute('aria-label', initial.health_factor === null
    ? 'Health factor: no debt'
    : `Health factor ${deskHealthFactor(initial.health_factor)}`);
  const line = createEl('div', '', 'line');
  const one = createEl('div', '', 'one');
  const warn = createEl('div', '', 'warn');
  plumb.append(line, one, warn);
  const marker = createEl('div', '', 'marker');
  plumb.append(marker);
  const labels = createEl('div', '', 'labels');
  labels.append(
    (() => { const span = document.createElement('span'); span.textContent = '0,0000'; return span; })(),
    (() => { const span = document.createElement('span'); span.textContent = '1,0000'; return span; })(),
    (() => { const span = document.createElement('span'); span.textContent = '2,0000'; return span; })(),
  );
  plumb.append(labels);
  main.append(plumb);
  const setPlumb = (hf: string | null): void => {
    if (hf === null) {
      marker.style.display = 'none';
      return;
    }
    const value = Number.parseFloat(hf);
    if (value > 2) {
      marker.style.display = '';
      marker.style.left = '100%';
      return;
    }
    marker.style.display = '';
    marker.style.left = `${(value / 2) * 100}%`;
  };
  setPlumb(initial.health_factor);

  const stateRegion = createEl('div', 'Position state', 'status-role');
  stateRegion.setAttribute('role', 'status');
  main.append(stateRegion);
  labelledValue(main, 'Debt', `${deskAmountOf(initial.debt, initial.debt_asset)} ${initial.debt_asset}`).id = 'position-debt';
  labelledValue(main, 'Collateral', `${deskAmountOf(initial.collateral_amount, initial.collateral_asset)} ${initial.collateral_asset}`).id = 'position-collateral';
  labelledValue(main, 'Health factor', deskHealthFactor(initial.health_factor)).id = 'position-hf';
  labelledValue(main, 'Liquidation price', initial.liquidation_price === null ? 'No debt' : deskPriceOf(initial.liquidation_price)).id = 'position-liq-price';
  const graceValue = labelledValue(main, 'Grace ends', initial.grace_ends_at === null ? '' : deskWallTime(new Date(initial.grace_ends_at)));
  graceValue.parentElement?.classList.toggle('hidden', initial.grace_ends_at === null);
  graceValue.parentElement?.setAttribute('data-label', 'Grace ends');

  // The owner's action forms: only the owning borrower can act on the position.
  const acting = ctx.actor();
  const ownerActions = document.createElement('div');
  if (acting !== null && acting.actor_id === initial.borrower_id) {
    main.append(ownerActions);
  }

  const drawInput = field(ownerActions, 'Draw amount', 'draw-amount');
  amountValidator(drawInput, (): AssetCode => initial.debt_asset);
  let drawKey: string | null = null;
  let drawBody: { amount: string } | null = null;
  let drawLost = false;
  const drawButton = button(ownerActions, 'Draw', async (): Promise<void> => {
    const amount = parseDeskAmount(drawInput.value, ASSET_DECIMALS[initial.debt_asset]);
    if (amount === null) {
      setFieldError(drawInput, 'Enter an amount above zero.');
      drawInput.focus();
      return;
    }
    if (drawKey === null) drawKey = randomKey();
    drawBody = { amount };
    clearProblem();
    announce('Drawing');
    drawButton.disabled = true;
    retryButton.hidden = false;
    try {
      const result = await request<Settlement & { debt_after: string; health_factor_after: string | null; state_after: string }>(
        'POST',
        `/api/positions/${encodeURIComponent(positionId)}/draws`,
        drawBody,
        { 'Idempotency-Key': drawKey },
      );
      announce(`Drew ${deskAmountOf(result.data.amount, result.data.asset)} ${result.data.asset}. Health factor now ${deskHealthFactor(result.data.health_factor_after)}.`, { label: 'View receipt', href: `/settlements/${result.data.settlement_id}` });
      drawKey = null;
      drawBody = null;
      retryButton.hidden = true;
      await refresh();
    } catch (err) {
      if (isNetworkError(err)) {
        drawLost = true;
        retryButton.hidden = false;
        reportError(err);
      } else {
        reportError(err);
      }
    } finally {
      drawButton.disabled = false;
    }
  });
  const retryButton = button(ownerActions, 'Retry', async (): Promise<void> => {
    if (drawBody === null || drawKey === null) return;
    clearProblem();
    announce('Drawing');
    try {
      const result = await request<Settlement>('POST', `/api/positions/${encodeURIComponent(positionId)}/draws`, drawBody, { 'Idempotency-Key': drawKey });
      announce(`Drew ${deskAmountOf(result.data.amount, result.data.asset)} ${result.data.asset}.`, { label: 'View receipt', href: `/settlements/${result.data.settlement_id}` });
      drawKey = null;
      drawBody = null;
      retryButton.hidden = true;
      await refresh();
    } catch (err) {
      reportError(err);
    }
  });
  retryButton.hidden = true;
  drawInput.addEventListener('keydown', (event): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      drawButton.click();
    }
  });

  const repayInput = field(ownerActions, 'Repay amount', 'repay-amount');
  amountValidator(repayInput, (): AssetCode => initial.debt_asset);
  button(ownerActions, 'Repay', async (): Promise<void> => {
    const raw = repayInput.value.trim();
    const amount = raw === '' ? null : parseDeskAmount(raw, ASSET_DECIMALS[initial.debt_asset]);
    if (amount === null) {
      setFieldError(repayInput, 'Enter an amount above zero.');
      repayInput.focus();
      return;
    }
    clearProblem();
    announce('Repaying');
    try {
      const result = await request<{ amount: string; asset: string; debt_after: string; health_factor_after: string | null }>(
        'POST', `/api/positions/${encodeURIComponent(positionId)}/repayments`, { amount },
      );
      if (result.data.debt_after === '0') {
        announce(`Repaid ${deskAmountOf(result.data.amount, initial.debt_asset)} ${initial.debt_asset}. No debt remains.`);
      } else {
        announce(`Repaid ${deskAmountOf(result.data.amount, initial.debt_asset)} ${initial.debt_asset}. Health factor now ${deskHealthFactor(result.data.health_factor_after)}.`);
      }
      await refresh();
    } catch (err) {
      reportError(err);
    }
  });
  button(ownerActions, 'Repay all', async (): Promise<void> => {
    clearProblem();
    announce('Repaying');
    try {
      const result = await request<{ amount: string; debt_after: string; health_factor_after: string | null }>(
        'POST', `/api/positions/${encodeURIComponent(positionId)}/repayments`, { amount: 'all' },
      );
      if (result.data.debt_after === '0') {
        announce(`Repaid ${deskAmountOf(result.data.amount, initial.debt_asset)} ${initial.debt_asset}. No debt remains.`);
      } else {
        announce(`Repaid ${deskAmountOf(result.data.amount, initial.debt_asset)} ${initial.debt_asset}. Health factor now ${deskHealthFactor(result.data.health_factor_after)}.`);
      }
      await refresh();
    } catch (err) {
      reportError(err);
    }
  });
  repayInput.addEventListener('keydown', (event): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const repayBtn = document.querySelector<HTMLButtonElement>('button[aria-label="Repay"]');
      repayBtn?.click();
    }
  });

  const collateralInput = field(ownerActions, 'Collateral change', 'collateral-change');
  amountValidator(collateralInput, (): AssetCode => initial.collateral_asset);
  button(ownerActions, 'Add collateral', async (): Promise<void> => {
    const amount = parseDeskAmount(collateralInput.value, ASSET_DECIMALS[initial.collateral_asset]);
    if (amount === null) {
      setFieldError(collateralInput, 'Enter an amount above zero.');
      collateralInput.focus();
      return;
    }
    clearProblem();
    announce('Adding collateral');
    try {
      const result = await request<Position>('POST', `/api/positions/${encodeURIComponent(positionId)}/collateral`, { amount });
      if (result.data.debt === '0') {
        announce('Collateral added. No debt is drawn.');
      } else {
        announce(`Collateral added. Health factor now ${deskHealthFactor(result.data.health_factor)}.`);
      }
      await refresh();
    } catch (err) {
      reportError(err);
    }
  });
  button(ownerActions, 'Withdraw collateral', async (): Promise<void> => {
    const amount = parseDeskAmount(collateralInput.value, ASSET_DECIMALS[initial.collateral_asset]);
    if (amount === null) {
      setFieldError(collateralInput, 'Enter an amount above zero.');
      collateralInput.focus();
      return;
    }
    clearProblem();
    announce('Withdrawing collateral');
    try {
      const result = await request<Position>('POST', `/api/positions/${encodeURIComponent(positionId)}/collateral-withdrawals`, { amount });
      if (result.data.state === 'closed') {
        announce('Collateral withdrawn. Position closed.');
      } else if (result.data.debt === '0') {
        announce('Collateral withdrawn. No debt is drawn.');
      } else {
        announce(`Collateral withdrawn. Health factor now ${deskHealthFactor(result.data.health_factor)}.`);
      }
      await refresh();
    } catch (err) {
      reportError(err);
    }
  });
  collateralInput.addEventListener('keydown', (event): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const addBtn = document.querySelector<HTMLButtonElement>('button[aria-label="Add collateral"]');
      addBtn?.click();
    }
  });

  const notices = createEl('ul', 'Notices', 'notices');
  main.append(notices);
  const rulerBox = createEl('div', '', 'shockbox');
  main.append(rulerBox);
  const ruler = new ShockRuler(rulerBox, {
    asset: initial.collateral_asset,
    positionId,
    canPost: false,
  });

  const refresh = async (): Promise<void> => {
    const position = await load();
    if (position === null) return;
    stateRegion.textContent = STATE_LABELS[position.state];
    setPlumb(position.health_factor);
    plumb.setAttribute('aria-label', position.health_factor === null
      ? 'Health factor: no debt'
      : `Health factor ${deskHealthFactor(position.health_factor)}`);
    setElement('position-debt', `${deskAmountOf(position.debt, position.debt_asset)} ${position.debt_asset}`);
    setElement('position-collateral', `${deskAmountOf(position.collateral_amount, position.collateral_asset)} ${position.collateral_asset}`);
    setElement('position-hf', deskHealthFactor(position.health_factor));
    setElement('position-liq-price', position.liquidation_price === null ? 'No debt' : deskPriceOf(position.liquidation_price));
    if (position.grace_ends_at === null) {
      setElement('grace-ends', '');
    } else {
      setElement('grace-ends', deskWallTime(new Date(position.grace_ends_at)));
    }
    notices.replaceChildren();
    for (const notice of position.notices) {
      const li = document.createElement('li');
      const kind = notice.kind === 'margin' ? 'Margin' : 'Liquidation';
      const sentText = notice.status === 'sent' ? 'sent' : 'queued, not yet sent';
      li.textContent = `${kind} notice ${sentText}. ${deskWallTime(new Date(notice.created_at))}`;
      notices.append(li);
    }
    try {
      const positions = await getPositions(`?collateral_asset=${position.collateral_asset}`);
      ruler.recordCollateral(positions.positions);
      const pool = ctx.world()?.pools.find((item): boolean => item.asset === position.collateral_asset);
      if (pool !== undefined) ruler.setPositions(positions.positions, pool.price);
    } catch {
      // ruler keeps its last positions
    }
  };
  await refresh();
  const timer = setInterval((): void => {
    void refresh();
  }, 5_000);
  ctx.cleanup((): void => clearInterval(timer));
}

function setElement(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el !== null) el.textContent = text;
}

// ---------- Supply view ----------

export async function renderSupply(ctx: ViewContext): Promise<void> {
  const main = ctx.main;
  main.replaceChildren();
  heading(main, 'Supply');
  const current = ctx.actor();
  if (current === null) return;
  const poolSelect = assetSelect(main, 'Pool', 'pool');
  const supplyInput = field(main, 'Supply amount', 'supply-amount');
  amountValidator(supplyInput, (): AssetCode => poolSelect.value as AssetCode);
  button(main, 'Supply', async (): Promise<void> => {
    const asset = poolSelect.value as AssetCode;
    const amount = parseDeskAmount(supplyInput.value, ASSET_DECIMALS[asset]);
    if (amount === null) {
      setFieldError(supplyInput, 'Enter an amount above zero.');
      supplyInput.focus();
      return;
    }
    clearProblem();
    announce('Supplying');
    try {
      const result = await request<{ amount: string; asset: AssetCode; shares_minted: string }>(
        'POST', `/api/pools/${asset}/supplies`, { amount },
      );
      const shares = BigInt(result.data.shares_minted).toString();
      announce(`Supplied ${deskAmountOf(result.data.amount, asset)} ${asset} for ${deskFormatShares(shares)} shares.`);
      await refreshFigures();
    } catch (err) {
      reportError(err);
    }
  });
  supplyInput.addEventListener('keydown', (event): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const btn = document.querySelector<HTMLButtonElement>('button[aria-label="Supply"]');
      btn?.click();
    }
  });

  const withdrawInput = field(main, 'Withdraw amount', 'withdraw-amount');
  amountValidator(withdrawInput, (): AssetCode => poolSelect.value as AssetCode);
  let withdrawKey: string | null = null;
  const withdrawButton = button(main, 'Withdraw', async (): Promise<void> => {
    const asset = poolSelect.value as AssetCode;
    const amount = parseDeskAmount(withdrawInput.value, ASSET_DECIMALS[asset]);
    if (amount === null) {
      setFieldError(withdrawInput, 'Enter an amount above zero.');
      withdrawInput.focus();
      return;
    }
    if (withdrawKey === null) withdrawKey = randomKey();
    clearProblem();
    announce('Withdrawing');
    withdrawButton.disabled = true;
    try {
      const result = await request<Settlement>('POST', `/api/pools/${asset}/withdrawals`, { amount }, { 'Idempotency-Key': withdrawKey });
      announce(`Withdrew ${deskAmountOf(result.data.amount, asset)} ${asset}.`, { label: 'View receipt', href: `/settlements/${result.data.settlement_id}` });
      withdrawKey = null;
      await refreshFigures();
    } catch (err) {
      reportError(err);
      if (err instanceof ApiError && err.status >= 500) withdrawKey = null;
    } finally {
      withdrawButton.disabled = false;
    }
  });
  withdrawInput.addEventListener('keydown', (event): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      withdrawButton.click();
    }
  });

  const sharesValue = labelledValue(main, 'Your shares', '0');
  const shareValueValue = labelledValue(main, 'Share value', '0');

  const refreshFigures = async (): Promise<void> => {
    try {
      const wallet = await request<{ balances: Array<{ asset: string; amount: string }>; lp_holdings: Array<{ asset: string; shares: string; value: string }> }>('GET', '/api/wallet');
      const asset = poolSelect.value;
      const holding = wallet.data.lp_holdings.find((item): boolean => item.asset === asset);
      sharesValue.textContent = deskFormatShares(holding?.shares ?? '0');
      shareValueValue.textContent = `${deskAmountOf(holding?.value ?? '0', asset as AssetCode)} ${asset}`;
    } catch {
      // keep the last values
    }
  };
  await refreshFigures();
  poolSelect.addEventListener('change', refreshFigures);
  const timer = setInterval((): void => {
    void refreshFigures();
  }, 5_000);
  ctx.cleanup((): void => clearInterval(timer));
  void current;
}

function deskFormatShares(shares: string): string {
  const value = BigInt(shares);
  const text = value.toString();
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
}

// ---------- Liquidations view ----------

export async function renderLiquidations(ctx: ViewContext): Promise<void> {
  const main = ctx.main;
  main.replaceChildren();
  heading(main, 'Liquidations');
  const tableBox = createEl('div', '', 'queuebox');
  main.append(tableBox);
  const rulerBox = createEl('div', '', 'shockbox');
  main.append(rulerBox);
  const assetChoices = createEl('div', '', 'assetchoice');
  const assetSelectEl = assetSelect(assetChoices, 'Asset', 'shock-asset');
  main.insertBefore(assetChoices, rulerBox);
  const ruler = new ShockRuler(rulerBox, {
    asset: 'MBTC',
    canPost: false,
  });

  let focusedPosition = '';
  let focusedCell = 0;

  const load = async (): Promise<void> => {
    try {
      const result = await getQueue();
      renderQueue(result.positions);
      try {
        const positions = await getPositions(`?collateral_asset=${assetSelectEl.value}`);
        ruler.recordCollateral(positions.positions);
        const pool = ctx.world()?.pools.find((item): boolean => item.asset === assetSelectEl.value);
        if (pool !== undefined) ruler.setPositions(positions.positions, pool.price);
      } catch {
        // keep the ruler as it is
      }
    } catch (err) {
      reportError(err);
    }
  };

  const renderQueue = (positions: Position[]): void => {
    tableBox.replaceChildren();
    if (positions.length === 0) {
      const empty = createEl('p', '', 'empty');
      empty.textContent = 'No positions are below health factor 1.';
      tableBox.append(empty);
      return;
    }
    const table = document.createElement('table');
    table.className = 'queuetable';
    table.setAttribute('aria-label', 'Liquidation queue');
    table.setAttribute('role', 'grid');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.setAttribute('role', 'row');
    const columns = ['Position', 'Borrower', 'Health factor', 'State', 'Debt', 'Collateral', 'Max repay', 'Round', 'Action'];
    for (const column of columns) {
      const th = document.createElement('th');
      th.setAttribute('role', 'columnheader');
      th.textContent = column;
      headRow.append(th);
    }
    thead.append(headRow);
    table.append(thead);
    const tbody = document.createElement('tbody');
    for (const position of positions) {
      const row = document.createElement('tr');
      row.setAttribute('role', 'row');
      row.dataset.positionId = position.position_id;
      if (position.health_factor !== null && Number.parseFloat(position.health_factor) < 1) {
        row.classList.add('atrisk');
      }
      const cells: Array<[string, string]> = [
        [position.position_id, 'Position'],
        [position.borrower_id, 'Borrower'],
        [deskHealthFactor(position.health_factor), 'Health factor'],
        [STATE_LABELS[position.state], 'State'],
        [`${deskAmountOf(position.debt, position.debt_asset)} ${position.debt_asset}`, 'Debt'],
        [`${deskAmountOf(position.collateral_amount, position.collateral_asset)} ${position.collateral_asset}`, 'Collateral'],
        [`${deskAmountOf(position.max_repay, position.debt_asset)} ${position.debt_asset}`, 'Max repay'],
        [position.round, 'Round'],
      ];
      let cellIndex = 0;
      for (const [text, label] of cells) {
        const td = document.createElement('td');
        td.setAttribute('role', 'gridcell');
        td.setAttribute('aria-selected', 'false');
        td.dataset.label = label;
        td.dataset.cellIndex = cellIndex.toString();
        td.tabIndex = -1;
        td.textContent = text;
        row.append(td);
        cellIndex += 1;
      }
      const actionCell = document.createElement('td');
      actionCell.setAttribute('role', 'gridcell');
      actionCell.dataset.label = 'Action';
      actionCell.dataset.cellIndex = '8';
      const liquidate = document.createElement('button');
      liquidate.type = 'button';
      liquidate.textContent = `Liquidate ${position.position_id}`;
      liquidate.setAttribute('aria-label', `Liquidate ${position.position_id}`);
      liquidate.dataset.positionId = position.position_id;
      liquidate.tabIndex = -1;
      liquidate.addEventListener('click', (): void => {
        void openDialog(position);
      });
      actionCell.append(liquidate);
      row.append(actionCell);
      tbody.append(row);
    }
    table.append(tbody);
    tableBox.append(table);
    attachGridKeys(table, positions);
    const target = table.querySelector(`tr[data-position-id="${CSS.escape(focusedPosition)}"] td[data-cell-index="${focusedCell}"]`);
    if (target !== null) {
      (target as HTMLElement).tabIndex = 0;
      (target as HTMLElement).focus();
    } else {
      const first = table.querySelector('td');
      if (first !== null) first.tabIndex = 0;
    }
  };

  const attachGridKeys = (table: HTMLTableElement, positions: Position[]): void => {
    table.addEventListener('keydown', (event): void => {
      const target = event.target as HTMLElement;
      if (!target.matches('td')) return;
      const cell = Number.parseInt(target.dataset.cellIndex ?? '0', 10);
      const row = target.closest('tr');
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      const rowIndex = row === null ? -1 : rows.indexOf(row);
      const move = (nextRow: number, nextCell: number): void => {
        const rows2 = Array.from(table.querySelectorAll('tbody tr'));
        const candidate = rows2[nextRow]?.querySelector(`td[data-cell-index="${Math.min(8, Math.max(0, nextCell))}"]`);
        if (candidate !== undefined && candidate !== null) {
          focusCell(candidate as HTMLElement, rows2[nextRow] as HTMLElement);
        }
      };
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        move(rowIndex, cell + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        move(rowIndex, cell - 1);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        move(rowIndex + 1, cell);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        move(rowIndex - 1, cell);
      } else if (event.key === 'Home' && !event.ctrlKey) {
        event.preventDefault();
        move(rowIndex, 0);
      } else if (event.key === 'End' && !event.ctrlKey) {
        event.preventDefault();
        move(rowIndex, 8);
      } else if (event.key === 'Home' && event.ctrlKey) {
        event.preventDefault();
        move(0, 0);
      } else if (event.key === 'End' && event.ctrlKey) {
        event.preventDefault();
        move(rows.length - 1, 8);
      } else if (event.key === 'Enter' || event.key === ' ') {
        if (cell === 8) {
          event.preventDefault();
          const btn = target.querySelector<HTMLButtonElement>('button');
          btn?.click();
        }
      }
      void positions;
    });
    table.addEventListener('focusin', (event): void => {
      const target = event.target as HTMLElement;
      if (!target.matches('td') && !target.matches('button')) return;
      const row = target.closest('tr');
      if (row !== null) focusedPosition = (row as HTMLElement).dataset.positionId ?? '';
      focusedCell = target.matches('td') ? Number.parseInt(target.dataset.cellIndex ?? '0', 10) : 8;
    });
  };

  const focusCell = (cell: HTMLElement, row: HTMLElement): void => {
    const previous = cell.closest('table')?.querySelector('td[tabindex="0"]');
    if (previous !== null && previous !== cell) (previous as HTMLElement).tabIndex = -1;
    cell.tabIndex = 0;
    cell.focus();
    void row;
  };

  const openDialog = async (position: Position): Promise<void> => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Liquidate position');
    const form = document.createElement('form');
    form.method = 'dialog';
    const repayInput = field(form, 'Repay amount', 'dialog-repay');
    repayInput.value = deskAmountOf(position.max_repay, position.debt_asset);
    const menuWrapper = createEl('div', '', 'field');
    const optionsButton = document.createElement('button');
    optionsButton.type = 'button';
    optionsButton.textContent = 'Repay options';
    optionsButton.setAttribute('aria-label', 'Repay options');
    optionsButton.setAttribute('aria-haspopup', 'menu');
    optionsButton.setAttribute('aria-expanded', 'false');
    menuWrapper.append(optionsButton);
    form.append(menuWrapper);
    const actions = createEl('div', '', 'dialog-actions');
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.textContent = 'Confirm liquidation';
    confirmButton.setAttribute('aria-label', 'Confirm liquidation');
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.setAttribute('aria-label', 'Cancel');
    actions.append(cancelButton, confirmButton);
    form.append(actions);
    dialog.append(form);
    main.append(dialog);

    let menu: HTMLElement | null = null;
    const closeMenu = (): void => {
      menu?.remove();
      menu = null;
      optionsButton.setAttribute('aria-expanded', 'false');
      optionsButton.focus();
    };
    optionsButton.addEventListener('click', (): void => {
      openMenu();
    });
    const openMenu = (): void => {
      if (menu !== null) {
        closeMenu();
        return;
      }
      menu = document.createElement('div');
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', 'Repay options');
      menu.className = 'menu';
      const maxItem = document.createElement('button');
      maxItem.type = 'button';
      maxItem.setAttribute('role', 'menuitem');
      maxItem.textContent = 'Use max repay';
      maxItem.addEventListener('click', (): void => {
        repayInput.value = deskAmountOf(position.max_repay, position.debt_asset);
        closeMenu();
      });
      const halfItem = document.createElement('button');
      halfItem.type = 'button';
      halfItem.setAttribute('role', 'menuitem');
      halfItem.textContent = 'Use half of max repay';
      halfItem.addEventListener('click', (): void => {
        const half = BigInt(position.max_repay) / 2n;
        repayInput.value = deskAmountOf(half.toString(), position.debt_asset);
        closeMenu();
      });
      menu.append(maxItem, halfItem);
      optionsButton.insertAdjacentElement('afterend', menu);
      optionsButton.setAttribute('aria-expanded', 'true');
      (menu.firstElementChild as HTMLElement).focus();
      menu.addEventListener('keydown', (event): void => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          closeMenu();
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const items = Array.from(menu?.querySelectorAll('[role="menuitem"]') ?? []);
          const active = document.activeElement;
          const index = active === null ? -1 : items.indexOf(active);
          const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
          (items[next] as HTMLElement).focus();
          event.preventDefault();
        }
      });
    };

    let key: string | null = null;
    let body: { repay_amount: string; round: number } | null = null;
    cancelButton.addEventListener('click', (): void => {
      dialog.close();
    });
    dialog.addEventListener('close', (): void => {
      dialog.remove();
    });
    dialog.addEventListener('keydown', (event): void => {
      if (event.key === 'Escape' && menu !== null) {
        event.stopPropagation();
        closeMenu();
      }
    });
    confirmButton.addEventListener('click', (): void => {
      void submit();
    });
    repayInput.addEventListener('keydown', (event): void => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void submit();
      }
    });
    const submit = async (): Promise<void> => {
      const amount = parseDeskAmount(repayInput.value, ASSET_DECIMALS[position.debt_asset]);
      if (amount === null) {
        setFieldError(repayInput, 'Enter an amount above zero.');
        repayInput.focus();
        return;
      }
      if (key === null) key = randomKey();
      body = { repay_amount: amount, round: Number.parseInt(position.round, 10) };
      clearProblem();
      announce('Submitting liquidation');
      confirmButton.disabled = true;
      try {
        const result = await request<Settlement & { repaid: string; seized: string; round: string; asset: string; collateral_asset?: string }>(
          'POST',
          `/api/positions/${encodeURIComponent(position.position_id)}/liquidations`,
          body,
          { 'Idempotency-Key': key },
        );
        dialog.close();
        window.history.pushState({}, '', `/settlements/${result.data.settlement_id}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          dialog.close();
          showProblem(err.message);
          focusedPosition = position.position_id;
          focusedCell = 8;
          await load();
          const rowButton = document.querySelector<HTMLButtonElement>(`button[data-position-id="${CSS.escape(position.position_id)}"]`);
          rowButton?.focus();
        } else {
          reportError(err);
        }
      } finally {
        confirmButton.disabled = false;
        key = null;
      }
    };
    dialog.showModal();
    repayInput.focus();
  };

  await load();
  const timer = setInterval((): void => {
    void load();
  }, 5_000);
  ctx.cleanup((): void => clearInterval(timer));
  assetSelectEl.addEventListener('change', (): void => {
    void load();
  });
}

// ---------- Steward view ----------

export async function renderSteward(ctx: ViewContext): Promise<void> {
  const main = ctx.main;
  main.replaceChildren();
  heading(main, 'Steward');
  const assetChoice = assetSelect(main, 'Asset', 'steward-asset');
  const priceInput = field(main, 'New price', 'new-price');
  priceInput.addEventListener('keydown', (event): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      postButton.click();
    }
  });
  priceInput.addEventListener('input', (): void => {
    const error = deskPriceFieldError(priceInput.value);
    if (error === null) clearFieldError(priceInput);
    else setFieldError(priceInput, error);
  });
  const confirmBox = createEl('div', '', 'field');
  const confirmLabel = document.createElement('label');
  confirmLabel.textContent = 'Confirm large move';
  confirmLabel.setAttribute('for', 'confirm-large-move');
  const confirmCheck = document.createElement('input');
  confirmCheck.type = 'checkbox';
  confirmCheck.id = 'confirm-large-move';
  confirmCheck.setAttribute('aria-label', 'Confirm large move');
  confirmBox.append(confirmLabel, confirmCheck);
  main.append(confirmBox);
  const postButton = button(main, 'Post price', async (): Promise<void> => {
    const price = parseDeskPrice(priceInput.value);
    if (price === null) {
      setFieldError(priceInput, 'Enter a price above zero with at most 8 decimals.');
      priceInput.focus();
      return;
    }
    clearProblem();
    announce('Posting price');
    postButton.disabled = true;
    try {
      const result = await request<{ positions_below_one: number }>('POST', '/api/prices', {
        asset: assetChoice.value,
        price,
        confirm_large_move: confirmCheck.checked,
      });
      const count = result.data.positions_below_one;
      announce(`Price posted. ${count === 1 ? '1 position' : `${count} positions`} now below health factor 1.`);
      confirmCheck.checked = false;
      priceInput.value = '';
      await loadRisk();
      await loadRuler();
    } catch (err) {
      reportError(err);
    } finally {
      postButton.disabled = false;
    }
  });

  const riskForm = createEl('div', '', 'riskform');
  main.append(riskForm);
  const ltvInput = field(riskForm, 'Loan-to-value (%)', 'ltv_bps');
  const thresholdInput = field(riskForm, 'Liquidation threshold (%)', 'liquidation_threshold_bps');
  const bonusInput = field(riskForm, 'Liquidation bonus (%)', 'liquidation_bonus_bps');
  const reserveInput = field(riskForm, 'Reserve factor (%)', 'reserve_factor_bps');
  for (const input of [ltvInput, thresholdInput, bonusInput, reserveInput]) {
    input.addEventListener('input', (): void => {
      const error = percentageError(input.value);
      if (error === null) clearFieldError(input);
      else setFieldError(input, error);
    });
  }
  let etag = '';
  const loadRisk = async (): Promise<void> => {
    try {
      const asset = assetChoice.value;
      const response = await fetch(`/api/assets/${asset}/risk`, {
        headers: { Authorization: `Bearer ${window.localStorage.getItem('quillmoor-token') ?? ''}` },
      });
      const data = await response.json() as Record<string, number>;
      etag = response.headers.get('ETag') ?? '';
      ltvInput.value = deskPercentField(data.ltv_bps);
      thresholdInput.value = deskPercentField(data.liquidation_threshold_bps);
      bonusInput.value = deskPercentField(data.liquidation_bonus_bps);
      reserveInput.value = deskPercentField(data.reserve_factor_bps);
    } catch {
      // keep the form as it is
    }
  };
  await loadRisk();
  const saveButton = button(riskForm, 'Save risk parameters', async (): Promise<void> => {
    const body: Record<string, number> = {};
    const ltv = parseDeskPercent(ltvInput.value);
    const threshold = parseDeskPercent(thresholdInput.value);
    const bonus = parseDeskPercent(bonusInput.value);
    const reserve = parseDeskPercent(reserveInput.value);
    if (ltv !== null) body.ltv_bps = ltv;
    if (threshold !== null) body.liquidation_threshold_bps = threshold;
    if (bonus !== null) body.liquidation_bonus_bps = bonus;
    if (reserve !== null) body.reserve_factor_bps = reserve;
    clearProblem();
    announce('Saving risk parameters');
    saveButton.disabled = true;
    try {
      const response = await fetch(`/api/assets/${assetChoice.value}/risk`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${window.localStorage.getItem('quillmoor-token') ?? ''}`,
          'If-Match': etag,
        },
        body: JSON.stringify(body),
      });
      const data = await response.json() as { positions_below_one?: number; detail?: string; errors?: Record<string, string>; ltv_bps?: number };
      if (!response.ok) {
        if (response.status === 412) {
          showProblem('These risk parameters changed since you opened them. Check the current values and save again.');
          await loadRisk();
          return;
        }
        if (response.status === 422 && data.errors !== undefined) {
          for (const [field, message] of Object.entries(data.errors)) {
            const input = document.getElementById(field) as HTMLInputElement | null;
            if (input !== null) setFieldError(input, message);
          }
          showProblem('Check the highlighted fields.');
          return;
        }
        showProblem(data.detail ?? 'Something went wrong on our side \u2013 nothing is confirmed.');
        return;
      }
      etag = response.headers.get('ETag') ?? etag;
      announce(`Risk parameters saved for ${assetChoice.value}.`);
    } catch {
      showProblem('Couldn\u2019t reach Quillmoor. Press the same button again to retry safely.');
    } finally {
      saveButton.disabled = false;
    }
  });

  const memberForm = createEl('div', '', 'memberform');
  main.append(memberForm);
  const nameInput = field(memberForm, 'Member name', 'member-name');
  const emailInput = field(memberForm, 'Member email', 'member-email');
  const roleSelect = document.createElement('select');
  roleSelect.id = 'member-role';
  roleSelect.setAttribute('aria-label', 'Member role');
  for (const role of ['risk_steward', 'liquidity_provider', 'borrower', 'trader', 'liquidator']) {
    const option = document.createElement('option');
    option.value = role;
    option.textContent = role;
    roleSelect.append(option);
  }
  memberForm.append(roleSelect);
  button(memberForm, 'Add member', async (): Promise<void> => {
    if (nameInput.value.trim() === '' || emailInput.value.trim() === '') {
      showProblem('Check the highlighted fields.');
      return;
    }
    clearProblem();
    announce('Adding member');
    try {
      const result = await request<{ name: string }>('POST', '/api/actors', {
        name: nameInput.value,
        email: emailInput.value,
        role: roleSelect.value,
      });
      announce(`Member added: ${result.data.name}.`);
      nameInput.value = '';
      emailInput.value = '';
      await loadMembers();
    } catch (err) {
      reportError(err);
    }
  });

  const transferForm = createEl('div', '', 'transferform');
  main.append(transferForm);
  const memberSelect = document.createElement('select');
  memberSelect.id = 'transfer-member';
  memberSelect.setAttribute('aria-label', 'Member');
  transferForm.append(memberSelect);
  const transferAsset = assetSelect(transferForm, 'Transfer asset', 'transfer-asset');
  const transferAmount = field(transferForm, 'Transfer amount', 'transfer-amount');
  amountValidator(transferAmount, (): AssetCode => transferAsset.value as AssetCode);
  const loadMembers = async (): Promise<void> => {
    try {
      const result = await request<{ actors: Array<{ actor_id: string; name: string; role: string }> }>('GET', '/api/actors');
      memberSelect.replaceChildren();
      for (const item of result.data.actors) {
        const option = document.createElement('option');
        option.value = item.actor_id;
        option.textContent = item.name;
        memberSelect.append(option);
      }
    } catch {
      // keep the list
    }
  };
  await loadMembers();
  const recordTransfer = button(transferForm, 'Record transfer', async (): Promise<void> => {
    const amount = parseDeskAmount(transferAmount.value, ASSET_DECIMALS[transferAsset.value as AssetCode]);
    if (amount === null) {
      setFieldError(transferAmount, 'Enter an amount above zero.');
      transferAmount.focus();
      return;
    }
    clearProblem();
    announce('Recording transfer');
    try {
      const result = await request<{ amount: string; asset: AssetCode }>('POST', '/api/transfers', {
        actor_id: memberSelect.value,
        asset: transferAsset.value,
        amount,
      });
      const member = memberSelect.options[memberSelect.selectedIndex]?.textContent ?? '';
      announce(`Transfer recorded: ${deskAmountOf(result.data.amount, result.data.asset)} ${result.data.asset} to ${member}.`);
      transferAmount.value = '';
    } catch (err) {
      reportError(err);
    }
  });
  transferAmount.addEventListener('keydown', (event): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      recordTransfer.click();
    }
  });

  const rulerBox = createEl('div', '', 'shockbox');
  main.append(rulerBox);
  const ruler = new ShockRuler(rulerBox, {
    asset: 'MBTC',
    canPost: true,
    onPost: (shockedPrice): void => {
      const display = deskPriceOf(shockedPrice);
      priceInput.value = display.replace('$', '');
      postButton.focus();
    },
  });
  const loadRuler = async (): Promise<void> => {
    try {
      const asset = assetChoice.value;
      ruler.setPositions([], '0');
      const positions = await getPositions(`?collateral_asset=${asset}`);
      ruler.recordCollateral(positions.positions);
      const pool = ctx.world()?.pools.find((item): boolean => item.asset === asset);
      if (pool !== undefined) {
        ruler.setPositions(positions.positions, pool.price);
      }
    } catch {
      // keep the ruler
    }
  };
  await loadRuler();
  assetChoice.addEventListener('change', (): void => {
    void loadRisk();
    void loadRuler();
  });
  const timer = setInterval((): void => {
    void loadRuler();
  }, 5_000);
  ctx.cleanup((): void => clearInterval(timer));
  void ctx.actor;
  void deskDateTime;
}

function percentageError(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (!/^[0-9]+(,[0-9]{0,2})?$/.test(trimmed)) return 'Enter a percentage with at most two decimals, for example 80,00.';
  return null;
}

// ---------- Ledger view ----------

export async function renderLedger(ctx: ViewContext): Promise<void> {
  const main = ctx.main;
  main.replaceChildren();
  heading(main, 'Ledger');
  const totalsTable = createEl('div', '', 'totalsbox');
  main.append(totalsTable);

  const filters = createEl('div', '', 'ledger-filters');
  main.append(filters);
  const assetSelectEl = document.createElement('select');
  assetSelectEl.id = 'ledger-asset';
  assetSelectEl.setAttribute('aria-label', 'Ledger asset');
  for (const option of ['All assets', 'QUSD', 'MBTC', 'METH']) {
    const element = document.createElement('option');
    element.value = option === 'All assets' ? '' : option;
    element.textContent = option;
    assetSelectEl.append(element);
  }
  filters.append(assetSelectEl);
  const limitSelect = document.createElement('select');
  limitSelect.id = 'postings-shown';
  limitSelect.setAttribute('aria-label', 'Postings shown');
  for (const value of ['20', '50', '200']) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = value;
    limitSelect.append(element);
  }
  filters.append(limitSelect);
  const fromInput = field(filters, 'Posted from', 'posted-from');
  const toInput = field(filters, 'Posted before', 'posted-before');

  const postingsTable = createEl('div', '', 'postingsbox');
  main.append(postingsTable);

  const readUrl = (): { asset: string; limit: string; from: string | null; to: string | null; canonical: string } => {
    const params = new URLSearchParams(window.location.search);
    const asset = params.get('asset') ?? '';
    const limit = params.get('limit') ?? '50';
    const from = params.get('from');
    const to = params.get('to');
    let canonicalAsset = '';
    let canonicalLimit = '50';
    let canonicalFrom: string | null = null;
    let canonicalTo: string | null = null;
    if (['QUSD', 'MBTC', 'METH'].includes(asset)) canonicalAsset = asset;
    if (['20', '50', '200'].includes(limit)) canonicalLimit = limit;
    for (const value of [from, to]) {
      if (value === null) continue;
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
        if (value === from) canonicalFrom = value;
        else canonicalTo = value;
      }
    }
    const out = new URLSearchParams();
    if (canonicalAsset !== '') out.set('asset', canonicalAsset);
    if (canonicalLimit !== '50') out.set('limit', canonicalLimit);
    if (canonicalFrom !== null) out.set('from', canonicalFrom);
    if (canonicalTo !== null) out.set('to', canonicalTo);
    return { asset: canonicalAsset, limit: canonicalLimit, from: canonicalFrom, to: canonicalTo, canonical: out.toString() };
  };

  const writeUrl = (push: boolean): void => {
    const asset = assetSelectEl.value;
    const limit = limitSelect.value;
    const from = canonicalInstant(fromInput.value);
    const to = canonicalInstant(toInput.value);
    const params = new URLSearchParams();
    if (asset !== '') params.set('asset', asset);
    if (limit !== '50') params.set('limit', limit);
    if (from !== null) params.set('from', from);
    if (to !== null) params.set('to', to);
    const url = `/ledger${params.size > 0 ? `?${params.toString()}` : ''}`;
    if (push) window.history.pushState({}, '', url);
    else window.history.replaceState({}, '', url);
    void load();
  };

  const canonicalInstant = (deskTime: string): string | null => {
    if (deskTime.trim() === '') return null;
    const parsed = parseDeskTime(deskTime);
    if (parsed.instant === null) return null;
    return parsed.instant.toISOString().replace(/\.\d{3}Z$/, 'Z');
  };

  const applyControls = (): void => {
    const state = readUrl();
    assetSelectEl.value = state.asset;
    limitSelect.value = state.limit;
    fromInput.value = state.from === null ? '' : deskDateTime(new Date(state.from)).slice(0, 16);
    toInput.value = state.to === null ? '' : deskDateTime(new Date(state.to)).slice(0, 16);
  };

  const load = async (): Promise<void> => {
    const state = readUrl();
    if (window.location.search !== (state.canonical === '' ? '' : `?${state.canonical}`)) {
      window.history.replaceState({}, '', `/ledger${state.canonical === '' ? '' : `?${state.canonical}`}`);
    }
    applyControls();
    try {
      const totals = await getLedgerTotals();
      totalsTable.replaceChildren();
      const table = document.createElement('table');
      table.setAttribute('aria-label', 'Ledger totals');
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      for (const column of ['Asset', 'Debits', 'Credits', 'Net']) {
        const th = document.createElement('th');
        th.textContent = column;
        headRow.append(th);
      }
      thead.append(headRow);
      table.append(thead);
      const tbody = document.createElement('tbody');
      for (const row of totals.assets) {
        const tr = document.createElement('tr');
        for (const text of [row.asset, deskAmountOf(row.debits, row.asset), deskAmountOf(row.credits, row.asset), deskAmountOf(row.net, row.asset)]) {
          const td = document.createElement('td');
          td.textContent = text;
          td.className = 'amount';
          tr.append(td);
        }
        tbody.append(tr);
      }
      table.append(tbody);
      totalsTable.append(table);
    } catch (err) {
      reportError(err);
    }
    try {
      const params = new URLSearchParams();
      if (state.asset !== '') params.set('asset', state.asset);
      params.set('limit', state.limit);
      if (state.from !== null) params.set('from', state.from);
      if (state.to !== null) params.set('to', state.to);
      const result = await getPostings(`?${params.toString()}`);
      postingsTable.replaceChildren();
      const table = document.createElement('table');
      table.setAttribute('aria-label', 'Postings');
      table.className = 'postings-table';
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      for (const column of ['Posting', 'Kind', 'Time', 'Account', 'Asset', 'Amount']) {
        const th = document.createElement('th');
        th.textContent = column;
        headRow.append(th);
      }
      thead.append(headRow);
      table.append(thead);
      const tbody = document.createElement('tbody');
      for (const posting of result.postings) {
        for (let index = 0; index < posting.legs.length; index += 1) {
          const leg = posting.legs[index];
          const tr = document.createElement('tr');
          const cells = [
            index === 0 ? posting.posting_id : '',
            index === 0 ? posting.kind : '',
            index === 0 ? deskDateTime(new Date(posting.created_at)) : '',
            leg.account,
            leg.asset,
            deskAmountOf(leg.amount, leg.asset, true),
          ];
          for (const text of cells) {
            const td = document.createElement('td');
            td.textContent = text;
            tr.append(td);
          }
          tbody.append(tr);
        }
      }
      table.append(tbody);
      postingsTable.append(table);
    } catch (err) {
      reportError(err);
    }
  };

  for (const select of [assetSelectEl, limitSelect]) {
    select.addEventListener('change', (): void => {
      writeUrl(true);
    });
  }
  for (const input of [fromInput, toInput]) {
    input.addEventListener('keydown', (event): void => {
      if (event.key === 'Enter') {
        event.preventDefault();
        writeUrl(true);
      }
    });
    input.addEventListener('blur', (): void => {
      writeUrl(true);
    });
    input.addEventListener('input', (): void => {
      const error = deskTimeError(input.value);
      if (error === null) clearFieldError(input);
      else setFieldError(input, error);
    });
  }
  await load();
  ctx.cleanup((): void => undefined);
  void deskPercent;
}

function deskTimeError(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(trimmed)) return 'Enter a desk time like 2026-11-01 01:30.';
  return null;
}

// ---------- Settlement receipt view ----------

export async function renderSettlement(ctx: ViewContext, settlementId: string): Promise<void> {
  const main = ctx.main;
  main.replaceChildren();
  const headingEl = document.createElement('h1');
  headingEl.textContent = 'Settlement receipt';
  main.append(headingEl);

  const statementStatus = createEl('div', 'Statement status', 'status-role');
  statementStatus.setAttribute('role', 'status');
  main.append(statementStatus);
  const webhookStatus = createEl('div', 'Integrator webhook', 'status-role');
  webhookStatus.setAttribute('role', 'status');
  main.append(webhookStatus);

  const legsTable = createEl('div', '', 'legsbox');
  main.append(legsTable);
  const downloadBox = createEl('div', '', 'downloadbox');
  main.append(downloadBox);

  const load = async (): Promise<void> => {
    let settlement: Settlement;
    try {
      const result = await getSettlement(settlementId);
      settlement = result;
    } catch (err) {
      reportError(err);
      return;
    }
    for (const region of [statementStatus, webhookStatus]) region.replaceChildren();
    legsTable.replaceChildren();
    downloadBox.replaceChildren();
    labelledValue(main, 'Kind', settlement.kind);
    labelledValue(main, 'Amount', `${deskAmountOf(settlement.amount, settlement.asset)} ${settlement.asset}`);
    if (settlement.kind === 'liquidation') {
      labelledValue(main, 'Repaid', `${deskAmountOf(settlement.repaid ?? '0', settlement.asset)} ${settlement.asset}`);
      labelledValue(main, 'Seized', `${deskAmountOf(settlement.seized ?? '0', settlement.asset)} ${settlement.asset}`);
      labelledValue(main, 'Bonus', `${deskAmountOf(settlement.bonus_amount ?? '0', settlement.asset)} ${settlement.asset}`);
    }
    labelledValue(main, 'Statement key', settlement.statement_key);

    const table = document.createElement('table');
    table.setAttribute('aria-label', 'Settlement legs');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const column of ['Account', 'Asset', 'Amount']) {
      const th = document.createElement('th');
      th.textContent = column;
      headRow.append(th);
    }
    thead.append(headRow);
    table.append(thead);
    const tbody = document.createElement('tbody');
    for (const leg of settlement.legs) {
      const tr = document.createElement('tr');
      for (const text of [leg.account, leg.asset, deskAmountOf(leg.amount, leg.asset, true)]) {
        const td = document.createElement('td');
        td.textContent = text;
        if (text === leg.asset || text === deskAmountOf(leg.amount, leg.asset, true)) td.className = 'amount';
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    legsTable.append(table);

    if (settlement.statement_status === 'stored') {
      statementStatus.append(document.createTextNode('Settled'));
      const download = document.createElement('button');
      download.type = 'button';
      download.textContent = 'Download PDF statement';
      download.setAttribute('aria-label', 'Download PDF statement');
      download.addEventListener('click', (): void => {
        window.open(`/api/settlements/${encodeURIComponent(settlementId)}/statement.pdf`, '_blank');
      });
      downloadBox.append(download);
    } else {
      statementStatus.append(document.createTextNode('Pending statement'));
      statementStatus.append(document.createTextNode(' Funds have moved. This settlement is not final until its statement and its PDF are confirmed in storage.'));
    }
    webhookStatus.textContent = settlement.webhook_status === 'delivered' ? 'Webhook delivered.' : 'Webhook queued, not yet delivered.';
    if (settlement.statement_status === 'stored' && settlement.webhook_status === 'delivered') return;
  };
  await load();
  const timer = setInterval((): void => {
    void load();
  }, 5_000);
  ctx.cleanup((): void => clearInterval(timer));
  void ctx.world;
}

export { field, button, assetSelect, labelledValue, heading, amountValidator };
