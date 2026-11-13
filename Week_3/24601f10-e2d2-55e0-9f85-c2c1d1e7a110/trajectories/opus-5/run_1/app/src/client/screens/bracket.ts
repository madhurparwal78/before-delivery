import { slotName } from '../../shared/cards';
import { checkinClosedAt, checkinClosesAt, checkinCount } from '../../shared/copy';
import { regionCurrentRound, regionsOf, roundsOf } from '../../shared/current';
import {
  FORMAT_NAMES,
  ROUND_ROBIN_COLUMNS,
  SWISS_COLUMNS,
  type ApiMatch,
  type ApiTournament,
  type BracketKind,
  type StandingsRow,
} from '../../shared/types';
import { api, ApiError } from '../api';
import { navigate, pageAlert, refresh, state } from '../app';
import { cardElement, openCardDialog, seenMatches, updateCard, viewerOf, type Viewer } from '../card';
import { h, prefersReducedMotion } from '../dom';
import { arrowTarget } from '../navigation';
import { shareControls } from './setup';

const REGION_LABELS: Record<BracketKind, string> = {
  main: 'Bracket',
  winners: 'Winners bracket',
  losers: 'Losers bracket',
  final: 'Grand final',
};

export const layoutKind = (): 'phone' | 'tablet' | 'desk' => {
  const width = window.innerWidth;
  if (width < 768) return 'phone';
  return width < 1200 ? 'tablet' : 'desk';
};

const regionLabel = (tournament: ApiTournament, bracket: BracketKind): string =>
  tournament.format === 'round_robin' || tournament.format === 'swiss' ? 'Rounds' : REGION_LABELS[bracket];

const roundTabName = (tournament: ApiTournament, bracket: BracketKind, round: number): string => {
  if (tournament.format !== 'double_elimination') return `Round ${round}`;
  if (bracket === 'winners') return `Winners ${round}`;
  if (bracket === 'losers') return `Losers ${round}`;
  return 'Grand final';
};

const zoneTime = (iso: string, zone: string): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(iso),
  );

let wholeBracket = false;

export const toggleWholeBracket = (): void => {
  wholeBracket = !wholeBracket;
  refresh();
};

const cardsByRound = (matches: ApiMatch[], bracket: BracketKind, round: number): ApiMatch[] =>
  matches
    .filter((match) => match.bracket === bracket && match.round === round)
    .sort((a, b) => a.number - b.number);

const focusCard = (matchId: string): void => {
  const card = document.querySelector<HTMLElement>(`[data-match-id="${matchId}"]`);
  if (card === null) return;
  for (const other of document.querySelectorAll<HTMLElement>(`[data-bracket="${card.dataset.bracket}"]`)) {
    other.tabIndex = -1;
  }
  card.tabIndex = 0;
  card.focus();
  card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
};

const buildRegion = (
  tournament: ApiTournament,
  matches: ApiMatch[],
  bracket: BracketKind,
  viewer: Viewer,
  focusTarget: string | null,
): HTMLElement => {
  const rounds = roundsOf(matches, bracket);
  const current = regionCurrentRound(matches, bracket);
  const columns = rounds.map((round) =>
    h(
      'div',
      { class: 'round-column', 'data-round-column': String(round) },
      h('h3', { class: 'round-heading' }, roundTabName(tournament, bracket, round)),
      ...cardsByRound(matches, bracket, round).map((match) => {
        const card = cardElement(match, viewer);
        card.tabIndex = -1;
        return card;
      }),
    ),
  );
  const region = h(
    'section',
    { role: 'region', 'aria-label': regionLabel(tournament, bracket), class: 'bracket-region' },
    ...columns,
  );

  const inOrder = region.querySelectorAll<HTMLElement>('.card');
  const preferred =
    (focusTarget === null ? null : region.querySelector<HTMLElement>(`[data-match-id="${focusTarget}"]`)) ??
    region.querySelector<HTMLElement>(`[data-round="${current}"]`) ??
    inOrder[0] ??
    null;
  if (preferred !== null) preferred.tabIndex = 0;

  region.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains('card')) return;
    const matchId = target.dataset.matchId;
    const match = matches.find((row) => row.id === matchId);
    if (match === undefined) return;
    if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      const next = arrowTarget(matches, match, event.key, tournament.format);
      event.preventDefault();
      if (next !== null) focusCard(next.id);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openCardDialog(match.id, target);
    }
  });
  return region;
};

