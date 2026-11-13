import { ApiFailure, FailureContext, Me, api, cachedIdentity, faultCopy, householdPath, newIdempotencyKey } from '../api';
import { Screen, onLiveEntry, registerDialogSnapshot, say, takeKeptDialog } from '../app';
import { openModal } from '../dialogs';
import { Keyed, el, emptyState, fieldError, isPending, labelled, pendingButton, reconcile, textbox } from '../dom';
import {
  formatDmy,
  formatDmyHm,
  formatMebibytes,
  formatMoney,
  formatShare,
  instantWallClock,
  parseDmy,
  parseShareBp,
  parseTimeOfDay,
  splitPercents,
} from '../../../lib/format';
import { formatInstant, wallClockToInstant } from '../../../domain/time';
import { CostJson, openDeclineDialog, stateWords } from './requests';

const categories: [string, string][] = [
  ['medical', 'Medical'],
  ['school', 'School'],
  ['activities', 'Activities'],
  ['child_care', 'Childcare'],
  ['clothing', 'Clothing'],
  ['other', 'Other'],
];

interface Statement {
  householdId: string;
  currency: string;
  balance: { owedBy: 'planning' | 'other'; owedTo: 'planning' | 'other'; minor: number } | null;
  years: { year: number; costs: number; amountMinor: number; shares: { planning: number; other: number } }[];
}

