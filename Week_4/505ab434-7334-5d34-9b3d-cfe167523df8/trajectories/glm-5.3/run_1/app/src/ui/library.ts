import { api, el, loadMe, setAlert, setStatus, busyButton, type Card, type Me } from './types';
import { openDialog, isPhone } from './dialog';
import { CLASS_LABELS, APPLICATION_LABELS } from './types';

let me: Me | null = null;

interface Filters {
  className: string;
  availability: string[];
  q: string;
}

export async function initLibrary(): Promise<void> {
  me = await loadMe();
  const classFilter = document.getElementById('class-filter') as HTMLSelectElement | null;
  const search = document.getElementById('asset-search') as HTMLInputElement | null;
  const results = document.getElementById('library-results');
  const root = document.getElementById('cards-root');
  if (!classFilter || !search || !results || !root) return;

  classFilter.append(el('option', { value: '' }, 'All classes'));
  for (const [key, label] of Object.entries(CLASS_LABELS)) {
    classFilter.append(el('option', { value: key }, label));
  }

  const state = { cards: [] as Card[], filters: { className: '', availability: [] as string[], q: '' } as Filters };

  const fetchCards = async (): Promise<void> => {
    const params = new URLSearchParams();
    if (state.filters.className) params.set('class', state.filters.className);
    for (const badge of state.filters.availability) params.append('availability', badge);
    if (state.filters.q) params.set('q', state.filters.q);
    const data = await api<{ count: number; cards: Card[] }>(`/api/library?${params.toString()}`);
    state.cards = data.cards;
    renderCards();
    const countSentence = `${data.count} ${data.count === 1 ? 'asset' : 'assets'}`;
    const extras: string[] = [];
    if (state.filters.className) extras.push(CLASS_LABELS[state.filters.className] ?? '');
    for (const badge of ['Available', 'Request required', 'Restricted', 'Retired']) {
      if (state.filters.availability.includes(badge)) extras.push(badge);
    }
    if (state.filters.q) extras.push(`matching "${state.filters.q}"`);
    results.textContent = extras.length > 0 ? `${countSentence}, ${extras.join(', ')}` : countSentence;
  };

  const renderCards = (): void => {
    root.replaceChildren();
    if (state.cards.length === 0) {
      const empty = el('div', { class: 'empty-cell field-stone' }, el('p', {}, 'No assets match these filters.'));
      root.append(empty);
      return;
    }
    for (const card of state.cards) {
      root.append(cardNode(card, fetchCards));
    }
  };

  classFilter.addEventListener('change', () => {
    state.filters.className = classFilter.value;
    void fetchCards();
  });
  search.addEventListener('input', () => {
    state.filters.q = search.value;
    void fetchCards();
  });
  for (const [id, badge] of [
    ['filter-available', 'Available'],
    ['filter-request', 'Request required'],
    ['filter-restricted', 'Restricted'],
    ['filter-retired', 'Retired'],
  ] as const) {
    const box = document.getElementById(id) as HTMLInputElement | null;
    if (!box) continue;
    box.addEventListener('change', () => {
      if (box.checked) {
        state.filters.availability.push(badge);
      } else {
        state.filters.availability = state.filters.availability.filter((b) => b !== badge);
      }
      void fetchCards();
    });
  }

  window.addEventListener('rulehouse:library-updated', () => void fetchCards());
  await fetchCards();
}

function badgeClass(badge: string): string {
  if (badge === 'Available') return 'badge-available';
  if (badge === 'Request required') return 'badge-request';
  if (badge === 'Restricted') return 'badge-restricted';
  return 'badge-retired';
}

function badgeGlyph(badge: string): string {
  if (badge === 'Available') return '✓';
  if (badge === 'Request required') return '⚿';
  if (badge === 'Restricted') return '▯';
  return '◔';
}