const standingsTable = (tournament: ApiTournament): HTMLElement | null => {
  const standings = state.standings;
  if (standings === null) return null;
  const columns = tournament.format === 'swiss' ? SWISS_COLUMNS : ROUND_ROBIN_COLUMNS;
  const cellsFor = (row: StandingsRow): (string | number)[] =>
    tournament.format === 'swiss'
      ? [
          row.place,
          row.name,
          row.played,
          row.match_points,
          'buchholz_cut_1' in row ? row.buchholz_cut_1 : '',
          'buchholz' in row ? row.buchholz : '',
          'sonneborn_berger' in row ? row.sonneborn_berger : '',
          row.seed,
          row.decided_by,
        ]
      : [
          row.place,
          row.name,
          row.played,
          row.match_points,
          'head_to_head' in row ? row.head_to_head : '',
          'game_difference' in row ? row.game_difference : '',
          'games_won' in row ? row.games_won : '',
          row.seed,
          row.decided_by,
        ];
  return h(
    'table',
    { 'aria-label': 'Standings', class: 'standings' },
    h('thead', {}, h('tr', {}, ...columns.map((column) => h('th', { scope: 'col' }, column)))),
    h(
      'tbody',
      {},
      ...standings.rows.map((row) =>
        h('tr', { 'data-entrant-id': row.entrant_id }, ...cellsFor(row).map((cell) => h('td', {}, String(cell)))),
      ),
    ),
  );
};

let phoneTab: { bracket: BracketKind; round: number } | null = null;

const phoneTabs = (
  tournament: ApiTournament,
  matches: ApiMatch[],
  viewer: Viewer,
  focusTarget: string | null,
): HTMLElement => {
  const tabs: { bracket: BracketKind; round: number; name: string }[] = [];
  for (const bracket of regionsOf(tournament.format)) {
    for (const round of roundsOf(matches, bracket)) {
      if (bracket === 'final' && round === 2) continue;
      tabs.push({ bracket, round, name: roundTabName(tournament, bracket, round) });
    }
  }
  const currentRound = tournament.current_round;
  const selected =
    phoneTab ??
    (currentRound === null
      ? tabs[0]
      : tabs.find(
          (tab) =>
            tab.bracket === currentRound.bracket &&
            (tab.bracket === 'final' || tab.round === currentRound.round),
        ) ?? tabs[0]);
  const active = selected ?? { bracket: 'main' as BracketKind, round: 1 };

  const panelMatches =
    active.bracket === 'final'
      ? matches.filter((match) => match.bracket === 'final')
      : cardsByRound(matches, active.bracket, active.round);

  const tablist = h('div', { role: 'tablist', 'aria-label': 'Rounds', class: 'round-tabs' });
  for (const tab of tabs) {
    const isSelected = tab.bracket === active.bracket && tab.round === active.round;
    const button = h(
      'button',
      {
        type: 'button',
        role: 'tab',
        'aria-selected': isSelected ? 'true' : 'false',
        tabindex: isSelected ? '0' : '-1',
        class: 'round-tab',
      },
      tab.name,
    );
    button.addEventListener('click', () => {
      phoneTab = { bracket: tab.bracket, round: tab.round };
      refresh();
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const index = tabs.findIndex((item) => item.bracket === active.bracket && item.round === active.round);
      const next = tabs[event.key === 'ArrowRight' ? index + 1 : index - 1];
      if (next === undefined) return;
      phoneTab = { bracket: next.bracket, round: next.round };
      refresh();
    });
    tablist.appendChild(button);
  }

  const panel = h(
    'div',
    { role: 'tabpanel', 'aria-label': roundTabName(tournament, active.bracket, active.round), class: 'round-panel' },
    ...panelMatches.map((match) => {
      const card = cardElement(match, viewer);
      card.tabIndex = focusTarget === match.id ? 0 : -1;
      return card;
    }),
  );
  if (panel.querySelector('[tabindex="0"]') === null) {
    const first = panel.querySelector<HTMLElement>('.card');
    if (first !== null) first.tabIndex = 0;
  }
  panel.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains('card')) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const matchId = target.dataset.matchId;
      if (matchId !== undefined) openCardDialog(matchId, target);
    }
  });

  let swipeStart: { x: number; y: number } | null = null;
  panel.addEventListener('pointerdown', (event) => {
    swipeStart = { x: event.clientX, y: event.clientY };
  });
  const endSwipe = (event: PointerEvent): void => {
    if (swipeStart === null) return;
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) <= Math.abs(dy)) return;
    const index = tabs.findIndex((item) => item.bracket === active.bracket && item.round === active.round);
    const next = tabs[dx < 0 ? index + 1 : index - 1];
    if (next === undefined) return;
    phoneTab = { bracket: next.bracket, round: next.round };
    refresh();
  };
  panel.addEventListener('pointerup', endSwipe);
  panel.addEventListener('pointercancel', () => {
    swipeStart = null;
  });

  return h('div', { class: 'phone-rounds' }, tablist, panel);
};

