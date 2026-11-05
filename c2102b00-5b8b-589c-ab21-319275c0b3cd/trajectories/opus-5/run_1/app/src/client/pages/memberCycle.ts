import type { Credit, Cycle, Line } from '../../shared/types.ts';
import { NoResponseError, errorCode, errorFields, newIdempotencyKey, request, currentSeq } from '../api.ts';
import { copy } from '../copy.ts';
import { clear, el, isBusy, isWideLayout, setBusy, setText } from '../dom.ts';
import { Dialog } from '../dialog.ts';
import { LiveRegion } from '../live.ts';
import { formatDollars } from '../../shared/money.ts';
import { CaseBlock } from './caseBlock.ts';
import type { Page, Shell } from './page.ts';

const REFRESH_MS = 10_000;

/** Whether a line may be drawn is decided here, from its version. */
class LineStore {
  private versions = new Map<string, number>();

  accept(line: Line): boolean {
    const shown = this.versions.get(line.product_id) ?? 0;
    if (line.version <= shown) return false;
    this.versions.set(line.product_id, line.version);
    return true;
  }

  forget(): void {
    this.versions.clear();
  }
}

function keepFocus(work: () => void): void {
  const active = document.activeElement as HTMLElement | null;
  const input = active as HTMLInputElement | null;
  const selectionStart = input && 'selectionStart' in input ? input.selectionStart : null;
  const selectionEnd = input && 'selectionEnd' in input ? input.selectionEnd : null;
  work();
  if (active && active.isConnected && document.activeElement !== active) {
    active.focus();
    if (selectionStart !== null && selectionEnd !== null && input && 'setSelectionRange' in input) {
      try {
        input.setSelectionRange(selectionStart, selectionEnd);
      } catch {
        /* a number input may refuse a selection range */
      }
    }
  }
}

