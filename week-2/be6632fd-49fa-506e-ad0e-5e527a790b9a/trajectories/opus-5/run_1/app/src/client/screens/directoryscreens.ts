import { STATUS_COPY } from '../../domain/copy.ts';
import { marketCity, type Market } from '../../domain/markets.ts';
import { openDialog, setFocusAfterSuccess } from '../dialogs.ts';
import { announce } from '../feedback.ts';
import { request } from '../net.ts';
import { control, onAction, onOpen, pageData, valueOf } from '../ui.ts';

interface Stockist {
  id: string;
  name: string;
  market: Market;
  contactName: string | null;
  contactErased: boolean;
}

interface StockistsData {
  screen: 'stockists';
  nextCursor: string | null;
}

export function startStockistsScreen(): void {
  const data = pageData<StockistsData>();
  let cursor = data.nextCursor;
  let chosen = '';

  const search = control('q');
  let timer = 0;
  search?.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void reload(), 333);
  });

  const reload = async (): Promise<void> => {
    const params = new URLSearchParams();
    const term = valueOf('q');
    if (term !== '') params.set('q', term);
    const answer = await request<{ items: Stockist[]; nextCursor: string | null }>(
      `/api/stockists?${params.toString()}`,
    );
    cursor = answer.nextCursor;
    renderRows(answer.items, false);
  };

  onOpen('open-add-stockist', (button) => openDialog('Add stockist', button));
  onAction(
    'save-stockist',
    async () =>
      request('/api/stockists', {
        method: 'POST',
        body: {
          name: valueOf('name'),
          market: valueOf('market'),
          contactName: valueOf('contactName'),
          contactEmail: valueOf('contactEmail'),
          contactPhone: valueOf('contactPhone'),
          notes: control('notes')?.value ?? '',
        },
      }),
    {
      region: 'Stockist status',
      dialog: 'Add stockist',
      success: STATUS_COPY.stockistAdded,
      reload: true,
      focusAfter: '[data-action="open-add-stockist"]',
    },
  );

  for (const [action, dialogName] of [
    ['open-archive', 'Archive stockist'],
    ['open-restore', 'Restore stockist'],
  ] as const) {
    document.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        `[data-action="${action}"]`,
      );
      if (button === null || button === undefined) return;
      chosen = button.dataset['stockistId'] ?? '';
      const name = button.dataset['stockistName'] ?? '';
      const summary = document.querySelector<HTMLElement>(
        action === 'open-archive' ? '[data-archive-summary]' : '[data-restore-summary]',
      );
      if (summary !== null) {
        summary.textContent =
          action === 'open-archive'
            ? `${name} leaves every list, search and export, and its allocations are hidden.`
            : `${name} comes back exactly as it was, with its allocations.`;
      }
      openDialog(dialogName, button);
    });
  }

  for (const name of ['Archive stockist', 'Restore stockist']) {
    setFocusAfterSuccess(name, () => document.querySelector<HTMLElement>('h1.page-heading'));
  }

  onAction(
    'archive-stockist',
    async () =>
      request(`/api/stockists/${encodeURIComponent(chosen)}/archive`, { method: 'POST' }),
    {
      region: 'Stockist status',
      dialog: 'Archive stockist',
      success: STATUS_COPY.stockistArchived,
      reload: true,
      focusAfter: 'h1.page-heading',
    },
  );

  onAction(
    'restore-stockist',
    async () =>
      request(`/api/stockists/${encodeURIComponent(chosen)}/restore`, { method: 'POST' }),
    {
      region: 'Stockist status',
      dialog: 'Restore stockist',
      success: STATUS_COPY.stockistRestored,
      reload: true,
      focusAfter: 'h1.page-heading',
    },
  );

  onAction(
    'load-more-stockists',
    async () => {
      if (cursor === null) return { items: [], nextCursor: null };
      const params = new URLSearchParams({ cursor });
      const term = valueOf('q');
      if (term !== '') params.set('q', term);
      const answer = await request<{ items: Stockist[]; nextCursor: string | null }>(
        `/api/stockists?${params.toString()}`,
      );
      cursor = answer.nextCursor;
      renderRows(answer.items, true);
      return answer;
    },
    { region: 'Stockist status' },
  );

  onOpen('toggle-archived', (toggle) => {
    const on = toggle.getAttribute('aria-checked') === 'true';
    toggle.setAttribute('aria-checked', on ? 'false' : 'true');
    const table = document
      .querySelector<HTMLElement>('[data-archived-rows]')
      ?.closest<HTMLElement>('.table-wrap');
    if (table !== null && table !== undefined) table.dataset['revealed'] = on ? 'false' : 'true';
  });
}