const organizerActions = (tournament: ApiTournament): HTMLElement => {
  const actions = h('div', { class: 'actions' });
  const role = tournament.my_role;
  const isOrganizer = role === 'organizer' || role === 'co_organizer';
  if (!isOrganizer) return actions;

  if (tournament.format === 'swiss' && tournament.state === 'running') {
    const next = h('button', { type: 'button', class: 'primary' }, 'Start next round');
    next.addEventListener('click', () => {
      api
        .nextRound(tournament.id)
        .then(() => undefined)
        .catch((error: unknown) => {
          if (error instanceof ApiError) pageAlert(error.message);
        });
    });
    actions.appendChild(next);
  }
  const setup = h('a', { href: `/t/${tournament.id}/setup`, class: 'link' }, 'Setup');
  const disputes = h('a', { href: `/t/${tournament.id}/disputes`, class: 'link' }, 'Open disputes');
  actions.append(setup, disputes, shareControls(tournament));
  return actions;
};

const checkInBoxes = (tournament: ApiTournament): HTMLElement | null => {
  const role = tournament.my_role;
  if (role !== 'organizer' && role !== 'co_organizer') return null;
  if (tournament.state !== 'checkin_open') return null;
  const boxes = h('div', { class: 'checkin-boxes' });
  for (const entrant of state.entrants) {
    const box = h('input', {
      type: 'checkbox',
      'aria-label': `Checked in: ${entrant.name}`,
      checked: entrant.checked_in,
    }) as HTMLInputElement;
    box.addEventListener('change', () => {
      void api.setCheckedIn(entrant.id, box.checked).catch((error: unknown) => {
        if (error instanceof ApiError) pageAlert(error.message);
      });
    });
    boxes.appendChild(h('label', { class: 'checkin-box' }, box, h('span', {}, entrant.name)));
  }
  return boxes;
};

const checkInButton = (tournament: ApiTournament): HTMLElement | null => {
  if (tournament.state !== 'checkin_open') return null;
  if (state.myEntrantId === null) return null;
  const mine = state.entrants.find((entrant) => entrant.id === state.myEntrantId);
  if (mine !== undefined && mine.checked_in) return null;
  const button = h('button', { type: 'button', class: 'primary' }, 'Check in');
  button.addEventListener('click', () => {
    api
      .checkIn(tournament.id)
      .then(() => {
        navigate(`/t/${tournament.id}/me`);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError) pageAlert(error.message);
      });
  });
  return button;
};

