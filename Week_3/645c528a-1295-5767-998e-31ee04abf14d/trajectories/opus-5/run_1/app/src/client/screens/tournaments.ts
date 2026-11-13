import { TOURNAMENT_COPY, num } from '../../shared/copy.js';
import { api } from '../api.js';
import { clear, el, labelledButton, statusRegion } from '../dom.js';
import { navigate, type Screen, type ScreenContext } from '../navigate.js';
import { setPendingNotice, takePendingNotice } from '../notices.js';
import { onServerEvent, refreshMe, state } from '../state.js';

interface TournamentBody {
  id: string;
  tier: number;
  tierName: string;
  status: string;
  entry: number;
  entrantCount: number;
  entrants: { slot: number | null; playerId: string; displayName: string; ready: boolean }[];
  prizes: { first: number; second: number; semiFinal: number; house: number };
  windowSecondsLeft: number | null;
  readySecondsLeft: number | null;
  matches: { id: string; round: string | null; status: string; tableUrl: string; seats: (string | null)[] }[];
}

function prizeTable(prizes: TournamentBody['prizes']): HTMLElement {
  const rows: [string, number][] = [
    ['First', prizes.first],
    ['Second', prizes.second],
    ['Semi-final', prizes.semiFinal],
    ['House', prizes.house],
  ];
  return el('table', {
    className: 'prize-table',
    attrs: { 'aria-label': 'Prize split' },
    children: [
      el('thead', { children: [el('tr', { children: [el('th', { text: 'Place' }), el('th', { text: 'Coins' })] })] }),
      el('tbody', {
        children: rows.map(([place, coins]) =>
          el('tr', { children: [el('td', { text: place }), el('td', { text: num(coins) })] }),
        ),
      }),
    ],
  });
}

export function tournamentsScreen(): Screen {
  const list = el('div', { className: 'tournament-list' });
  const notice = statusRegion('Tournament notice', 'notice');

  async function register(tournament: TournamentBody): Promise<void> {
    const result = await api<TournamentBody>('POST', `/api/tournaments/${tournament.id}/register`);
    if (!result.ok) {
      notice.textContent = result.failure.message;
      return;
    }
    notice.textContent = TOURNAMENT_COPY.registered(tournament.entry);
    setPendingNotice('tournament', TOURNAMENT_COPY.registered(tournament.entry));
    await refreshMe();
    navigate(`/tournaments/${tournament.id}`);
  }

  async function load(): Promise<void> {
    const result = await api<{ tournaments: TournamentBody[] }>('GET', '/api/tournaments');
    if (!result.ok) return;
    clear(list);
    for (const tournament of result.data.tournaments) {
      const entrants = statusRegion('Entrants', 'notice');
      entrants.textContent = TOURNAMENT_COPY.entrants(tournament.entrantCount);
      list.append(
        el('div', {
          className: 'tournament-card',
          children: [
            el('h2', {
              children: [
                el('a', {
                  className: 'link',
                  text: tournament.tierName,
                  attrs: { href: `/tournaments/${tournament.id}` },
                  on: {
                    click: (event) => {
                      event.preventDefault();
                      navigate(`/tournaments/${tournament.id}`);
                    },
                  },
                }),
              ],
            }),
            el('p', { text: `Entry ${num(tournament.entry)}` }),
            entrants,
            prizeTable(tournament.prizes),
            labelledButton(`Register for ${tournament.tierName}`, () => void register(tournament), { className: 'button primary' }),
          ],
        }),
      );
    }
  }

  const unsubscribe = onServerEvent('tournaments', () => void load());
  void load();

  return {
    element: el('div', {
      className: 'tournaments',
      children: [el('h1', { className: 'screen-heading', text: 'Tournaments', attrs: { tabindex: '-1' } }), notice, list],
    }),
    topics: ['tournaments'],
    destroy: unsubscribe,
  };
}

