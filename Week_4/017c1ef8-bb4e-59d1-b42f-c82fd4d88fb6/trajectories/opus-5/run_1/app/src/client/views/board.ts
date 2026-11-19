import {
  formatDateTime,
  STAGE_LABELS,
  STAGE_ORDER,
  type ApplicationState,
} from '../../shared/format';
import { allowedNext } from '../../shared/stages';
import { api } from '../api';
import { announce, dialog, h, isPhone, menu, qs, showAlert } from '../dom';
import { cfg, on } from '../state';
import { S } from '../strings';

type BoardCard = {
  id: string;
  applicant: { id: string; name: string; handle: string; headline: string };
  state: ApplicationState;
  entered_at: string;
};

type Funnel = {
  rows: { stage: string; count: number; rate: number | null }[];
  median_first_view_minutes: number | null;
  automatic: number;
};

export function applicantsView(jobId: string): HTMLElement {
  const host = h('div', { class: 'board-page' });
  let columns: Record<string, BoardCard[]> = {};
  let picked: { card: BoardCard; from: ApplicationState; column: number } | null = null;
  let jobTitle = '';

  void load();
  const off = on('board', (data) => {
    if (String(data.job_id) !== jobId) return;
    if (!document.contains(host)) {
      off();
      return;
    }
    void load();
  });
  const offApp = on('application', (data) => {
    if (String(data.job_id) === jobId && document.contains(host)) void load();
  });
  const observer = new MutationObserver(() => {
    if (!document.contains(host)) {
      off();
      offApp();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return host;

  async function load(): Promise<void> {
    const job = await api.get<{ title: string }>(`/api/jobs/${jobId}`);
    if (job.ok) jobTitle = job.body.title;
    const board = await api.get<{ columns: Record<string, BoardCard[]> }>(
      `/api/jobs/${jobId}/applications`,
    );
    if (!board.ok) {
      host.replaceChildren(
        h('div', { class: 'empty' }, [
          h('h1', { class: 'big-sentence', text: S.empty.unknownAddress }),
          h('a', { href: '/jobs', class: 'link underline' }, ['Go to Home']),
        ]),
      );
      return;
    }
    columns = board.body.columns;
    const funnel = await api.get<Funnel>(`/api/jobs/${jobId}/funnel`);
    draw(funnel.ok ? funnel.body : null);
  }

  function funnelRegion(funnel: Funnel): HTMLElement {
    const region = h('section', { 'aria-label': 'Hiring funnel', class: 'panel funnel' }, [
      h('h2', { class: 'section-title', text: 'Hiring funnel' }),
    ]);
    for (const row of funnel.rows) {
      const label = row.stage === 'rejected' ? 'Not selected' : STAGE_LABELS[row.stage];
      let text: string;
      if (row.stage === 'rejected') {
        text =
          funnel.automatic > 0
            ? `Not selected · ${row.count} (${funnel.automatic} automatic)`
            : `Not selected · ${row.count}`;
      } else if (row.stage === 'withdrawn') {
        text = `Withdrawn · ${row.count}`;
      } else {
        text = `${label} · ${row.count} · ${row.rate === null ? '—' : `${row.rate}%`}`;
      }
      region.append(
        h('p', {
          'data-stage': row.stage,
          'data-count': String(row.count),
          'data-rate':
            row.stage === 'rejected' || row.stage === 'withdrawn' || row.rate === null
              ? ''
              : String(row.rate),
          class: 'funnel-row tabular',
          text,
        }),
      );
    }
    const minutes = funnel.median_first_view_minutes;
    const value =
      minutes === null
        ? '—'
        : minutes >= 60
          ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
          : `${minutes}m`;
    region.append(
      h('p', {
        'data-median-first-view': minutes === null ? '' : String(minutes),
        class: 'funnel-row tabular',
        text: `Median time to first view: ${value}`,
      }),
    );
    return region;
  }

  function draw(funnel: Funnel | null): void {
    host.replaceChildren(h('h1', { class: 'page-title', text: `Applicants · ${jobTitle}` }));
    if (funnel && !isPhone()) host.append(funnelRegion(funnel));
    const board = h('div', { class: isPhone() ? 'board phone' : 'board' });
    STAGE_ORDER.forEach((state, columnIndex) => {
      const list = h('ul', {
        'aria-label': STAGE_LABELS[state],
        class: 'board-column',
        'data-column': state,
        dragover: (event: Event) => event.preventDefault(),
        drop: (event: Event) => {
          event.preventDefault();
          const id = (event as DragEvent).dataTransfer?.getData('text/plain') ?? '';
          const card = findCard(id);
          if (card) void moveCard(card, state);
        },
      });
      list.append(
        h('li', { class: 'column-head' }, [
          h('span', { text: STAGE_LABELS[state] }),
          h('span', { class: 'count tabular', text: String((columns[state] ?? []).length) }),
        ]),
      );
      for (const card of columns[state] ?? []) {
        list.append(cardNode(card, columnIndex));
      }
      board.append(list);
    });
    host.append(board);
    if (funnel && isPhone()) host.append(funnelRegion(funnel));
  }

  function findCard(id: string): BoardCard | null {
    for (const list of Object.values(columns)) {
      const found = list.find((card) => card.id === id);
      if (found) return found;
    }
    return null;
  }

  function cardNode(card: BoardCard, columnIndex: number): HTMLElement {
    const item = h('li', {
      class: 'board-card',
      tabindex: '0',
      draggable: 'true',
      'data-application-id': card.id,
      'data-state': card.state,
      dragstart: (event: Event) => {
        (event as DragEvent).dataTransfer?.setData('text/plain', card.id);
      },
      keydown: (event: Event) => onCardKey(event as KeyboardEvent, card, columnIndex, item),
    });
    const moveButton = h(
      'button',
      {
        type: 'button',
        class: 'button quiet',
        click: () => {
          const targets = allowedNext(card.state).filter((state) => state !== 'withdrawn');
          menu(
            moveButton,
            targets.map((state) => ({
              label: `Move to ${STAGE_LABELS[state]}`,
              run: () => void moveCard(card, state),
            })),
          );
        },
      },
      [`Move ${card.applicant.name}`],
    );
    item.append(
      h(
        'a',
        {
          href: `#application-${card.id}`,
          class: 'person-name small',
          click: (event: Event) => {
            event.preventDefault();
            void openApplicationDialog(card, event.currentTarget as HTMLElement);
          },
        },
        [card.applicant.name],
      ),
      h('p', { class: 'muted', text: card.applicant.headline }),
      moveButton,
    );
    return item;
  }

  function onCardKey(
    event: KeyboardEvent,
    card: BoardCard,
    columnIndex: number,
    item: HTMLElement,
  ): void {
    if (event.key === ' ') {
      event.preventDefault();
      if (!picked) {
        picked = { card, from: card.state, column: columnIndex };
        item.classList.add('picked');
        announce('Jobs announcements', S.announce.pickedUp(card.applicant.name));
        return;
      }
      const target = STAGE_ORDER[picked.column];
      const held = picked;
      picked = null;
      item.classList.remove('picked');
      if (target === held.from) return;
      void moveCard(held.card, target);
      return;
    }
    if (event.key === 'Escape' && picked) {
      event.preventDefault();
      picked = null;
      item.classList.remove('picked');
      announce('Jobs announcements', S.announce.moveCancelled);
      return;
    }
    if (!picked) return;
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const legal = allowedNext(picked.from).filter((state) => state !== 'withdrawn');
    const indices = legal
      .map((state) => STAGE_ORDER.indexOf(state))
      .sort((a, b) => a - b);
    if (indices.length === 0) return;
    const current = picked.column;
    const next =
      event.key === 'ArrowRight'
        ? (indices.find((index) => index > current) ?? indices[0])
        : ([...indices].reverse().find((index) => index < current) ?? indices[indices.length - 1]);
    picked.column = next;
    announce('Jobs announcements', `${STAGE_LABELS[STAGE_ORDER[next]]}`);
  }

  async function moveCard(card: BoardCard, to: ApplicationState): Promise<void> {
    const result = await api.post<{ error?: string; from?: string }>(
      `/api/applications/${card.id}/transition`,
      { to },
    );
    if (result.ok) {
      announce('Jobs announcements', S.announce.movedTo(card.applicant.name, STAGE_LABELS[to]));
      await load();
      qs<HTMLElement>(`[data-application-id="${card.id}"]`, host)?.focus();
      return;
    }
    if (result.status === 409 && result.body.error === 'invalid_transition' && result.body.from) {
      showAlert(host, S.alert.applicationAlreadyMoved(STAGE_LABELS[result.body.from]));
      await load();
      qs<HTMLElement>(`[data-application-id="${card.id}"]`, host)?.focus();
      return;
    }
    showAlert(host, S.alert.somethingWrong);
  }

  async function openApplicationDialog(card: BoardCard, opener: HTMLElement): Promise<void> {
    const result = await api.get<{
      id: string;
      state: string;
      status_text: string;
      resume_url: string | null;
      history: { status_text: string; at: string; by: string; reason: string | null }[];
    }>(`/api/applications/${card.id}`);
    if (!result.ok) {
      showAlert(host, S.alert.somethingWrong);
      return;
    }
    void load();
    dialog(
      `Application from ${card.applicant.name}`,
      (close) => {
        const history = h('ul', {
          'aria-label': `History for ${jobTitle}`,
          class: 'plain-list',
        });
        for (const entry of result.body.history) {
          const who =
            entry.by === 'you'
              ? 'You'
              : entry.by === 'hiring_team'
                ? 'Hiring team'
                : `Automatic: ${entry.reason ?? ''}`;
          history.append(
            h('li', {
              text: `${entry.status_text} · ${formatDateTime(new Date(entry.at), cfg().time_zone)} · ${who}`,
            }),
          );
        }
        return [
          h('h2', { text: `Application from ${card.applicant.name}` }),
          result.body.resume_url
            ? h('a', { href: result.body.resume_url, class: 'link underline' }, ['Download resume'])
            : null,
          history,
          h('button', { type: 'button', class: 'button quiet', click: () => close() }, ['Close']),
        ];
      },
      opener,
    );
  }
}