export const fieldList = (): HTMLElement => {
  const entrants = state.shareCode === null ? state.entrants : state.publicEntrants;
  return h(
    'ul',
    { role: 'list', 'aria-label': 'Field', class: 'plain-list' },
    ...entrants.map((entrant) => h('li', {}, `${entrant.seed}. ${entrant.name}`)),
  );
};

export const roundOnePreview = (matches: { number: number; upper: unknown; lower: unknown }[]): HTMLElement =>
  h(
    'ul',
    { role: 'list', 'aria-label': 'Round 1 preview', class: 'plain-list' },
    ...matches.map((match) =>
      h(
        'li',
        {},
        `Match ${match.number}: ${slotName(match.upper as never)} vs ${slotName(match.lower as never)}`,
      ),
    ),
  );

const announcementRegions = (): HTMLElement[] => [
  h(
    'div',
    {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Bracket announcements',
      class: 'announcements',
    },
    state.announcement,
  ),
  h('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Your action',
    class: 'your-action',
    'data-your-action': '',
  }),
];

const panning = (area: HTMLElement): void => {
  let dragging = false;
  let startX = 0;
  let startScroll = 0;
  area.addEventListener('pointerdown', (event) => {
    if ((event.target as HTMLElement).closest('.card') !== null) return;
    dragging = true;
    startX = event.clientX;
    startScroll = area.scrollLeft;
  });
  area.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    area.scrollLeft = startScroll - (event.clientX - startX);
  });
  area.addEventListener('pointerup', () => {
    dragging = false;
  });
  area.addEventListener('pointercancel', () => {
    dragging = false;
  });
  area.addEventListener(
    'wheel',
    (event) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      area.scrollLeft += event.deltaX;
    },
    { passive: true },
  );
};

export const bracketScreen = (tournament: ApiTournament, readOnly: boolean): HTMLElement => {
  const viewer = viewerOf();
  const layout = layoutKind();
  const matches = state.matches;
  const focusTarget = state.route.query.get('match');

  const rail = h(
    'div',
    { class: 'rail' },
    readOnly ? null : h('h1', {}, tournament.name),
    h('p', { class: 'state' }, `${FORMAT_NAMES[tournament.format]} · ${tournament.state.replace('_', ' ')}`),
    tournament.state === 'checkin_open' || tournament.state === 'checkin_closed'
      ? h(
          'div',
          { role: 'status', 'aria-label': 'Check-in count', class: 'checkin-count' },
          checkinCount(tournament.checked_in_count, tournament.entrant_count),
        )
      : null,
    tournament.checkin_closes_at === null ||
    (tournament.state !== 'checkin_open' && tournament.state !== 'checkin_closed')
      ? null
      : h(
          'p',
          { class: 'checkin-time' },
          tournament.state === 'checkin_open'
            ? checkinClosesAt(zoneTime(tournament.checkin_closes_at, tournament.time_zone), tournament.time_zone)
            : checkinClosedAt(zoneTime(tournament.checkin_closes_at, tournament.time_zone), tournament.time_zone),
        ),
    readOnly ? null : checkInButton(tournament),
    readOnly ? null : checkInBoxes(tournament),
    readOnly ? null : organizerActions(tournament),
    ...announcementRegions(),
  );

  const area = h('div', { class: 'bracket-area', 'data-bracket-area': '' });
  const started = tournament.state === 'running' || tournament.state === 'finished';

  if (!started) {
    area.append(
      h('h2', {}, 'Field'),
      fieldList(),
      h('div', { role: 'region', 'aria-label': 'Bracket preview', class: 'preview' }, h('h2', {}, 'Round 1 preview')),
    );
    void api
      .preview(tournament.id)
      .then(({ matches: preview }) => {
        area.querySelector('.preview')?.appendChild(roundOnePreview(preview));
      })
      .catch(() => undefined);
  } else if (layout === 'phone') {
    area.appendChild(phoneTabs(tournament, matches, viewer, focusTarget));
  } else {
    for (const bracket of regionsOf(tournament.format)) {
      if (roundsOf(matches, bracket).length === 0) continue;
      area.appendChild(buildRegion(tournament, matches, bracket, viewer, focusTarget));
    }
  }

  const standings = standingsTable(tournament);
  if (standings !== null) area.appendChild(standings);

  const whole = h(
    'button',
    { type: 'button', 'aria-pressed': wholeBracket ? 'true' : 'false', class: 'whole' },
    'Whole bracket',
  );
  whole.addEventListener('click', toggleWholeBracket);
  if (started) rail.appendChild(whole);
  if (wholeBracket) area.classList.add('whole-bracket');

  panning(area);

  const page = h('div', { class: `bracket-page layout-${layout}` }, rail, area);

  window.requestAnimationFrame(() => {
    if (focusTarget !== null) focusCard(focusTarget);
    else scrollCurrentRound(area, tournament, matches);
  });
  return page;
};

