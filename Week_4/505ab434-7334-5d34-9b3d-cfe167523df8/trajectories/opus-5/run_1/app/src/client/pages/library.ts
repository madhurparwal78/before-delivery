import { ApiCallError, getJson, sendJson } from '../api.js';
import { el, openDialog } from '../dom.js';
import { onLive } from '../live.js';
import { badgeGlyph, emptyGlyph } from '../marks.js';
import { registerCleanup, type PageContext } from '../main.js';
import { currentSession, displayDate, displayTime, setPageStatus } from '../shell.js';
import { ASSET_CLASS_KEYS, ASSET_CLASS_LABELS, APPLICATION_KEYS, APPLICATION_LABELS } from '../../shared/labels.js';
import type { Badge, LibraryCard } from '../../shared/types.js';

interface Organisation {
  id: string;
  name: string;
  engagement: { startsOn: string | null; endsOn: string | null; territories: string[] };
}

interface RuleRow {
  identifier: string;
  chapter: string;
  text: string;
}

const BADGES: Badge[] = ['Available', 'Request required', 'Restricted', 'Retired'];

const BADGE_FIELDS: Record<Badge, string> = {
  Available: 'field-meadow',
  'Request required': 'field-saffron',
  Restricted: 'field-ember',
  Retired: 'field-stone',
};

export async function renderLibrary(context: PageContext): Promise<void> {
  const { main, navigate } = context;
  const [organisations, rules] = await Promise.all([
    getJson<{ organisations: Organisation[] }>('/api/organisations'),
    getJson<{ rules: RuleRow[] }>('/api/rules'),
  ]);
  const organisation = organisations.organisations[0] ?? null;

  const results = el('p', {
    class: 'results-status',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Library results',
  });
  const grid = el('div', { class: 'card-grid' });

  const classSelect = el(
    'select',
    { id: 'filter-class', 'aria-label': 'Class' },
    el('option', { value: '' }, 'All classes'),
    ...ASSET_CLASS_KEYS.map((key) => el('option', { value: key }, ASSET_CLASS_LABELS[key])),
  ) as HTMLSelectElement;

  const badgeBoxes = new Map<Badge, HTMLInputElement>();
  for (const badge of BADGES) {
    badgeBoxes.set(
      badge,
      el('input', { type: 'checkbox', id: `filter-${badge.replace(/\s+/g, '-')}`, 'aria-label': badge }) as HTMLInputElement,
    );
  }

  const search = el('input', { type: 'search', id: 'filter-search', 'aria-label': 'Search assets' }) as HTMLInputElement;

  const filters = el(
    'div',
    { class: 'cell filters', role: 'group', 'aria-label': 'Filters' },
    el('label', { for: 'filter-class' }, 'Class'),
    classSelect,
    ...[...badgeBoxes.entries()].flatMap(([badge, box]) => [
      el('span', { class: 'check-row' }, box, el('label', { for: box.id }, badge)),
    ]),
    el('label', { for: 'filter-search' }, 'Search assets'),
    search,
  );

  let cards: LibraryCard[] = [];

  const paint = (): void => {
    const assetClass = classSelect.value;
    const active = BADGES.filter((badge) => badgeBoxes.get(badge)?.checked);
    const query = search.value.trim();
    const visible = cards.filter((card) => {
      if (assetClass !== '' && classKeyOf(card) !== assetClass) return false;
      if (active.length > 0 && !active.includes(card.badge)) return false;
      if (query !== '') {
        const needle = query.toLowerCase();
        if (!card.cardName.toLowerCase().includes(needle) && !card.classLabel.toLowerCase().includes(needle)) {
          return false;
        }
      }
      return true;
    });

    grid.replaceChildren(
      ...(visible.length === 0
        ? [el('div', { class: 'cell field field-ember empty-state' }, emptyGlyph(), el('p', {}, 'No assets match these filters.'))]
        : visible.map((card) => renderCard(card, organisation, rules.rules, navigate))),
    );

    const pieces = [`${visible.length} ${visible.length === 1 ? 'asset' : 'assets'}`];
    if (assetClass !== '') pieces.push(ASSET_CLASS_LABELS[assetClass as keyof typeof ASSET_CLASS_LABELS]);
    for (const badge of active) pieces.push(badge);
    if (query !== '') pieces.push(`matching "${query}"`);
    results.textContent = pieces.join(', ');
  };

  classSelect.addEventListener('change', paint);
  for (const box of badgeBoxes.values()) box.addEventListener('change', paint);
  search.addEventListener('input', paint);

  const load = async (): Promise<void> => {
    const response = await getJson<{ count: number; cards: LibraryCard[] }>('/api/library');
    cards = response.cards;
    paint();
  };

  main.classList.add('library-page');
  main.append(filters, el('div', { class: 'library-body' }, results, grid));
  await load();

  registerCleanup(
    onLive((event) => {
      if (event.type === 'library.updated' || event.type === 'grant.updated' || event.type === 'request.updated') {
        void load();
      }
    }),
  );
}