export function createMemberCyclePage(shell: Shell, cycleId: string): Page {
  const pledgeUpdates = new LiveRegion('Pledge updates');
  const creditUpdates = new LiveRegion('Credit updates');
  const lines = new LineStore();
  const blocks = new Map<string, CaseBlock>();
  const pledgeInFlight = new Set<string>();

  let cycle: Cycle | null = null;
  let cycleSeq = 0;
  let creditSeq = 0;
  let cutoffLatched = false;
  let wide = isWideLayout();
  let selectedTab: 'open' | 'sealed' = 'open';
  let refreshTimer: number | null = null;
  let topUpDialog: Dialog | null = null;
  let withdrawDialog: Dialog | null = null;
  let destroyed = false;

  const heading = el('h1', { class: 'cycle-name' });
  const statusText = el('p', { class: 'cycle-status' });
  const cutoffText = el('p', { class: 'cycle-time' });
  const pickupText = el('p', { class: 'cycle-time' });
  const header = el('header', { class: 'cycle-header' }, [heading, statusText, cutoffText, pickupText]);

  const balanceValue = el('span', { class: 'money' });
  const heldValue = el('span', { class: 'money' });
  const spendableValue = el('span', { class: 'money' });
  const topUpButton = el('button', { type: 'button', class: 'primary', text: 'Top up' }) as HTMLButtonElement;
  const creditRegion = el('section', { class: 'credit-panel', role: 'region', 'aria-label': 'Credit' }, [
    el('div', { class: 'credit-figure' }, [el('span', { class: 'label', text: 'BALANCE' }), balanceValue]),
    el('div', { class: 'credit-figure' }, [el('span', { class: 'label', text: 'HELD' }), heldValue]),
    el('div', { class: 'credit-figure' }, [el('span', { class: 'label', text: 'SPENDABLE' }), spendableValue]),
    topUpButton,
    el('a', { href: '/credit', class: 'text-link', text: 'Credit history' }),
  ]);

  const openPanel = el('div', { class: 'open-cases' });
  const sealedHolder = el('div', { class: 'sealed-holder' });
  const casesArea = el('div', { class: 'cases-area' });
  const element = el('main', { class: 'screen member-cycle' }, [
    header,
    creditRegion,
    casesArea,
    pledgeUpdates.element,
    creditUpdates.element,
  ]);

  let tabList: HTMLElement | null = null;
  let openTab: HTMLButtonElement | null = null;
  let sealedTab: HTMLButtonElement | null = null;
  let openPanelWrapper: HTMLElement | null = null;
  let sealedPanelWrapper: HTMLElement | null = null;
  let sealedRail: HTMLElement | null = null;

  function buildLayout(): void {
    clear(casesArea);
    tabList = null;
    openTab = null;
    sealedTab = null;
    openPanelWrapper = null;
    sealedPanelWrapper = null;
    sealedRail = null;
    if (wide) {
      sealedRail = el('aside', {
        class: 'sealed-rail',
        role: 'complementary',
        'aria-label': 'Sealed cases',
        tabindex: '-1',
      }, [sealedHolder]);
      casesArea.append(openPanel, sealedRail);
      openPanel.hidden = false;
      sealedHolder.hidden = false;
      return;
    }
    openTab = el('button', {
      type: 'button',
      role: 'tab',
      id: 'tab-open',
      class: 'case-tab',
      text: 'Open',
      'aria-selected': String(selectedTab === 'open'),
      'aria-controls': 'panel-open',
      tabindex: selectedTab === 'open' ? '0' : '-1',
    }) as HTMLButtonElement;
    sealedTab = el('button', {
      type: 'button',
      role: 'tab',
      id: 'tab-sealed',
      class: 'case-tab',
      text: 'Sealed',
      'aria-selected': String(selectedTab === 'sealed'),
      'aria-controls': 'panel-sealed',
      tabindex: selectedTab === 'sealed' ? '0' : '-1',
    }) as HTMLButtonElement;
    tabList = el('div', { role: 'tablist', 'aria-label': 'Cases', class: 'case-tabs' }, [openTab, sealedTab]);
    openPanelWrapper = el('div', {
      role: 'tabpanel',
      id: 'panel-open',
      'aria-labelledby': 'tab-open',
      class: 'case-panel',
    }, [openPanel]);
    sealedPanelWrapper = el('div', {
      role: 'tabpanel',
      id: 'panel-sealed',
      'aria-labelledby': 'tab-sealed',
      class: 'case-panel',
    }, [sealedHolder]);
    openPanel.hidden = false;
    sealedHolder.hidden = false;
    casesArea.append(tabList, openPanelWrapper, sealedPanelWrapper);
    applyTabSelection();
    for (const tab of [openTab, sealedTab]) {
      tab.addEventListener('click', () => selectTab(tab === openTab ? 'open' : 'sealed', true));
      tab.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          const next = tab === openTab ? sealedTab : openTab;
          next?.focus();
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectTab(tab === openTab ? 'open' : 'sealed', true);
        }
      });
    }
  }

  function applyTabSelection(): void {
    if (!openTab || !sealedTab || !openPanelWrapper || !sealedPanelWrapper) return;
    openTab.setAttribute('aria-selected', String(selectedTab === 'open'));
    sealedTab.setAttribute('aria-selected', String(selectedTab === 'sealed'));
    openTab.tabIndex = selectedTab === 'open' ? 0 : -1;
    sealedTab.tabIndex = selectedTab === 'sealed' ? 0 : -1;
    openPanelWrapper.hidden = selectedTab !== 'open';
    sealedPanelWrapper.hidden = selectedTab !== 'sealed';
    if (selectedTab === 'open') {
      for (const block of blocks.values()) if (!block.isSealed) block.crate.shown();
    } else {
      for (const block of blocks.values()) if (block.isSealed) block.crate.shown();
    }
  }

  function selectTab(tab: 'open' | 'sealed', moveFocus: boolean): void {
    selectedTab = tab;
    applyTabSelection();
    if (moveFocus) (tab === 'open' ? openTab : sealedTab)?.focus();
  }

  function placeBlocks(): void {
    if (!cycle) return;
    keepFocus(() => {
      for (const line of cycle!.lines) {
        const block = blocks.get(line.product_id);
        if (!block) continue;
        const target = block.isSealed ? sealedHolder : openPanel;
        target.append(block.article);
      }
    });
  }

  function setBanners(): void {
    if (!cycle) return;
    shell.setBanner('cutoff', cycle.accepting_pledges ? null : copy.cutoffBanner(cycle.name));
  }

  function ownShortUnits(line: Line): number {
    if (line.short_units <= 0) return 0;
    let count = 0;
    for (let index = line.pack - line.short_units; index < line.pack; index += 1) {
      if (line.cells[index] === 'mine') count += 1;
    }
    return count;
  }

  function paintCredit(credit: Credit | null): void {
    if (!credit) return;
    setText(balanceValue, `$${formatDollars(credit.balance_cents)}`);
    setText(heldValue, `$${formatDollars(credit.held_cents)}`);
    setText(spendableValue, `$${formatDollars(credit.spendable_cents)}`);
  }

  function blockHost() {
    return {
      pledge: (block: CaseBlock, units: number) => void sendPledge(block, units),
      openWithdraw: (block: CaseBlock) => openWithdrawDialog(block),
      onSealChange: (block: CaseBlock, sealed: boolean, byOwnChange: boolean) => {
        const active = document.activeElement as HTMLElement | null;
        const heldFocus = active !== null && block.article.contains(active);
        placeBlocks();
        if (!byOwnChange) {
          if (!wide && heldFocus && block.article.offsetParent === null) {
            (selectedTab === 'open' ? openTab : sealedTab)?.focus();
          }
          return;
        }
        if (wide) {
          block.focusUnits();
          return;
        }
        if (sealed && selectedTab === 'open') sealedTab?.focus();
        else if (!sealed && selectedTab === 'sealed') openTab?.focus();
        else block.focusUnits();
      },
    };
  }

  function applyCycle(next: Cycle, sentSeq: number, source: 'own' | 'refresh'): void {
    const first = cycle === null;
    if (sentSeq > cycleSeq) {
      cycleSeq = sentSeq;
      const accepting = cutoffLatched ? false : next.accepting_pledges;
      cycle = { ...next, accepting_pledges: accepting };
      setText(heading, next.name);
      setText(statusText, next.status.toUpperCase());
      setText(cutoffText, next.cutoff_display ? `CUTOFF ${next.cutoff_display}` : 'CUTOFF');
      setText(pickupText, next.pickup_display ? `PICKUP ${next.pickup_display}` : 'PICKUP');
      setBanners();
    } else if (cycle) {
      cycle = { ...cycle, lines: next.lines };
    }
    if (!cycle) return;

    for (const line of next.lines) {
      let block = blocks.get(line.product_id);
      if (!block) {
        block = new CaseBlock(line, blockHost());
        blocks.set(line.product_id, block);
        lines.accept(line);
        block.setShortNotice(ownShortUnits(line), line.my_units ?? 0);
      } else {
        if (source === 'refresh' && pledgeInFlight.has(line.product_id)) continue;
        if (lines.accept(line)) {
          block.drawLine(line, source === 'own' ? 'sequence' : 'instant');
          block.setShortNotice(ownShortUnits(line), line.my_units ?? 0);
        }
      }
      block.setAccepting(cycle.accepting_pledges);
    }
    if (sentSeq > creditSeq) paintCredit(next.credit);
    placeBlocks();
    if (first) {
      requestAnimationFrame(() => {
        for (const block of blocks.values()) block.crate.shown();
      });
    }
  }

  async function refresh(): Promise<void> {
    if (destroyed) return;
    try {
      const reply = await request<Cycle>('GET', `/api/cycles/${cycleId}`);
      if (destroyed) return;
      if (reply.status === 404) {
        shell.navigate('/', { replace: true });
        return;
      }
      if (!reply.ok) return;
      keepFocus(() => applyCycle(reply.body, reply.sentSeq, 'refresh'));
    } catch {
      /* a refresh that gets no answer simply waits for the next one */
    }
  }

  function latchCutoff(): void {
    cutoffLatched = true;
    cycleSeq = currentSeq();
    if (cycle) {
      cycle = { ...cycle, accepting_pledges: false };
      for (const block of blocks.values()) block.setAccepting(false);
      setBanners();
    }
  }

  async function sendPledge(block: CaseBlock, units: number): Promise<void> {
    const key = block.idempotencyKeyFor(units, newIdempotencyKey);
    block.setPledgePending(true);
    pledgeInFlight.add(block.productId);
    try {
      const reply = await request<{ line: Line; credit: Credit }>(
        'PUT',
        `/api/cycles/${cycleId}/lines/${block.productId}/pledge`,
        { body: { units }, idempotencyKey: key },
      );
      pledgeInFlight.delete(block.productId);
      block.setPledgePending(false);
      if (reply.ok) {
        block.clearRetry();
        creditSeq = currentSeq();
        paintCredit(reply.body.credit);
        const line = reply.body.line;
        if (lines.accept(line)) {
          block.drawLine(line, 'sequence');
          block.setShortNotice(ownShortUnits(line), line.my_units ?? 0);
        }
        pledgeUpdates.say(
          line.units_to_go === 0
            ? copy.pledgedSealed(line.my_units ?? units, line.case_name)
            : copy.pledged(line.my_units ?? units, line.case_name, line.units_to_go),
        );
        void refresh();
        return;
      }
      const code = errorCode(reply.body);
      if (code === 'cutoff_passed') {
        block.clearRetry();
        latchCutoff();
        pledgeUpdates.say(copy.pledgeCutoff(block.line.case_name));
      } else if (code === 'not_enough_units') {
        block.clearRetry();
        pledgeUpdates.say(copy.pledgeTooFew(block.line.units_to_go, block.line.case_name));
        void refresh();
      } else if (code === 'insufficient_credit') {
        block.clearRetry();
        pledgeUpdates.say(copy.pledgeNoCredit(block.line.case_name));
      } else {
        block.clearRetry();
        pledgeUpdates.say(copy.pledgeNoResponse(block.line.case_name));
      }
    } catch (error) {
      pledgeInFlight.delete(block.productId);
      block.setPledgePending(false);
      if (error instanceof NoResponseError) {
        pledgeUpdates.say(copy.pledgeNoResponse(block.line.case_name));
        return;
      }
      throw error;
    }
  }

  async function sendWithdraw(block: CaseBlock, key: string): Promise<void> {
    block.setWithdrawPending(true);
    pledgeInFlight.add(block.productId);
    try {
      const reply = await request<{ line: Line; credit: Credit }>(
        'DELETE',
        `/api/cycles/${cycleId}/lines/${block.productId}/pledge`,
        { idempotencyKey: key },
      );
      pledgeInFlight.delete(block.productId);
      block.setWithdrawPending(false);
      if (reply.ok) {
        creditSeq = currentSeq();
        paintCredit(reply.body.credit);
        const line = reply.body.line;
        if (lines.accept(line)) {
          block.drawLine(line, 'sequence');
          block.setShortNotice(ownShortUnits(line), line.my_units ?? 0);
        }
        pledgeUpdates.say(copy.withdrew(line.case_name, line.units_to_go));
        void refresh();
        return;
      }
      const code = errorCode(reply.body);
      if (code === 'cutoff_passed') {
        latchCutoff();
        pledgeUpdates.say(copy.pledgeCutoff(block.line.case_name));
      } else {
        pledgeUpdates.say(copy.pledgeNoResponse(block.line.case_name));
      }
    } catch (error) {
      pledgeInFlight.delete(block.productId);
      block.setWithdrawPending(false);
      if (error instanceof NoResponseError) {
        pledgeUpdates.say(copy.pledgeNoResponse(block.line.case_name));
        return;
      }
      throw error;
    }
  }

  function openWithdrawDialog(block: CaseBlock): void {
    const opener = block.withdraw ?? block.unitsControl;
    const confirm = el('button', { type: 'button', class: 'primary', text: 'Withdraw' }) as HTMLButtonElement;
    const keep = el('button', { type: 'button', text: 'Keep pledge' }) as HTMLButtonElement;
    const dialog = new Dialog({
      title: 'Withdraw pledge',
      build: (body) => {
        body.append(
          el('p', { text: `Withdraw your ${block.line.my_units ?? 0} from ${block.line.case_name}?` }),
        );
      },
      footer: [confirm, keep],
      initialFocus: () => keep,
      returnFocus: () => (opener.isConnected ? opener : null),
    });
    const key = newIdempotencyKey();
    confirm.addEventListener('click', () => {
      dialog.close({ returnFocus: false });
      void sendWithdraw(block, key);
    });
    keep.addEventListener('click', () => dialog.close());
    withdrawDialog?.destroy();
    withdrawDialog = dialog;
    dialog.open();
  }

  function openTopUpDialog(): void {
    const amount = el('input', {
      type: 'text',
      inputmode: 'decimal',
      class: 'amount-input',
      'aria-label': 'Amount in dollars',
      id: 'topup-amount',
    }) as HTMLInputElement;
    const error = el('p', { class: 'field-error', id: 'topup-amount-error' });
    const confirm = el('button', { type: 'button', class: 'primary', text: 'Confirm top-up' }) as HTMLButtonElement;
    const cancel = el('button', { type: 'button', text: 'Cancel' }) as HTMLButtonElement;
    const dialog = new Dialog({
      title: 'Top up credit',
      build: (body) => {
        body.append(el('label', { for: 'topup-amount', class: 'label', text: 'AMOUNT IN DOLLARS' }), amount, error);
      },
      footer: [confirm, cancel],
      initialFocus: () => amount,
      returnFocus: () => topUpButton,
    });
    let key = newIdempotencyKey();
    let sentText: string | null = null;
    const showError = (text: string): void => {
      setText(error, text);
      amount.setAttribute('aria-describedby', 'topup-amount-error');
      creditUpdates.say(text);
    };
    amount.addEventListener('input', () => {
      if (sentText !== null && amount.value !== sentText) {
        key = newIdempotencyKey();
        sentText = null;
      }
      setText(error, '');
      amount.removeAttribute('aria-describedby');
    });
    const send = async (): Promise<void> => {
      if (isBusy(confirm)) return;
      const text = amount.value;
      sentText = text;
      setBusy(confirm, true, { busy: 'Confirming...', idle: 'Confirm top-up' });
      try {
        const reply = await request<{ credit: Credit; topup: { amount_cents: number } }>('POST', '/api/topups', {
          body: { amount: text },
          idempotencyKey: key,
        });
        setBusy(confirm, false, { busy: 'Confirming...', idle: 'Confirm top-up' });
        if (reply.status === 201) {
          creditSeq = currentSeq();
          paintCredit(reply.body.credit);
          dialog.close();
          creditUpdates.say(copy.topupConfirmed(reply.body.topup.amount_cents, reply.body.credit.spendable_cents));
          void refresh();
          return;
        }
        const code = errorCode(reply.body);
        if (code === 'payments_paused') {
          shell.checkPayments();
          showError(copy.paymentsPaused);
          creditUpdates.say(copy.topupNotTaken);
        } else if (code === 'idempotency_key_reused') {
          showError(copy.topupKeyReused);
        } else {
          showError(errorFields(reply.body).amount ?? copy.topupAmountError);
        }
      } catch (error) {
        setBusy(confirm, false, { busy: 'Confirming...', idle: 'Confirm top-up' });
        if (error instanceof NoResponseError) {
          showError(copy.topupNoResponse);
          confirm.focus();
          return;
        }
        throw error;
      }
    };
    confirm.addEventListener('click', () => void send());
    cancel.addEventListener('click', () => dialog.close());
    topUpDialog?.destroy();
    topUpDialog = dialog;
    dialog.open();
  }

  topUpButton.addEventListener('click', () => openTopUpDialog());

  function onResize(): void {
    const nextWide = isWideLayout();
    if (nextWide === wide) return;
    const active = document.activeElement as HTMLElement | null;
    const wasOpenTab = active === openTab;
    const wasSealedTab = active === sealedTab;
    const wasRail = active === sealedRail;
    const focusedBlock = [...blocks.values()].find((block) => block.article.contains(active));
    wide = nextWide;
    if (!wide && focusedBlock) selectedTab = focusedBlock.isSealed ? 'sealed' : 'open';
    else if (!wide && wasRail) selectedTab = 'sealed';
    else if (!wide && !focusedBlock) selectedTab = 'open';
    buildLayout();
    placeBlocks();
    if (wide) {
      if (wasSealedTab) sealedRail?.focus();
      else if (wasOpenTab) {
        const firstOpen = cycle?.lines
          .map((line) => blocks.get(line.product_id))
          .find((block) => block && !block.isSealed);
        if (firstOpen) firstOpen.focusUnits();
        else sealedRail?.focus();
      } else if (active && active.isConnected) active.focus();
    } else if (wasRail) {
      sealedTab?.focus();
    } else if (active && active.isConnected) {
      active.focus();
    }
    for (const block of blocks.values()) block.crate.requestDraw('size');
  }

  const resizeListener = (): void => onResize();

  return {
    element,
    start() {
      buildLayout();
      window.addEventListener('resize', resizeListener);
      void refresh();
      refreshTimer = window.setInterval(() => void refresh(), REFRESH_MS);
    },
    destroy() {
      destroyed = true;
      if (refreshTimer !== null) window.clearInterval(refreshTimer);
      window.removeEventListener('resize', resizeListener);
      topUpDialog?.destroy();
      withdrawDialog?.destroy();
      for (const block of blocks.values()) block.destroy();
      blocks.clear();
      lines.forget();
      shell.setBanner('cutoff', null);
    },
  };
}
