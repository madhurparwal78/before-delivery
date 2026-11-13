import { ApiFailure, Me, api, cachedIdentity, householdPath, loadIdentity, newIdempotencyKey } from '../api';
import { Screen, onLiveEntry, registerDialogSnapshot, say, takeKeptDialog } from '../app';
import { openModal } from '../dialogs';
import { el, fieldError, isPending, labelled, pendingButton, textbox } from '../dom';
import {
  formatDmy,
  formatDmyHm,
  formatMoney,
  instantWallClock,
  parseDmy,
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

export function parseAmount(text: string, exponent: number): number | null {
  const trimmed = text.trim().replace(/[\u202f ]/g, '');
  const pattern = exponent === 0 ? /^\d+$/ : new RegExp(`^\\d+(,\\d{1,${exponent}})?$`);
  if (!pattern.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split(',') as [string, string?];
  const padded = (fraction ?? '').padEnd(exponent, '0');
  return Number.parseInt(`${whole}${padded}`, 10);
}

export function formatAmountInput(minor: number, exponent: number): string {
  const text = String(minor).padStart(exponent + 1, '0');
  if (exponent === 0) return text;
  return `${text.slice(0, text.length - exponent)},${text.slice(text.length - exponent)}`;
}

export function costsScreen(): Screen {
  let stopLive: (() => void) | null = null;

  return {
    async mount(main: HTMLElement): Promise<void> {
      const me = (cachedIdentity() ?? (await loadIdentity())) as Me;
      const money = (minor: number): string =>
        formatMoney(minor, me.household.currency, me.household.currencyExponent);
      const nameOf = (role: 'planning' | 'other'): string =>
        role === 'planning' ? me.household.planningName : me.household.otherName;

      const logButton = el('button', { type: 'button', class: 'pill', text: 'Log a cost' });
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
      const emptyLine = el('p', { class: 'empty-line', text: 'No shared costs yet.' });
      main.append(
        el('div', { class: 'costs-body' }, [
          el('section', { class: 'card ledger-card' }, [
            el('h2', { class: 'card-title', text: 'Cost ledger' }),
            el('div', { class: 'ledger-scroller' }, [ledger]),
            emptyLine,
          ]),
          el('section', { class: 'card' }, [logButton]),
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

        function incurredAt(): string | null {
          const day = parseDmy(date.value);
          const match = /^(\d{2}):(\d{2})$/.exec(time.value.trim());
          if (!day || !match) return null;
          const minuteOfDay = Number.parseInt(match[1] as string, 10) * 60 + Number.parseInt(match[2] as string, 10);
          const resolved = wallClockToInstant(me.household.zone, day, minuteOfDay);
          if (resolved.resolution === 'gap') return null;
          return formatInstant(me.household.zone, resolved.epochMs);
        }

        function requestQuote(): void {
          window.clearTimeout(quoteTimer);
          const amountMinor = parseAmount(amount.value, me.household.currencyExponent);
          if (amountMinor === null) {
            quoteSequence += 1;
            splitStatus.textContent = `Enter the amount using a decimal comma, with at most ${me.household.currencyExponent} decimal places.`;
            return;
          }
          const at = incurredAt();
          if (at === null) {
            quoteSequence += 1;
            splitStatus.textContent = parseDmy(date.value)
              ? "That time doesn't exist on that date. Choose another."
              : 'Enter a real date as DD/MM/YYYY.';
            return;
          }
          const sequence = ++quoteSequence;
          quoteTimer = window.setTimeout(() => {
            void (async () => {
              try {
                const result = await api<{ shares: { planning: number; other: number } }>(
                  'POST',
                  householdPath('/costs/quote'),
                  { json: { amountMinor, incurredAt: at } },
                );
                if (sequence !== quoteSequence) return;
                splitStatus.textContent =
                  `${me.household.planningName} pays ${money(result.data.shares.planning)}, ` +
                  `${me.household.otherName} pays ${money(result.data.shares.other)}`;
              } catch (error) {
                if (sequence !== quoteSequence) return;
                if (error instanceof ApiFailure) {
                  const field = error.firstFieldError;
                  if (field) splitStatus.textContent = field.message;
                }
              }
            })();
          }, 250);
        }

        for (const control of [amount, date, time]) {
          control.addEventListener('input', () => {
            fieldError(control, null);
            requestQuote();
          });
        }
        requestQuote();

        function readBody(): Record<string, unknown> | null {
          const amountMinor = parseAmount(amount.value, me.household.currencyExponent);
          if (amountMinor === null) {
            const message = `Enter the amount using a decimal comma, with at most ${me.household.currencyExponent} decimal places.`;
            fieldError(amount, message);
            modal.alert(message);
            amount.focus();
            return null;
          }
          const day = parseDmy(date.value);
          if (!day) {
            fieldError(date, 'Enter a real date as DD/MM/YYYY.');
            modal.alert('Enter a real date as DD/MM/YYYY.');
            date.focus();
            return null;
          }
          const at = incurredAt();
          if (at === null) {
            fieldError(time, "That time doesn't exist on that date. Choose another.");
            modal.alert("That time doesn't exist on that date. Choose another.");
            time.focus();
            return null;
          }
          return {
            description: description.value,
            category: category.value,
            amountMinor,
            incurredAt: at,
            note: note.value.trim() === '' ? null : note.value,
          };
        }

        const controls: Record<string, HTMLElement> = { description, category, amountMinor: amount, incurredAt: date, note };

        async function submit(send: boolean): Promise<void> {
          modal.alert(null);
          const body = readBody();
          if (!body) return;
          const button = send ? sendRequest : saveDraft;
          pendingButton(button, true, send ? 'Sending...' : 'Saving...');
          try {
            let id = existing?.cost.id ?? null;
            let etag = existing?.etag ?? null;
            if (id) {
              const patched = await api<CostJson>('PATCH', householdPath(`/costs/${id}`), {
                json: body,
                ifMatch: etag ?? undefined,
              });
              etag = patched.etag;
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
            if (error instanceof ApiFailure) {
              if (error.code === 'precondition_failed') {
                say('This changed while you were looking. It now shows the latest version.');
                modal.alert('This changed while you were looking. It now shows the latest version.');
                await paint();
              } else {
                const field = error.firstFieldError;
                if (field) {
                  const control = controls[field.field];
                  if (control) {
                    fieldError(control, field.message);
                    control.focus();
                  }
                  modal.alert(field.message);
                  say(field.message);
                } else {
                  modal.alert(error.problem.title);
                  say(error.problem.title);
                }
              }
            }
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
        const share = textbox(`Agreed share for ${me.household.planningName} (%)`, {
          value: cost.agreedSplitBp ? String(cost.agreedSplitBp.planning / 100).replace('.', ',') : '',
        });
        const save = el('button', { type: 'button', class: 'pill', text: 'Save split' });
        const usePlan = el('button', { type: 'button', class: 'plain-button', text: 'Use plan split' });
        const cancel = el('button', { type: 'button', class: 'plain-button', text: 'Cancel' });
        const modal = openModal({
          title: 'Edit split',
          content: [labelled(`Agreed share for ${me.household.planningName} (%)`, share)],
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
            if (error instanceof ApiFailure) {
              if (error.code === 'precondition_failed') {
                say('This changed while you were looking. It now shows the latest version.');
                modal.alert('This changed while you were looking. It now shows the latest version.');
                await paint();
              } else {
                const field = error.firstFieldError;
                modal.alert(field ? field.message : error.problem.title);
                say(field ? field.message : error.problem.title);
                if (field) share.focus();
              }
            }
          } finally {
            pendingButton(button, false, '');
          }
        }

        save.addEventListener('click', () => {
          if (isPending(save)) return;
          const text = share.value.trim();
          if (text === '') {
            void write(null, save);
            return;
          }
          if (!/^\d{1,3}(,\d{1,2})?$/.test(text)) {
            const message = 'Enter a share from 0 to 100 with at most two decimals, using a comma.';
            fieldError(share, message);
            modal.alert(message);
            share.focus();
            return;
          }
          const value = Number.parseFloat(text.replace(',', '.'));
          if (value < 0 || value > 100) {
            const message = 'Enter a share from 0 to 100 with at most two decimals, using a comma.';
            fieldError(share, message);
            modal.alert(message);
            share.focus();
            return;
          }
          const planning = Math.round(value * 100);
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
              const blob = new Blob([result.data], { type: receipt.contentType });
              const url = URL.createObjectURL(blob);
              const anchor = el('a', { href: url, download: receipt.filename });
              anchor.click();
              URL.revokeObjectURL(url);
            } catch (error) {
              if (error instanceof ApiFailure && error.code === 'storage_unavailable') {
                say('Couldn\u2019t reach storage \u2013 nothing was saved. Try again.');
              }
            }
          })();
        });
        return link;
      }

      function attachReceipt(cost: CostJson, etag: string | null): HTMLElement {
        const button = el('button', { type: 'button', class: 'plain-button', text: 'Attach receipt' });
        const picker = el('input', { type: 'file', class: 'file-picker', 'aria-hidden': 'true', tabindex: '-1' });
        picker.addEventListener('change', () => {
          const file = picker.files?.[0];
          if (!file) return;
          if (file.size > 5242880) {
            say('Receipts can be up to 5 MiB.');
            return;
          }
          void (async () => {
            pendingButton(button, true, 'Uploading receipt...');
            say('Uploading receipt...');
            try {
              const bytes = await file.arrayBuffer();
              await api('POST', householdPath(`/costs/${cost.id}/receipts?filename=${encodeURIComponent(file.name)}`), {
                body: bytes,
                contentType: 'application/octet-stream',
                ifMatch: etag ?? undefined,
                idempotencyKey: newIdempotencyKey(),
              });
              say('Receipt stored.');
            } catch (error) {
              if (error instanceof ApiFailure) {
                if (error.code === 'storage_unavailable') {
                  say('Couldn\u2019t reach storage \u2013 nothing was saved. Try again.');
                } else {
                  const field = error.firstFieldError;
                  say(field ? field.message : error.problem.title);
                }
              }
            } finally {
              pendingButton(button, false, '');
              await paint();
              const fresh = ledgerBody.querySelector<HTMLElement>(`[data-cost-id="${cost.id}"]`);
              if (!button.isConnected) (fresh ?? ledger).focus();
            }
          })();
        });
        button.addEventListener('click', () => picker.click());
        const holder = el('span', { class: 'attach-holder' }, [button, picker]);
        return holder;
      }

      async function act(button: HTMLButtonElement, row: HTMLElement, pendingText: string, run: () => Promise<void>): Promise<void> {
        if (isPending(button)) return;
        const costKey = row.dataset.costId as string;
        const wasFocused = document.activeElement === button;
        pendingButton(button, true, pendingText);
        try {
          await run();
        } catch (error) {
          if (error instanceof ApiFailure) {
            if (error.code === 'precondition_failed') {
              say('This changed while you were looking. It now shows the latest version.');
            } else if (error.code === 'request_lapsed') {
              say('This request lapsed.');
            } else if (error.code === 'storage_unavailable') {
              say('Couldn\u2019t reach storage \u2013 nothing was deleted. Try again.');
            } else {
              const field = error.firstFieldError;
              say(field ? field.message : error.problem.title);
            }
          }
        } finally {
          pendingButton(button, false, '');
          await paint();
          if (wasFocused && !button.isConnected) {
            const fresh = ledgerBody.querySelector<HTMLElement>(`[data-cost-id="${costKey}"]`);
            (fresh ?? ledger).focus();
          }
        }
      }

      function costRow(cost: CostJson, etag: string | null): HTMLElement {
        const row = el('tr', { class: 'ledger-row', tabindex: '-1', 'data-cost-id': cost.id });
        const [planningPercent, otherPercent] = splitPercents(cost.splitBp.planning);
        const cells: [string, string][] = [
          ['Incurred', formatDmyHm(cost.incurredAt)],
          ['Custody day', formatDmy(cost.custodyDay)],
          ['Description', cost.description],
          ['Amount', money(cost.amountMinor)],
          ['Paid by', nameOf(cost.paidBy)],
          ['Split', `${planningPercent}/${otherPercent}`],
          [`${me.household.planningName}'s share`, money(cost.shares.planning)],
          [`${me.household.otherName}'s share`, money(cost.shares.other)],
          ['Status', stateWords[cost.state] ?? cost.state],
        ];
        for (const [label, value] of cells) {
          row.append(el('td', { 'data-label': label }, [el('span', { class: 'cell-label', text: label }), el('span', { text: value })]));
        }
        const actions = el('td', { class: 'row-actions-cell' });
        const mine = cost.paidBy === me.role;
        if (cost.state === 'draft' && mine) {
          const edit = el('button', { type: 'button', class: 'plain-button', text: 'Edit draft' });
          edit.addEventListener('click', () => openCostDialog({ cost, etag }, edit));
          actions.append(edit);
          const send = el('button', { type: 'button', class: 'pill', text: 'Send' });
          send.addEventListener('click', () => {
            void act(send, row, 'Sending...', async () => {
              await api('POST', householdPath(`/costs/${cost.id}/send`), {
                ifMatch: etag ?? undefined,
                idempotencyKey: newIdempotencyKey(),
              });
              say('Request sent. An email notice is on its way.');
            });
          });
          const remove = el('button', { type: 'button', class: 'plain-button', text: 'Delete draft' });
          remove.addEventListener('click', () => {
            void act(remove, row, 'Deleting...', async () => {
              await api('DELETE', householdPath(`/costs/${cost.id}`), { ifMatch: etag ?? undefined });
              say('Draft deleted.');
            });
          });
          actions.append(send, remove);
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
          const accept = el('button', { type: 'button', class: 'pill', text: 'Accept' });
          accept.addEventListener('click', () => {
            void act(accept, row, 'Accepting...', async () => {
              await api('POST', householdPath(`/costs/${cost.id}/accept`), {
                ifMatch: etag ?? undefined,
                idempotencyKey: newIdempotencyKey(),
              });
              say('Reimbursement accepted.');
            });
          });
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
          actions.append(accept, decline);
        }
        if (cost.state === 'sent' && mine) {
          const withdraw = el('button', { type: 'button', class: 'plain-button', text: 'Withdraw' });
          withdraw.addEventListener('click', () => {
            void act(withdraw, row, 'Withdrawing...', async () => {
              await api('POST', householdPath(`/costs/${cost.id}/withdraw`), {
                ifMatch: etag ?? undefined,
                idempotencyKey: newIdempotencyKey(),
              });
              say('Request withdrawn.');
            });
          });
          actions.append(withdraw);
        }
        if (cost.state === 'accepted' && mine) {
          const settle = el('button', { type: 'button', class: 'pill', text: 'Settle' });
          settle.addEventListener('click', () => {
            void act(settle, row, 'Settling...', async () => {
              await api('POST', householdPath(`/costs/${cost.id}/settle`), {
                ifMatch: etag ?? undefined,
                idempotencyKey: newIdempotencyKey(),
              });
              say('Marked as settled.');
            });
          });
          actions.append(settle);
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
        ledgerBody.replaceChildren(...costs.map((result) => costRow(result.data, result.etag)));
        emptyLine.hidden = costs.length > 0;
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