function classKeyOf(card: LibraryCard): string {
  const entry = Object.entries(ASSET_CLASS_LABELS).find(([, label]) => label === card.classLabel);
  return entry?.[0] ?? '';
}

function renderCard(
  card: LibraryCard,
  organisation: Organisation | null,
  rules: RuleRow[],
  navigate: (path: string) => void,
): HTMLElement {
  const alert = el('p', { class: 'alert', role: 'alert' });
  const actions = el('div', { class: 'card-actions' });
  const linkLine = el('p', { class: 'link-line' });

  if (card.badge === 'Available' && card.derivatives.length > 0) {
    for (const derivative of card.derivatives) {
      const button = el(
        'button',
        {
          type: 'button',
          class: 'pill',
          onclick: () => {
            button.disabled = true;
            button.textContent = 'Saving';
            void sendJson<{ url: string; expiresAt: string }>('POST', `/api/derivatives/${derivative.id}/link`)
              .then((link) => {
                alert.textContent = '';
                const anchor = el('a', { href: link.url, download: derivative.fileName });
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                linkLine.replaceChildren(
                  el('a', { href: link.url, download: derivative.fileName }, `Download again: ${derivative.fileName}`),
                  el('span', {}, ` Link expires at ${displayTime(link.expiresAt)}`),
                );
              })
              .catch((error: unknown) => {
                alert.textContent = error instanceof ApiCallError ? error.message : 'Downloads are unavailable right now.';
              })
              .finally(() => {
                button.disabled = false;
                button.textContent = `Download ${derivative.fileName}`;
              });
          },
        },
        `Download ${derivative.fileName}`,
      ) as HTMLButtonElement;
      actions.appendChild(button);
    }
  } else {
    const reasonId = `reason-${card.assetId}-${card.variantId ?? 'base'}`;
    actions.append(
      el(
        'button',
        {
          type: 'button',
          class: 'pill disabled',
          'aria-disabled': 'true',
          'aria-describedby': reasonId,
          onclick: (event: Event) => event.preventDefault(),
        },
        'Download',
      ),
      el('p', { class: 'reason', id: reasonId }, card.reason ?? ''),
    );
  }

  const session = currentSession();
  if (session.principal?.role === 'agency') {
    const requestReasonId = `request-reason-${card.assetId}-${card.variantId ?? 'base'}`;
    const button = el(
      'button',
      {
        type: 'button',
        class: 'pill',
        'aria-disabled': card.canRequest ? null : 'true',
        'aria-describedby': card.requestReason ? requestReasonId : null,
        onclick: () => {
          if (!card.canRequest) return;
          openRequestDialog(card, organisation, rules, button, navigate);
        },
      },
      'Request use',
    ) as HTMLButtonElement;
    actions.appendChild(button);
    if (card.requestReason) actions.appendChild(el('p', { class: 'reason', id: requestReasonId }, card.requestReason));
  }

  return el(
    'article',
    { class: 'cell card', 'aria-label': `${card.cardName}, ${card.badge}` },
    el('h2', { class: 'card-name' }, card.cardName),
    el('p', { class: 'card-meta' }, `${card.classLabel} · ${card.licenceName}`),
    el('p', { class: `badge field ${BADGE_FIELDS[card.badge]}` }, badgeGlyph(card.badge), el('span', {}, card.badge)),
    card.successorName ? el('p', { class: 'successor' }, `Successor: ${card.successorName}`) : null,
    actions,
    linkLine,
    alert,
    card.grant
      ? el(
          'p',
          { class: 'grant-line' },
          `Grant ${card.grant.id} · ${card.grant.statusLabel} · Ends ${displayDate(card.grant.notAfter)}`,
        )
      : null,
  );
}