const scrollCurrentRound = (area: HTMLElement, tournament: ApiTournament, matches: ApiMatch[]): void => {
  if (wholeBracket) return;
  for (const region of area.querySelectorAll<HTMLElement>('.bracket-region')) {
    const bracket = (region.querySelector<HTMLElement>('.card')?.dataset.bracket ?? 'main') as BracketKind;
    const round = regionCurrentRound(matches, bracket);
    const column = region.querySelector<HTMLElement>(`[data-round-column="${round}"]`);
    if (column !== null) region.scrollLeft = column.offsetLeft - region.offsetLeft;
  }
  void tournament;
};

const slotEntrant = (slot: ApiMatch['upper']): string | null =>
  slot !== null && 'entrant_id' in slot ? slot.entrant_id : null;

/** Updates the cards in place so focus, scroll and motion survive a live change. */
export const patchCards = (changed: ApiMatch[]): void => {
  const viewer = viewerOf();
  for (const match of changed) {
    const previous = seenMatches.get(match.id);
    const card = document.querySelector<HTMLButtonElement>(`[data-match-id="${match.id}"]`);
    if (card === null) continue;
    updateCard(card, match, viewer);
    if (previous === undefined || prefersReducedMotion()) continue;
    for (const side of ['upper', 'lower'] as const) {
      const arrived = slotEntrant(match[side]);
      if (arrived === null || arrived === slotEntrant(previous[side])) continue;
      flyName(card, arrived, match);
    }
  }
};

/** The advance motion: a copy of the winner's name travels from its card to its next card. */
const flyName = (destination: HTMLElement, entrantId: string, match: ApiMatch): void => {
  const source = state.matches.find(
    (other) =>
      other.id !== match.id &&
      (other.state === 'confirmed' || other.state === 'resolved') &&
      (slotEntrant(other.upper) === entrantId || slotEntrant(other.lower) === entrantId),
  );
  if (source === undefined) return;
  const sourceCard = document.querySelector<HTMLElement>(`[data-match-id="${source.id}"]`);
  if (sourceCard === null) return;
  const name = slotEntrant(source.upper) === entrantId ? slotName(source.upper) : slotName(source.lower);
  const from = sourceCard.getBoundingClientRect();
  const to = destination.getBoundingClientRect();
  const flier = h('span', { class: 'flier', 'data-motion': 'advance' }, name);
  flier.style.left = `${from.left + window.scrollX}px`;
  flier.style.top = `${from.top + window.scrollY}px`;
  document.body.appendChild(flier);
  const motion = flier.animate(
    [{ transform: 'translate(0, 0)' }, { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px)` }],
    { duration: 320, easing: 'ease-out' },
  );
  motion.addEventListener('finish', () => flier.remove());
};