function renderRows(items: readonly Stockist[], append: boolean): void {
  const body = document.querySelector<HTMLElement>('[data-stockist-rows]');
  const cards = document.querySelector<HTMLElement>('[data-stockist-cards]');
  const rows = items.map((stockist) => {
    const row = document.createElement('tr');
    row.dataset['stockistId'] = stockist.id;
    const name = document.createElement('td');
    const link = document.createElement('a');
    link.className = 'link';
    link.href = `/studio/stockists/${stockist.id}`;
    link.textContent = stockist.name;
    name.append(link);
    const market = document.createElement('td');
    market.textContent = marketCity(stockist.market);
    const contact = document.createElement('td');
    contact.textContent = stockist.contactErased
      ? STATUS_COPY.erasedContact
      : (stockist.contactName ?? '—');
    const actions = document.createElement('td');
    actions.className = 'actions-cell';
    const archive = document.createElement('button');
    archive.type = 'button';
    archive.className = 'button button--quiet';
    archive.dataset['action'] = 'open-archive';
    archive.dataset['stockistId'] = stockist.id;
    archive.dataset['stockistName'] = stockist.name;
    archive.textContent = 'Archive';
    actions.append(archive);
    row.append(name, market, contact, actions);
    return row;
  });
  if (body !== null) {
    if (append) body.append(...rows);
    else body.replaceChildren(...rows);
  }
  if (cards !== null) {
    const items2 = items.map((stockist) => {
      const item = document.createElement('li');
      item.className = 'stockist-card';
      item.dataset['stockistId'] = stockist.id;
      item.innerHTML = `<p class="stockist-card__name"><a class="link" href="/studio/stockists/${stockist.id}"></a></p><p></p><p></p>`;
      const anchor = item.querySelector('a');
      if (anchor !== null) anchor.textContent = stockist.name;
      const paragraphs = item.querySelectorAll('p');
      if (paragraphs[1] !== undefined) paragraphs[1].textContent = marketCity(stockist.market);
      if (paragraphs[2] !== undefined) {
        paragraphs[2].textContent = stockist.contactErased
          ? STATUS_COPY.erasedContact
          : (stockist.contactName ?? '—');
      }
      return item;
    });
    if (append) cards.append(...items2);
    else cards.replaceChildren(...items2);
  }
}

interface StockistData {
  screen: 'stockist';
  stockistId: string;
}

export function startStockistScreen(): void {
  const data = pageData<StockistData>();
  onOpen('open-erase', (button) => openDialog('Erase contact', button));
  setFocusAfterSuccess('Erase contact', () =>
    document.querySelector<HTMLElement>('#stockist-heading'),
  );

  onAction(
    'erase-contact',
    async () =>
      request(`/api/stockists/${encodeURIComponent(data.stockistId)}/erase-contact`, {
        method: 'POST',
      }),
    {
      region: 'Stockist status',
      dialog: 'Erase contact',
      success: STATUS_COPY.contactErased,
      after: () => {
        for (const selector of ['[data-contact-name]', '[data-contact-email]', '[data-contact-phone]']) {
          const node = document.querySelector<HTMLElement>(selector);
          if (node !== null) node.textContent = STATUS_COPY.erasedContact;
        }
      },
    },
  );
}

export function startMembersScreen(): void {
  let chosen = '';

  onOpen('open-invite', (button) => openDialog('Invite member', button));
  const roleSelect = control('role');
  const stockistHost = document.querySelector<HTMLElement>('[data-invite-stockist]');
  roleSelect?.addEventListener('change', () => {
    if (stockistHost !== null) stockistHost.hidden = roleSelect.value !== 'stockist_buyer';
  });

  onAction(
    'send-invitation',
    async () => {
      const email = valueOf('email');
      const role = valueOf('role');
      await request('/api/members/invitations', {
        method: 'POST',
        body: {
          email,
          role,
          stockistId: role === 'stockist_buyer' ? valueOf('stockistId') : null,
        },
      });
      return email;
    },
    {
      region: 'Members status',
      dialog: 'Invite member',
      success: (result) => STATUS_COPY.invitationSent(result as string),
    },
  );

  for (const [action, dialogName] of [
    ['open-change-role', 'Change role'],
    ['open-remove-member', 'Remove member'],
  ] as const) {
    document.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        `[data-action="${action}"]`,
      );
      if (button === null || button === undefined) return;
      chosen = button.dataset['memberId'] ?? '';
      const role = button.dataset['memberRole'];
      const select = control('newRole');
      if (select !== null && role !== undefined) select.value = role;
      openDialog(dialogName, button);
    });
  }

  setFocusAfterSuccess('Remove member', () =>
    document.querySelector<HTMLElement>('#members-heading'),
  );

  onAction(
    'save-role',
    async () =>
      request(`/api/members/${encodeURIComponent(chosen)}`, {
        method: 'PATCH',
        body: { role: valueOf('newRole') },
      }),
    {
      region: 'Members status',
      dialog: 'Change role',
      success: STATUS_COPY.roleUpdated,
      focusAfter: '[data-action="open-change-role"]',
      own: (failure) => (failure.code === 'last_producer' ? STATUS_COPY.lastProducer : null),
      reload: true,
    },
  );

  onAction(
    'remove-member',
    async () => request(`/api/members/${encodeURIComponent(chosen)}`, { method: 'DELETE' }),
    {
      region: 'Members status',
      dialog: 'Remove member',
      success: STATUS_COPY.memberRemoved,
      focusAfter: '#members-heading',
      own: (failure) => (failure.code === 'last_producer' ? STATUS_COPY.lastProducer : null),
      reload: true,
    },
  );
}

export function announceStockist(copy: string): void {
  announce('Stockist status', copy);
}