function openRequestDialog(
  card: LibraryCard,
  organisation: Organisation | null,
  rules: RuleRow[],
  opener: HTMLElement,
  navigate: (path: string) => void,
): void {
  const session = currentSession();
  const territories = organisation?.engagement.territories ?? [];
  const engagementEnd = organisation?.engagement.endsOn ?? null;
  const idempotencyKey = `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const application = el(
    'select',
    { id: 'request-application', 'aria-label': 'Application' },
    ...APPLICATION_KEYS.map((key) => el('option', { value: key, selected: key === 'social' }, APPLICATION_LABELS[key])),
  ) as HTMLSelectElement;
  application.value = 'social';

  const territoryBoxes = territories.map((code, index) => {
    const box = el('input', {
      type: 'checkbox',
      id: `territory-${code}`,
      value: code,
      'aria-label': code,
      checked: index === 0,
    }) as HTMLInputElement;
    box.checked = index === 0;
    return box;
  });

  const notices = el('p', { class: 'notices', role: 'status', 'aria-live': 'polite', 'aria-label': 'Request notices' });

  const start = el('input', { type: 'date', id: 'campaign-start', value: session.config.today }) as HTMLInputElement;
  const end = el('input', { type: 'date', id: 'campaign-end', value: session.config.today }) as HTMLInputElement;
  const checkDates = (): void => {
    notices.textContent =
      engagementEnd && end.value > engagementEnd
        ? `Your engagement ends on ${displayDate(engagementEnd)}, so any grant will end by then.`
        : '';
  };
  end.addEventListener('input', checkDates);
  end.addEventListener('change', checkDates);

  const ruleBoxes = rules.map((rule) => {
    const box = el('input', {
      type: 'checkbox',
      id: `cite-${rule.identifier}`,
      value: rule.identifier,
      'aria-label': rule.identifier,
    }) as HTMLInputElement;
    return { box, rule };
  });

  const note = el('textarea', { id: 'request-note', 'aria-label': 'Note', rows: '3' }) as HTMLTextAreaElement;
  const alert = el('p', { class: 'alert', role: 'alert' });

  const submit = el('button', { type: 'submit', class: 'pill' }, 'Submit request') as HTMLButtonElement;
  const cancel = el('button', { type: 'button', class: 'pill ghost' }, 'Cancel') as HTMLButtonElement;

  const dialog = el('dialog', { class: 'sheet', 'aria-label': `Request ${card.cardName}` }) as HTMLDialogElement;
  cancel.addEventListener('click', () => dialog.close());

  const form = el(
    'form',
    {
      method: 'dialog',
      onsubmit: (event: Event) => {
        event.preventDefault();
        alert.textContent = '';
        submit.disabled = true;
        submit.textContent = 'Saving';
        void sendJson<{ id: string }>('POST', '/api/requests', {
          idempotencyKey,
          assetId: card.assetId,
          variantId: card.variantId,
          applicationClass: application.value,
          territories: territoryBoxes.filter((box) => box.checked).map((box) => box.value),
          campaignStartsOn: start.value,
          campaignEndsOn: end.value,
          citedRules: ruleBoxes.filter((entry) => entry.box.checked).map((entry) => entry.rule.identifier),
          note: note.value,
          submit: true,
        })
          .then((created) => {
            setPageStatus(`${created.id} submitted.`);
            dialog.close();
            navigate(`/requests/${created.id}`);
          })
          .catch((error: unknown) => {
            alert.textContent = error instanceof ApiCallError ? error.message : 'Something went wrong.';
          })
          .finally(() => {
            submit.disabled = false;
            submit.textContent = 'Submit request';
          });
      },
    },
    el('h2', {}, `Request ${card.cardName}`),
    el('label', { for: 'request-application' }, 'Application'),
    application,
    el(
      'div',
      { role: 'group', 'aria-label': 'Territories', class: 'check-group' },
      ...territoryBoxes.flatMap((box) => [el('span', { class: 'check-row' }, box, el('label', { for: box.id }, box.value))]),
    ),
    el('label', { for: 'campaign-start' }, 'Campaign start'),
    start,
    el('label', { for: 'campaign-end' }, 'Campaign end'),
    end,
    notices,
    el(
      'div',
      { role: 'group', 'aria-label': 'Cited rules', class: 'check-group scrollable' },
      ...ruleBoxes.flatMap((entry) => [
        el('span', { class: 'check-row' }, entry.box, el('label', { for: entry.box.id }, entry.rule.identifier)),
      ]),
    ),
    el('label', { for: 'request-note' }, 'Note'),
    note,
    alert,
    el('div', { class: 'dialog-actions' }, submit, cancel),
  );

  dialog.appendChild(form);
  openDialog(dialog, opener);
}