function parseAmount(text: string, exponent: number): number | null {
  const trimmed = text.trim().replace(/[\u202f ]/g, '');
  const pattern = exponent === 0 ? /^\d+$/ : new RegExp(`^\\d+(,\\d{1,${exponent}})?$`);
  if (!pattern.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split(',') as [string, string?];
  const padded = (fraction ?? '').padEnd(exponent, '0');
  return Number.parseInt(`${whole}${padded}`, 10);
}

function formatAmountInput(minor: number, exponent: number): string {
  const text = String(minor).padStart(exponent + 1, '0');
  if (exponent === 0) return text;
  return `${text.slice(0, text.length - exponent)},${text.slice(text.length - exponent)}`;
}

const QUOTE_DEBOUNCE_MS = 250;
const RECEIPT_LIMIT_BYTES = 5 * 1024 * 1024;

export function costsScreen(): Screen {
  let stopLive: (() => void) | null = null;

  return {
    async mount(main: HTMLElement): Promise<void> {
      const me = cachedIdentity() as Me;
      const money = (minor: number): string =>
        formatMoney(minor, me.household.currency, me.household.currencyExponent);
      const nameOf = (role: 'planning' | 'other'): string =>
        role === 'planning' ? me.household.planningName : me.household.otherName;

      const logButton = el('button', { type: 'button', class: 'pill', text: 'Log a cost' });
      const SHARE_COPY = 'Enter a share from 0 to 100 with at most two decimals, using a comma.';
      const REAL_DATE = 'Enter a real date as DD/MM/YYYY.';
      const AMOUNT_COPY = `Enter the amount using a decimal comma, with at most ${me.household.currencyExponent} decimal places.`;
      const GAP_COPY = "That time doesn't exist on that date. Choose another.";
      const ledgerBody = el('tbody', {});
      const ledger = el('table', { 'aria-label': 'Cost ledger', class: 'ledger', tabindex: '-1' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'Incurred' }),
            el('th', { text: 'Custody day' }),
            el('th', { text: 'Description' }),
            el('th', { text: 'Amount' }),
            el('th', { text: 'Paid by' }),
            el('th', { text: 'Split' }),
            el('th', { text: `${me.household.planningName}'s share` }),
            el('th', { text: `${me.household.otherName}'s share` }),
            el('th', { text: 'Status' }),
          ]),
        ]),
        ledgerBody,
      ]);
      const balanceRegion = el('section', { role: 'region', 'aria-label': 'Balance', class: 'card balance-card' });
      const emptyHolder = emptyState('No shared costs yet.');
      main.append(
        el('div', { class: 'costs-body' }, [
          el('section', { class: 'card log-button-card' }, [logButton]),
          el('section', { class: 'card ledger-card' }, [
            el('h2', { class: 'card-title', text: 'Cost ledger' }),
            el('div', { class: 'ledger-scroller' }, [ledger]),
            emptyHolder,
          ]),
          balanceRegion,
        ]),
      );

      logButton.addEventListener('click', () => openCostDialog(null, logButton));

      function openCostDialog(existing: { cost: CostJson; etag: string | null } | null, opener: HTMLElement, kept?: Record<string, string>): void {
        const description = textbox('Description', { value: kept?.description ?? existing?.cost.description ?? '' });
        const category = el('select', { 'aria-label': 'Category' });
        for (const [value, label] of categories) category.append(el('option', { value, text: label }));
        category.value = kept?.category ?? existing?.cost.category ?? 'other';
        const amount = textbox('Amount', {
          value:
            kept?.amount ??
            (existing ? formatAmountInput(existing.cost.amountMinor, me.household.currencyExponent) : ''),
        });
        const incurred = existing ? instantWallClock(existing.cost.incurredAt) : null;
        const date = textbox('Date', {
          value: kept?.date ?? (incurred ? formatDmy(incurred.date) : formatDmy(me.household.today)),
        });
        const time = textbox('Time', { value: kept?.time ?? (incurred ? incurred.time : '12:00') });
        const note = textbox('Note', { value: kept?.note ?? existing?.cost.note ?? '' });
        const splitStatus = el('p', { role: 'status', 'aria-label': 'Cost split', class: 'split-line' });
        const saveDraft = el('button', { type: 'button', class: 'plain-button', text: 'Save draft' });
        const sendRequest = el('button', { type: 'button', class: 'pill', text: 'Send request' });
        const cancel = el('button', { type: 'button', class: 'plain-button', text: 'Cancel' });
        const modal = openModal({
          title: 'Log a cost',
          content: [
            labelled('Description', description),
            labelled('Category', category),
            labelled('Amount', amount),
            labelled('Date', date),
            labelled('Time', time),
            labelled('Note', note),
            splitStatus,
          ],
          actions: [saveDraft, sendRequest, cancel],
          opener,
          onClose: () => registerDialogSnapshot(null),
        });
        registerDialogSnapshot(() => ({
          kind: 'cost',
          values: {
            description: description.value,
            category: category.value,
            amount: amount.value,
            date: date.value,
            time: time.value,
            note: note.value,
          },
        }));
        cancel.addEventListener('click', () => modal.close());

        let quoteTimer = 0;
        let quoteSequence = 0;

        /** The typed date and time as an instant in the household zone, or the copy for what is wrong with them. */
        function incurredAt(): { at: string } | { message: string; control: HTMLElement } {
          const day = parseDmy(date.value);
          if (!day) return { message: REAL_DATE, control: date };
          const minuteOfDay = parseTimeOfDay(time.value);
          if (minuteOfDay === null) return { message: 'Enter a time as HH:MM.', control: time };
          const resolved = wallClockToInstant(me.household.zone, day, minuteOfDay);
          if (resolved.resolution === 'gap') return { message: GAP_COPY, control: time };
          return { at: formatInstant(me.household.zone, resolved.epochMs) };
        }

        function requestQuote(): void {
          window.clearTimeout(quoteTimer);
          const sequence = ++quoteSequence;
          const amountMinor = parseAmount(amount.value, me.household.currencyExponent);
          if (amountMinor === null) {
            splitStatus.textContent = AMOUNT_COPY;
            return;
          }
          const moment = incurredAt();
          if ('message' in moment) {
            splitStatus.textContent = moment.message;
            return;
          }
          quoteTimer = window.setTimeout(() => {
            void (async () => {
              try {
                const result = await api<{ shares: { planning: number; other: number } }>(
                  'POST',
                  householdPath('/costs/quote'),
                  { json: { amountMinor, incurredAt: moment.at } },
                );
                if (sequence !== quoteSequence) return;
                splitStatus.textContent =
                  `${me.household.planningName} pays ${money(result.data.shares.planning)}, ` +
                  `${me.household.otherName} pays ${money(result.data.shares.other)}`;
              } catch (error) {
                if (sequence !== quoteSequence) return;
                splitStatus.textContent = faultCopy(error);
              }
            })();
          }, QUOTE_DEBOUNCE_MS);
        }

        for (const control of [amount, date, time]) {
          control.addEventListener('input', () => {
            fieldError(control, null);
            requestQuote();
          });
        }
        requestQuote();

        function refuse(control: HTMLElement, message: string): null {
          fieldError(control, message);
          modal.showAlert(message);
          control.focus();
          return null;
        }

        /** What Send request posts, or what Save draft patches: only the fields that differ from the stored cost. */
        function readBody(): Record<string, unknown> | null {
          const amountMinor = parseAmount(amount.value, me.household.currencyExponent);
          if (amountMinor === null) return refuse(amount, AMOUNT_COPY);
          const moment = incurredAt();
          if ('message' in moment) return refuse(moment.control, moment.message);
          const typed = {
            description: description.value,
            category: category.value,
            amountMinor,
            incurredAt: moment.at,
            note: note.value.trim() === '' ? null : note.value,
          };
          if (!existing) return typed;
          const stored = existing.cost;
          const changed: Record<string, unknown> = {};
          for (const field of ['description', 'category', 'amountMinor', 'incurredAt', 'note'] as const) {
            if (typed[field] !== stored[field]) changed[field] = typed[field];
          }
          return changed;
        }

        const controls: Record<string, HTMLElement> = { description, category, amountMinor: amount, incurredAt: date, note };

        async function submit(send: boolean): Promise<void> {
          modal.showAlert(null);
          const body = readBody();
          if (!body) return;
          const button = send ? sendRequest : saveDraft;
          pendingButton(button, true, send ? 'Sending...' : 'Saving...');
          try {
            let id = existing?.cost.id ?? null;
            let etag = existing?.etag ?? null;
            if (id) {
              if (Object.keys(body).length > 0) {
                const patched = await api<CostJson>('PATCH', householdPath(`/costs/${id}`), {
                  json: body,
                  ifMatch: etag ?? undefined,
                });
                etag = patched.etag;
              }
            } else {
              const created = await api<CostJson>('POST', householdPath('/costs'), {
                json: body,
                idempotencyKey: newIdempotencyKey(),
              });
              id = created.data.id;
              etag = created.etag;
            }
            if (send) {
              await api('POST', householdPath(`/costs/${id}/send`), {
                ifMatch: etag ?? undefined,
                idempotencyKey: newIdempotencyKey(),
              });
              say('Request sent. An email notice is on its way.');
            } else {
              say('Draft saved.');
            }
            modal.close();
            await paint();
          } catch (error) {
            const message = faultCopy(error);
            const field = error instanceof ApiFailure ? error.firstFieldError : null;
            const control = field ? controls[field.field] : undefined;
            if (control) {
              fieldError(control, message);
              control.focus();
            }
            modal.showAlert(message);
            say(message);
            if (error instanceof ApiFailure && error.code === 'precondition_failed') await paint();
          } finally {
            pendingButton(button, false, '');
          }
        }

        saveDraft.addEventListener('click', () => {
          if (!isPending(saveDraft)) void submit(false);
        });
        sendRequest.addEventListener('click', () => {
          if (!isPending(sendRequest)) void submit(true);
        });
      }

      function openSplitDialog(cost: CostJson, etag: string | null, opener: HTMLElement): void {
        const shareLabel = `Agreed share for ${me.household.planningName} (%)`;
        const share = textbox(shareLabel, {
          value: cost.agreedSplitBp ? formatShare(cost.agreedSplitBp.planning) : '',
        });
        const save = el('button', { type: 'button', class: 'plain-button', text: 'Save split' });
        const usePlan = el('button', { type: 'button', class: 'plain-button', text: 'Use plan split' });
        const cancel = el('button', { type: 'button', class: 'plain-button', text: 'Cancel' });
        const modal = openModal({
          title: 'Edit split',
          content: [labelled(shareLabel, share)],
          actions: [save, usePlan, cancel],
          opener,
        });
        cancel.addEventListener('click', () => modal.close());

        async function write(agreedSplitBp: { planning: number; other: number } | null, button: HTMLButtonElement): Promise<void> {
          pendingButton(button, true, 'Saving...');
          try {
            await api<CostJson>('PATCH', householdPath(`/costs/${cost.id}`), {
              json: { agreedSplitBp },
              ifMatch: etag ?? undefined,
            });
            say('Split saved.');
            modal.close();
            await paint();
          } catch (error) {
            const message = faultCopy(error);
            modal.showAlert(message);
            say(message);
            if (error instanceof ApiFailure && error.code === 'precondition_failed') await paint();
          } finally {
            pendingButton(button, false, '');
          }
        }

        save.addEventListener('click', () => {
          if (isPending(save)) return;
          if (share.value.trim() === '') {
            void write(null, save);
            return;
          }
          const planning = parseShareBp(share.value);
          if (planning === null) {
            fieldError(share, SHARE_COPY);
            modal.showAlert(SHARE_COPY);
            share.focus();
            return;
          }
          void write({ planning, other: 10000 - planning }, save);
        });
        usePlan.addEventListener('click', () => {
          if (!isPending(usePlan)) void write(null, usePlan);
        });
      }

      function receiptLink(cost: CostJson, index: number): HTMLElement {
        const receipt = cost.receipts[index] as CostJson['receipts'][number];
        const link = el('a', { href: '#', class: 'plain-link', text: `Receipt ${index + 1}` });
        link.addEventListener('click', (event) => {
          event.preventDefault();
          void (async () => {
            try {
              const result = await api<ArrayBuffer>(
                'GET',
                householdPath(`/costs/${cost.id}/receipts/${receipt.id}`),
                { raw: true },
              );
              const url = URL.createObjectURL(new Blob([result.data], { type: receipt.contentType }));
              el('a', { href: url, download: receipt.filename }).click();
              URL.revokeObjectURL(url);
            } catch (error) {
              say(faultCopy(error));
            }
          })();
        });
        return el('span', { class: 'receipt' }, [link, el('span', { class: 'receipt-size', text: formatMebibytes(receipt.bytes) })]);
      }

      /** One receipt upload. A failed one can be tried again with the same file and the same key, so it stores once. */
      function attachReceipt(cost: CostJson, etag: string | null): HTMLElement {
        const button = el('button', { type: 'button', class: 'plain-button', text: 'Attach receipt' });
        const retry = el('button', { type: 'button', class: 'plain-button', text: 'Try again' });
        retry.hidden = true;
        const picker = el('input', { type: 'file', class: 'file-picker', 'aria-hidden': 'true', tabindex: '-1' });
        let failed: { file: File; key: string } | null = null;

        async function upload(file: File, key: string): Promise<void> {
          pendingButton(button, true, 'Uploading receipt...');
          say('Uploading receipt...');
          try {
            await api('POST', householdPath(`/costs/${cost.id}/receipts?filename=${encodeURIComponent(file.name)}`), {
              body: await file.arrayBuffer(),
              contentType: 'application/octet-stream',
              ifMatch: etag ?? undefined,
              idempotencyKey: key,
            });
            failed = null;
            retry.hidden = true;
            say('Receipt stored.');
          } catch (error) {
            const storageDown = error instanceof ApiFailure && error.code === 'storage_unavailable';
            failed = storageDown ? { file, key } : null;
            retry.hidden = !storageDown;
            say(faultCopy(error));
          } finally {
            pendingButton(button, false, '');
            await paint();
            if (!button.isConnected) (ledgerBody.querySelector<HTMLElement>(`[data-key="${cost.id}"]`) ?? ledger).focus();
          }
        }

        picker.addEventListener('change', () => {
          const file = picker.files?.[0];
          picker.value = '';
          if (!file) return;
          if (file.size > RECEIPT_LIMIT_BYTES) {
            say('Receipts can be up to 5 MiB.');
            return;
          }
          void upload(file, newIdempotencyKey());
        });
        button.addEventListener('click', () => picker.click());
        retry.addEventListener('click', () => {
          if (failed && !isPending(button)) void upload(failed.file, failed.key);
        });
        return el('span', { class: 'attach-holder' }, [button, retry, picker]);
      }

      async function act(button: HTMLButtonElement, row: HTMLElement, pendingText: string, run: () => Promise<void>, context: FailureContext): Promise<void> {
        if (isPending(button)) return;
        const costKey = row.dataset.key as string;
        const wasFocused = document.activeElement === button;
        pendingButton(button, true, pendingText);
        try {
          await run();
        } catch (error) {
          say(faultCopy(error, context));
        } finally {
          pendingButton(button, false, '');
          await paint();
          if (wasFocused && !button.isConnected) {
            (ledgerBody.querySelector<HTMLElement>(`[data-key="${costKey}"]`) ?? ledger).focus();
          }
        }
      }

      function costRow(cost: CostJson, etag: string | null): HTMLElement {
        const row = el('tr', { class: `ledger-row paid-by-${cost.paidBy}`, tabindex: '-1' });
        const [planningPercent, otherPercent] = splitPercents(cost.splitBp.planning);
        const cells: [string, string, string?][] = [
          ['Incurred', formatDmyHm(cost.incurredAt)],
          ['Custody day', formatDmy(cost.custodyDay)],
          ['Description', cost.description],
          ['Amount', money(cost.amountMinor)],
          ['Paid by', nameOf(cost.paidBy), `chip chip-${cost.paidBy}`],
          ['Split', `${planningPercent}/${otherPercent}`],
          [`${me.household.planningName}'s share`, money(cost.shares.planning), 'chip chip-planning'],
          [`${me.household.otherName}'s share`, money(cost.shares.other), 'chip chip-other'],
          ['Status', stateWords[cost.state] ?? cost.state],
        ];
        for (const [label, value, chipClass] of cells) {
          row.append(
            el('td', { 'data-label': label }, [
              el('span', { class: 'cell-label', text: label }),
              el('span', { class: chipClass, text: value }),
            ]),
          );
        }
        const actions = el('td', { class: 'row-actions-cell' });
        const mine = cost.paidBy === me.role;
        const context: FailureContext = { lapsed: { answerBy: cost.answerBy, zone: cost.answerZone ?? me.household.zone }, storageDid: 'deleted' };
        const button = (text: string, pendingText: string, work: () => Promise<void>): HTMLButtonElement => {
          const control = el('button', { type: 'button', class: 'plain-button', text });
          control.addEventListener('click', () => void act(control, row, pendingText, work, context));
          return control;
        };
        const post = (verb: string, copy: string) => async (): Promise<void> => {
          await api('POST', householdPath(`/costs/${cost.id}/${verb}`), {
            ifMatch: etag ?? undefined,
            idempotencyKey: newIdempotencyKey(),
          });
          say(copy);
        };
        if (cost.state === 'draft' && mine) {
          const edit = el('button', { type: 'button', class: 'plain-button', text: 'Edit draft' });
          edit.addEventListener('click', () => openCostDialog({ cost, etag }, edit));
          actions.append(
            edit,
            button('Send', 'Sending...', post('send', 'Request sent. An email notice is on its way.')),
            button('Delete draft', 'Deleting...', async () => {
              await api('DELETE', householdPath(`/costs/${cost.id}`), { ifMatch: etag ?? undefined });
              say('Draft deleted.');
            }),
          );
        }
        if (cost.state === 'draft' || cost.state === 'sent') {
          const split = el('button', { type: 'button', class: 'plain-button', text: 'Edit split' });
          split.addEventListener('click', () => openSplitDialog(cost, etag, split));
          actions.append(split);
        }
        if (mine && (cost.state === 'draft' || cost.state === 'sent' || cost.state === 'accepted')) {
          actions.append(attachReceipt(cost, etag));
        }
        if (cost.state === 'sent' && !mine) {
          const decline = el('button', { type: 'button', class: 'plain-button', text: 'Decline' });
          decline.addEventListener('click', () => {
            openDeclineDialog({
              opener: decline,
              onDecline: async (reason) => {
                await api('POST', householdPath(`/costs/${cost.id}/decline`), {
                  json: { reason },
                  ifMatch: etag ?? undefined,
                  idempotencyKey: newIdempotencyKey(),
                });
                say('Request declined.');
                await paint();
              },
            });
          });
          actions.append(button('Accept', 'Accepting...', post('accept', 'Reimbursement accepted.')), decline);
        }
        if (cost.state === 'sent' && mine) {
          actions.append(button('Withdraw', 'Withdrawing...', post('withdraw', 'Request withdrawn.')));
        }
        if (cost.state === 'accepted' && mine) {
          actions.append(button('Settle', 'Settling...', post('settle', 'Marked as settled.')));
        }
        cost.receipts.forEach((_receipt, index) => actions.append(receiptLink(cost, index)));
        row.append(actions);
        return row;
      }

      async function paintBalance(): Promise<void> {
        const result = await api<Statement>('GET', householdPath('/statement'));
        const statement = result.data;
        const lines: HTMLElement[] = [];
        if (!statement.balance) {
          lines.push(el('p', { text: 'All square.' }));
        } else {
          lines.push(
            el('p', {
              text: `${nameOf(statement.balance.owedBy)} owes ${nameOf(statement.balance.owedTo)} ${money(
                statement.balance.minor,
              )}`,
            }),
          );
          const signed = statement.balance.owedBy === me.role ? -statement.balance.minor : statement.balance.minor;
          lines.push(el('p', { text: `Your balance: ${money(signed)}` }));
        }
        for (const year of statement.years) {
          lines.push(
            el('p', {
              text: `${year.year}: ${year.costs} costs, ${money(year.amountMinor)} (${me.household.planningName} ${money(
                year.shares.planning,
              )}, ${me.household.otherName} ${money(year.shares.other)})`,
            }),
          );
        }
        balanceRegion.replaceChildren(el('h2', { class: 'card-title', text: 'Balance' }), ...lines);
      }

      async function paint(): Promise<void> {
        const list = await api<{ items: CostJson[] }>('GET', householdPath('/costs?limit=100'));
        const costs = await Promise.all(
          list.data.items.map((cost) => api<CostJson>('GET', householdPath(`/costs/${cost.id}`))),
        );
        const entries: Keyed[] = costs.map(({ data, etag }) => ({
          key: data.id,
          signature: `${etag ?? ''}|${data.state}`,
          build: () => costRow(data, etag),
        }));
        reconcile(ledgerBody, entries);
        emptyHolder.hidden = costs.length > 0;
        ledger.hidden = costs.length === 0;
        await paintBalance();
      }

      await paint();
      const kept = takeKeptDialog();
      if (kept && kept.kind === 'cost') openCostDialog(null, logButton, kept.values);
      stopLive = onLiveEntry(() => {
        void paint();
      });

      this.dispose = (): void => {
        stopLive?.();
      };
    },
  };
}