export function bracketScreen(context: ScreenContext): Screen {
  const id = context.params.id ?? '';
  const heading = el('h1', { className: 'screen-heading', text: 'Bracket', attrs: { tabindex: '-1' } });
  const entrants = statusRegion('Entrants', 'notice');
  const readyStatus = statusRegion('Ready check', 'notice');
  const log = el('div', { className: 'table-log', attrs: { role: 'log', 'aria-label': 'Tournament announcements', 'aria-live': 'polite' } });
  const slots = el('ul', { className: 'bracket-slots', attrs: { role: 'list', 'aria-label': 'Bracket slots' } });
  const bracket = el('div', { className: 'bracket', attrs: { role: 'region', 'aria-label': 'Bracket' }, children: [slots] });
  const prizeHost = el('div', { className: 'prize-host' });
  const readyButton = labelledButton('Ready', () => void markReady(), { className: 'button primary' });
  readyButton.hidden = true;
  const notice = statusRegion('Tournament notice', 'notice');
  let announced = new Set<string>();
  let body: TournamentBody | null = null;

  function announce(line: string): void {
    if (announced.has(line)) return;
    announced.add(line);
    log.append(el('p', { className: 'log-line', text: line }));
  }

  async function markReady(): Promise<void> {
    const result = await api<TournamentBody>('POST', `/api/tournaments/${id}/ready`);
    if (!result.ok) {
      notice.textContent = result.failure.message;
      return;
    }
    notice.textContent = TOURNAMENT_COPY.readyPressed;
    body = result.data;
    render();
  }

  async function load(): Promise<void> {
    const result = await api<TournamentBody>('GET', `/api/tournaments/${id}`);
    if (!result.ok) {
      notice.textContent = result.failure.message;
      return;
    }
    body = result.data;
    render();
  }

  function render(): void {
    if (!body) return;
    heading.textContent = `${body.tierName} bracket`;
    entrants.textContent = TOURNAMENT_COPY.entrants(body.entrantCount);
    clear(prizeHost);
    prizeHost.append(prizeTable(body.prizes));
    clear(slots);
    for (let index = 1; index <= 8; index += 1) {
      const entrant = body.entrants.find((candidate) => candidate.slot === index);
      const text = entrant ? `Slot ${index}: ${entrant.displayName}` : `Slot ${index}: Open`;
      slots.append(el('li', { className: 'bracket-slot', text, attrs: { role: 'listitem', tabindex: '0' } }));
    }
    const mine = body.entrants.find((entrant) => entrant.playerId === state.me?.id);
    readyButton.hidden = !(body.status === 'ready_check' && mine);
    readyStatus.textContent =
      body.status === 'ready_check' && body.readySecondsLeft !== null ? TOURNAMENT_COPY.readyCheck(body.readySecondsLeft) : '';
    if (body.status === 'ready_check') announce(TOURNAMENT_COPY.bracketDrawn);
    if (body.status === 'round_of_8') announce(TOURNAMENT_COPY.allReady);
    if (body.status === 'refunded') {
      notice.textContent = TOURNAMENT_COPY.windowShort(body.entry);
      announce(TOURNAMENT_COPY.windowShort(body.entry));
    }
    const myMatch = body.matches.find((match) => match.seats.includes(state.me?.id ?? '') && match.status === 'in_play');
    if (myMatch) {
      notice.textContent = '';
      navigate(myMatch.tableUrl);
    }
  }

  const carried = takePendingNotice('tournament');
  if (carried) notice.textContent = carried;
  const unsubscribe = onServerEvent('tournament', () => void load());
  const timer = window.setInterval(() => void load(), 1000);
  void load();

  return {
    element: el('div', {
      className: 'bracket-screen',
      children: [heading, entrants, readyStatus, notice, bracket, readyButton, prizeHost, log],
    }),
    topics: [`tournament:${id}`],
    destroy: () => {
      unsubscribe();
      window.clearInterval(timer);
      announced = new Set();
    },
  };
}