function cardNode(card: Card, refresh: () => Promise<void>): HTMLElement {
  const body = el('div', {});
  const article = el(
    'article',
    { class: 'card', 'aria-label': `${card.cardName}, ${card.badge}` },
    el('h3', {}, card.cardName),
    el('p', { class: 'licence' }, `${card.classLabel} · ${card.licenceName}`),
    el('span', { class: `badge ${badgeClass(card.badge)}` }, `${badgeGlyph(card.badge)} ${card.badge}`),
  );

  if (card.badge === 'Available') {
    for (const derivative of card.derivatives) {
      const download = el('button', { type: 'button' }, `Download ${derivative.fileName}`);
      const alertSlot = el('div', { class: 'alert-slot' });
      download.addEventListener('click', async () => {
        const restore = busyButton(download, 'Saving');
        try {
          const link = await api<{ url: string; expiresAt: string }>(`/api/derivatives/${derivative.id}/link`, {
            method: 'POST',
            body: '{}',
          });
          const expires = new Date(link.expiresAt);
          const expiresAt = new Intl.DateTimeFormat('en-GB', {
            timeZone: me?.timeZone ?? 'Europe/Berlin',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).format(expires);
          const line = el('p', { class: 'link-line' }, `Link expires at ${expiresAt} `, el('a', { href: link.url }, `Download again: ${derivative.fileName}`));
          if (body.contains(alertSlot)) alertSlot.before(line);
          else article.append(line);
          window.location.href = link.url;
        } catch (err) {
          setAlert(err instanceof Error ? err.message : 'Something went wrong.', alertSlot);
        } finally {
          restore();
        }
      });
      article.append(download);
    }
  } else {
    const disabled = el('button', { type: 'button', disabled: 'disabled', 'aria-describedby': `reason-${card.assetId}-${card.variantId ?? 'base'}` }, card.reason ?? '');
    disabled.setAttribute('aria-label', 'Download');
    article.append(disabled);
  }

  if (me?.principal.role === 'agency') {
    const requestButton = el('button', { type: 'button' }, 'Request use');
    if (!card.canRequest) {
      requestButton.disabled = true;
      if (card.requestReason) {
        requestButton.setAttribute('aria-describedby', `request-reason-${card.assetId}`);
        article.append(el('span', { id: `request-reason-${card.assetId}`, class: 'grant-line' }, card.requestReason));
      }
    } else {
      requestButton.addEventListener('click', () => {
        void openRequestDialog(card, refresh);
      });
    }
    article.append(requestButton);
  }

  if (card.grant) {
    article.append(
      el('p', { class: 'grant-line' }, `Grant ${card.grant.id} · ${card.grant.statusLabel} · ends ${card.grant.notAfter}`),
    );
  }

  article.append(body);
  return article;
}

let dialogKey = '';

async function openRequestDialog(card: Card, refresh: () => Promise<void>): Promise<void> {
  const meNow = me ?? (await loadMe());
  if (!meNow) return;
  const territories = meNow.organisation?.engagement.territories ?? [];
  const engagementEnd = meNow.organisation?.engagement.endsOn ?? null;
  dialogKey = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const rules = await api<{ rules: { identifier: string }[] }>('/api/rules');

  const alertSlot = el('div', { class: 'alert-slot' });
  const notices = el('p', { id: 'request-notices', role: 'status', 'aria-live': 'polite', class: 'notice-slot' });
  const application = el('select', { id: 'application' });
  for (const [value, label] of Object.entries(APPLICATION_LABELS)) {
    application.append(el('option', { value }, label));
  }
  application.value = 'social';
  const territoriesGroup = el('div', { role: 'group', 'aria-label': 'Territories' });
  const territoryBoxes: HTMLInputElement[] = [];
  for (const code of territories) {
    const box = el('input', { type: 'checkbox', value: code, id: `territory-${code}` });
    territoryBoxes.push(box);
    territoriesGroup.append(el('label', { class: 'check', for: `territory-${code}` }, box, ` ${code}`));
  }
  if (territoryBoxes.length > 0) territoryBoxes[0].checked = true;

  const start = el('input', { type: 'date', id: 'campaign-start' });
  start.value = meNow.today;
  const end = el('input', { type: 'date', id: 'campaign-end' });
  const rulesGroup = el('div', { role: 'group', 'aria-label': 'Cited rules' });
  const ruleBoxes: HTMLInputElement[] = [];
  for (const rule of rules.rules) {
    const box = el('input', { type: 'checkbox', value: rule.identifier, id: `rule-${rule.identifier}` });
    ruleBoxes.push(box);
    rulesGroup.append(el('label', { class: 'check', for: `rule-${rule.identifier}` }, box, ` ${rule.identifier}`));
  }
  const note = el('textarea', { id: 'note', rows: '3' });

  const engagementNotice = (): void => {
    if (!engagementEnd) {
      notices.textContent = '';
      return;
    }
    if (end.value && end.value > engagementEnd) {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(engagementEnd);
      const formatted = match ? `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}` : engagementEnd;
      notices.textContent = `Your engagement ends on ${formatted}, so any grant will end by then.`;
    } else {
      notices.textContent = '';
    }
  };
  end.addEventListener('change', engagementNotice);

  const submit = el('button', { type: 'submit', class: 'primary' }, 'Submit request');
  const form = el('form', { id: 'request-form' },
    el('label', { class: 'field', for: 'application' }, el('span', {}, 'Application'), application),
    territoriesGroup,
    el('label', { class: 'field', for: 'campaign-start' }, el('span', {}, 'Campaign start'), start),
    el('label', { class: 'field', for: 'campaign-end' }, el('span', {}, 'Campaign end'), end),
    rulesGroup,
    el('label', { class: 'field', for: 'note' }, el('span', {}, 'Note'), note),
    notices,
    submit,
    alertSlot,
  );

  const opener = document.activeElement as HTMLElement;

  const handle = openDialog({
    label: `Request ${card.cardName}`,
    build: (container) => {
      container.append(form);
    },
    opener,
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const restore = busyButton(submit, 'Saving');
    clearAlerts();
    const territories = territoryBoxes.filter((box) => box.checked).map((box) => box.value);
    const cited = ruleBoxes.filter((box) => box.checked).map((box) => box.value);
    try {
      const created = await api<{ id: string }>('/api/requests', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: dialogKey,
          assetId: card.assetId,
          variantId: card.variantId,
          applicationClass: application.value,
          territories,
          campaignStartsOn: start.value,
          campaignEndsOn: end.value,
          citedRules: cited,
          note: note.value,
          submit: true,
        }),
      });
      setStatus(`${created.id} submitted.`);
      handle.close();
      window.location.href = `/requests/${created.id}`;
    } catch (err) {
      setAlert(err instanceof Error ? err.message : 'Something went wrong.', alertSlot);
    } finally {
      restore();
    }
  });

  function clearAlerts(): void {
    setAlert('', alertSlot);
  }
}
