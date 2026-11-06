import { api, ApiError, type ApiToken, type PriceList } from '../api.js';
import { clear, el, money, openDialog } from '../dom.js';
import { announceWithToast, failureCopy, pending } from '../notices.js';
import { WORK_LABELS, copy } from '../copy.js';
import type { ScreenContext } from '../shell.js';

/** `/prices` — immutable price lists by effective date, then the API tokens table. */
export async function renderPrices(ctx: ScreenContext): Promise<void> {
  clear(ctx.main);
  const newList = el('button', { type: 'button', class: 'primary', text: 'New price list' }) as HTMLButtonElement;
  const listHost = el('div');
  const tokenHost = el('div', { class: 'section' });
  ctx.main.append(el('div', { class: 'row-actions' }, [newList]), listHost, tokenHost);

  const renderLists = async (): Promise<void> => {
    clear(listHost);
    const lists = await api.get<PriceList[]>('/api/price-lists');
    const codes = Object.keys(WORK_LABELS);
    listHost.append(
      el('table', { class: 'stacked', 'aria-label': 'Price lists' }, [
        el('caption', { text: 'Price lists' }),
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Effective from' }),
            el('th', { scope: 'col', text: 'Deposit' }),
            ...codes.map((code) => el('th', { scope: 'col', text: WORK_LABELS[code] as string })),
          ]),
        ]),
        el(
          'tbody',
          {},
          lists.map((list) =>
            el('tr', {}, [
              el('td', { 'data-label': 'Effective from', class: 'num', text: list.effective_from }),
              el('td', { 'data-label': 'Deposit', class: 'amount', text: money(list.deposit_cents) }),
              ...codes.map((code) =>
                el('td', {
                  'data-label': WORK_LABELS[code] as string,
                  class: 'amount',
                  text: money(list.prices[code] ?? 0),
                }),
              ),
            ]),
          ),
        ),
      ]),
    );
  };

  const renderTokens = async (): Promise<void> => {
    clear(tokenHost);
    const newToken = el('button', { type: 'button', text: 'New API token' }) as HTMLButtonElement;
    newToken.addEventListener('click', () => openTokenDialog(newToken, renderTokens));
    const tokens = await api.get<ApiToken[]>('/api/tokens');
    const body = el('tbody');
    for (const token of tokens) {
      const revoke = el('button', { type: 'button', text: `Revoke token ${token.name}` }) as HTMLButtonElement;
      revoke.addEventListener('click', () => {
        void (async (): Promise<void> => {
          const handle = pending(revoke, copy.revoking);
          try {
            await api.delete(`/api/tokens/${token.id}`);
            handle.done();
            announceWithToast(copy.tokenRevoked);
            await renderTokens();
          } catch (error) {
            handle.failed(failureCopy(error, copy.networkFailure));
          }
        })();
      });
      body.append(
        el('tr', {}, [
          el('td', { 'data-label': 'Name', text: token.name }),
          el('td', { 'data-label': 'Scope', text: token.scope === 'read_only' ? 'Read only' : 'Billing' }),
          el('td', { 'data-label': 'Created', class: 'num', text: token.created_at }),
          el('td', { 'data-label': 'Actions' }, [revoke]),
        ]),
      );
    }
    tokenHost.append(
      el('div', { class: 'row-actions' }, [newToken]),
      el('table', { class: 'stacked', 'aria-label': 'API tokens' }, [
        el('caption', { text: 'API tokens' }),
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Name' }),
            el('th', { scope: 'col', text: 'Scope' }),
            el('th', { scope: 'col', text: 'Created' }),
            el('th', { scope: 'col', text: 'Actions' }),
          ]),
        ]),
        body,
      ]),
    );
  };

  newList.addEventListener('click', () => {
    const effective = el('input', { type: 'text', 'aria-label': 'Effective from', placeholder: 'YYYY-MM-DD' }) as HTMLInputElement;
    const deposit = el('input', { type: 'text', 'aria-label': 'Deposit' }) as HTMLInputElement;
    const priceInputs = new Map<string, HTMLInputElement>();
    const fields: HTMLElement[] = [
      el('div', { class: 'field' }, [el('label', { text: 'Effective from' }), effective]),
      el('div', { class: 'field' }, [el('label', { text: 'Deposit' }), deposit]),
    ];
    for (const [code, label] of Object.entries(WORK_LABELS)) {
      const input = el('input', { type: 'text', 'aria-label': label }) as HTMLInputElement;
      priceInputs.set(code, input);
      fields.push(el('div', { class: 'field' }, [el('label', { text: label }), input]));
    }
    const save = el('button', { type: 'button', class: 'primary', text: 'Save price list' }) as HTMLButtonElement;
    const errorHost = el('div');
    const dialog = openDialog({
      title: 'New price list',
      body: [...fields, el('div', { class: 'actions' }, [save]), errorHost],
      initialFocus: () => effective,
      opener: newList,
    });

    const cents = (value: string): number => Math.round(Number(value) * 100);

    save.addEventListener('click', () => {
      void (async (): Promise<void> => {
        const handle = pending(save, copy.saving);
        try {
          const prices: Record<string, number> = {};
          for (const [code, input] of priceInputs) prices[code] = cents(input.value);
          await api.post('/api/price-lists', {
            body: { effective_from: effective.value, deposit_cents: cents(deposit.value), prices },
          });
          handle.done();
          dialog.close();
          announceWithToast(copy.priceListSaved);
          await renderLists();
        } catch (error) {
          const failure = error instanceof ApiError ? error.failure : null;
          let message = failureCopy(error, copy.networkFailure);
          if (failure !== null && failure.code === 'price_list_exists') message = copy.priceListExists;
          else if (failure !== null && failure.code === 'validation') {
            clear(errorHost);
            for (const [field, text] of Object.entries(failure.errors ?? {})) {
              errorHost.append(el('p', { class: 'field-error', text: `${field}: ${text}` }));
            }
            message = Object.values(failure.errors ?? {})[0] ?? message;
          }
          handle.failed(message);
        }
      })();
    });
  });

  const openTokenDialog = (opener: HTMLButtonElement, after: () => Promise<void>): void => {
    const name = el('input', { type: 'text', 'aria-label': 'Name' }) as HTMLInputElement;
    const scope = el('select', { 'aria-label': 'Scope' }) as HTMLSelectElement;
    scope.append(
      el('option', { value: 'read_only', text: 'Read only' }),
      el('option', { value: 'billing', text: 'Billing' }),
    );
    const create = el('button', { type: 'button', class: 'primary', text: 'Create token' }) as HTMLButtonElement;
    const display = el('div');
    const dialog = openDialog({
      title: 'New API token',
      body: [
        el('div', { class: 'field' }, [el('label', { text: 'Name' }), name]),
        el('div', { class: 'field' }, [el('label', { text: 'Scope' }), scope]),
        el('div', { class: 'actions' }, [create]),
        display,
      ],
      initialFocus: () => name,
      opener,
    });
    create.addEventListener('click', () => {
      void (async (): Promise<void> => {
        const handle = pending(create, copy.saving);
        try {
          const token = await api.post<ApiToken>('/api/tokens', {
            body: { name: name.value, scope: scope.value },
          });
          handle.done();
          // A new token keeps the dialog open with its one-time display.
          announceWithToast(copy.tokenCreated);
          clear(display);
          display.append(
            el('p', { text: copy.tokenCreated }),
            el('p', { class: 'token-display', text: token.token ?? '' }),
          );
          await after();
        } catch (error) {
          const failure = error instanceof ApiError ? error.failure : null;
          handle.failed(
            failure?.code === 'validation'
              ? (Object.values(failure.errors ?? {})[0] ?? copy.networkFailure)
              : failureCopy(error, copy.networkFailure),
          );
        }
      })();
    });
    void dialog;
  };

  await renderLists();
  await renderTokens();
}
