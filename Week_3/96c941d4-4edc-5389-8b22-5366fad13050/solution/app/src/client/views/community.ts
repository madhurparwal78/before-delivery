import { DEVICES, DIFFICULTIES, RULESET, deviceSpec } from '../../shared/constants.js';
import { formatCharge, formatTenthsPercent, formatTick } from '../../shared/format.js';
import type { Ticket } from '../../shared/types.js';
import { api, query } from '../api.js';
import { setBusy, button, field, h, region, select, table } from '../dom.js';
import { INDEXING_COPY, PENDING_COPY, SUCCESS_COPY, feedback } from '../feedback.js';
import type { BoardView, ChallengeView, SeasonView, Shell } from '../shell.js';
import { startDefenceSession } from './defence.js';
import { openReplay } from './replay.js';

const SEASON_REFRESH_MS = 30000;
let seasonTimer: number | null = null;
let boardTimer: number | null = null;

export async function runSearch(shell: Shell, announce: boolean): Promise<void> {
  if (announce) feedback.pending(PENDING_COPY.search);
  try {
    const response = await api.get<{ challenges: ChallengeView[]; indexing: 'pending' | 'current' }>(
      `/api/challenges${query({
        q: shell.state.searchText === '' ? null : shell.state.searchText,
        difficulty: shell.state.filterDifficulty === '' ? null : shell.state.filterDifficulty,
        ruleset: shell.state.filterRuleset === '' ? null : shell.state.filterRuleset,
      })}`,
    );
    shell.state.challenges = response.challenges;
    shell.state.indexing = response.indexing;
    shell.state.stale = false;
    feedback.dependencyRecovered();
    if (announce) feedback.succeed(SUCCESS_COPY.search);
  } catch (error) {
    shell.state.stale = true;
    feedback.fail(error);
  }
  shell.render();
}

export async function loadSeason(shell: Shell, instant: string | null): Promise<void> {
  try {
    shell.state.season = await api.get<SeasonView>(`/api/season${query({ at: instant })}`);
    shell.state.seasonContext = instant;
    updateSeasonReadouts(shell);
    feedback.dependencyRecovered();
  } catch (error) {
    shell.state.stale = true;
    feedback.fail(error);
  }
}

async function loadBoard(shell: Shell, digest: string): Promise<void> {
  feedback.pending(PENDING_COPY.inspection);
  try {
    shell.state.board = await api.get<BoardView>(`/api/challenges/${digest}/leaderboard`);
    shell.state.boardDigest = digest;
    feedback.succeed(SUCCESS_COPY.inspection);
  } catch (error) {
    feedback.fail(error);
  }
  shell.render();
}

function seasonPanel(shell: Shell): HTMLElement {
  const season = shell.state.season;
  const instantField = field('Season instant', 'text', shell.state.seasonInstant, (value) => {
    shell.state.seasonInstant = value;
  });
  return h('div', { class: 'panel paper season-panel' }, [
    region('Season summary', 'season-summary', [
      h('h2', {}, ['Season summary']),
      h('p', { class: 'numeric' }, [
        season === null
          ? 'Season records not loaded.'
          : `Season day ${season.seasonDay} · Kathmandu local time ${season.localTime}`,
      ]),
      shell.state.stale ? h('p', { class: 'stale' }, ['Stale']) : null,
    ]),
    region('Daily challenge', 'daily-challenge', [
      h('h3', {}, ['Daily challenge']),
      h('p', {}, [
        season === null || season.dailyDigest === null
          ? 'No daily challenge is selected for this season day.'
          : `Daily digest ${season.dailyDigest}`,
      ]),
    ]),
    region('Season streak', 'season-streak', [
      h('h3', {}, ['Season streak']),
      h('p', { class: 'numeric' }, [
        season === null || season.streak === null
          ? 'Sign in to read your streak.'
          : `${season.streak} consecutive season days`,
      ]),
    ]),
    instantField.wrapper,
    h('div', { class: 'actions-row' }, [
      button('Inspect season', () => {
        void loadSeason(shell, shell.state.seasonInstant === '' ? null : shell.state.seasonInstant).then(
          () => shell.render(),
        );
      }),
    ]),
    h('div', { class: 'season-standings' }, season?.standings === null || season === null ? [] : [boardTable('Season standings', season.standings, shell), boardSummary(season.standings)]),
  ]);
}

function updateSeasonReadouts(shell: Shell): void {
  const season = shell.state.season;
  if (season === null) return;
  const panel = shell.main.querySelector('.season-panel');
  if (panel === null) return;
  const summary = panel.querySelector('.season-summary .numeric');
  if (summary !== null) summary.textContent = `Season day ${season.seasonDay} · Kathmandu local time ${season.localTime}`;
  const daily = panel.querySelector('.daily-challenge p');
  if (daily !== null) daily.textContent = season.dailyDigest === null ? 'No daily challenge is selected for this season day.' : `Daily digest ${season.dailyDigest}`;
  const streak = panel.querySelector('.season-streak p');
  if (streak !== null) streak.textContent = season.streak === null ? 'Sign in to read your streak.' : `${season.streak} consecutive season days`;
  const standings = panel.querySelector('.season-standings');
  if (standings !== null) standings.replaceChildren(...(season.standings === null ? [] : [boardTable('Season standings', season.standings, shell),boardSummary(season.standings)]));
}

export function boardTable(name: string, board: BoardView, shell: Shell): HTMLElement {
  const rows = board.rows.map((row) => [
    String(row.rank),
    row.playerName,
    String(row.breaches),
    formatTick(row.completionTick),
    formatCharge(row.remainingCharge),
    button(`Watch replay ${row.runId}`, () => openReplay(shell, row.runId), { label: 'Watch replay' }),
  ]);
  const scroll = region('Leaderboard scroll area', 'board-scroll', [
    table(name, ['Rank', 'Player', 'Breaches', 'Completion time', 'Remaining charge', 'Replay'], rows),
  ]);
  scroll.tabIndex = 0;
  return scroll;
}

export function refreshBoardTable(host: HTMLElement, name: string, board: BoardView, shell: Shell): void {
  const signature = JSON.stringify(board.rows);
  if (host.dataset.signature === signature) return;
  const focused = document.activeElement as HTMLElement | null;
  const focusedName = host.contains(focused) ? focused?.getAttribute('aria-label') : null;
  const fresh = boardTable(name, board, shell);
  host.replaceChildren(...fresh.childNodes);
  host.dataset.signature = signature;
  if (focusedName !== null) {
    for (const action of host.querySelectorAll('button')) {
      if (action.getAttribute('aria-label') === focusedName) action.focus({ preventScroll: true });
    }
  }
}

export function boardSummary(board: BoardView): HTMLElement {
  return h('div', { class: 'panel paper' }, [
    region('Personal best', 'personal-best', [
      h('h3', {}, ['Personal best']),
      h('p', { class: 'numeric' }, [
        board.personalBest === null
          ? 'No personal best recorded for this challenge.'
          : `Rank ${board.personalBest.rank} · ${board.personalBest.breaches} breaches · ${formatTick(board.personalBest.completionTick)} · ${formatCharge(board.personalBest.remainingCharge)}`,
      ]),
    ]),
    region('Challenge completions', 'completions', [
      h('h3', {}, ['Challenge completions']),
      h('p', { class: 'numeric' }, [`${board.completions} distinct winning accounts`]),
    ]),
    table(
      'Crew usage',
      ['Crew', 'Deployments', 'Usage'],
      board.crewUsage.map((usage) => [
        deviceSpec(usage.device).name,
        String(usage.deployments),
        formatTenthsPercent(usage.tenthsPercent),
      ]),
    ),
  ]);
}

function challengeDetails(shell: Shell): HTMLElement {
  const challenge = shell.state.selectedChallenge;
  if (challenge === null) {
    return region('Selected challenge', 'panel paper manifest', [
      h('h2', {}, ['Selected challenge']),
      h('p', {}, ['Open a published challenge to read its original rules.']),
    ]);
  }
  const attemptButton = button('Attempt challenge', async () => {
    setBusy(attemptButton, true);
    feedback.pending(PENDING_COPY.startDefence);
    try {
      const response = await api.post<{ ticket: Ticket }>('/api/runs', {
        mode: 'challenge',
        sourceId: challenge.digest,
        revision: null,
        loadout: DEVICES.slice(0, 4).map((device) => device.id),
      });
      await api.post(`/api/runs/${response.ticket.id}/start`, {});
      feedback.succeed(SUCCESS_COPY.startDefence);
      startDefenceSession(shell, response.ticket, challenge.definition, 'challenge');
    } catch (error) {
      feedback.fail(error);
      setBusy(attemptButton, false);
    }
  });
  return region('Selected challenge', 'panel paper manifest', [
    h('h2', {}, ['Selected challenge']),
    h('dl', { class: 'manifest-list' }, [
      h('dt', {}, ['Title']),
      h('dd', {}, [challenge.title]),
      h('dt', {}, ['Keeper']),
      h('dd', {}, [challenge.creatorName]),
      h('dt', {}, ['Difficulty']),
      h('dd', {}, [challenge.difficulty]),
      h('dt', {}, ['Ruleset']),
      h('dd', {}, [challenge.ruleset]),
      h('dt', {}, ['Seed']),
      h('dd', { class: 'numeric' }, [String(challenge.definition.seed)]),
      h('dt', {}, ['Digest']),
      h('dd', { class: 'digest' }, [challenge.digest]),
      h('dt', {}, ['Completions']),
      h('dd', { class: 'numeric' }, [String(challenge.completions)]),
      h('dt', {}, ['Waves']),
      h('dd', {}, [
        h(
          'ul',
          {},
          challenge.definition.waves.map((wave, index) =>
            h('li', {}, [
              `Wave ${index + 1}: ${wave.count} × ${wave.creature} from ${formatTick(wave.tick)} every ${formatTick(wave.interval)} in lane ${wave.lane === 0 ? 'random' : wave.lane}`,
            ]),
          ),
        ),
      ]),
    ]),
    h('div', { class: 'actions-row' }, [
      attemptButton,
      button('View leaderboard', () => {
        void loadBoard(shell, challenge.digest).then(() => shell.navigate('Leaderboard'));
      }),
    ]),
  ]);
}

export function renderCommunity(shell: Shell): void {
  const searchField = field('Search challenges', 'text', shell.state.searchText, (value) => {
    shell.state.searchText = value;
  });
  const difficultyFilter = select(
    'Filter difficulty',
    shell.state.filterDifficulty,
    [{ value: '', label: 'Any difficulty' }, ...DIFFICULTIES.map((d) => ({ value: d, label: d }))],
    (value) => {
      shell.state.filterDifficulty = value;
      void runSearch(shell, true);
    },
  );
  const rulesetFilter = select(
    'Filter ruleset',
    shell.state.filterRuleset,
    [
      { value: '', label: 'Any ruleset' },
      { value: RULESET, label: RULESET },
    ],
    (value) => {
      shell.state.filterRuleset = value;
      void runSearch(shell, true);
    },
  );

  const discovery = h('div', { class: 'panel sea' }, [
    h('h2', {}, ['Community']),
    searchField.wrapper,
    difficultyFilter.wrapper,
    rulesetFilter.wrapper,
    h('div', { class: 'actions-row' }, [
      button('Search', () => void runSearch(shell, true)),
      button('Refresh challenges', () => void runSearch(shell, true)),
    ]),
    region('Discovery indexing', 'indexing', [
      h('p', {}, [INDEXING_COPY[shell.state.indexing]]),
      shell.state.stale ? h('p', { class: 'stale' }, ['Stale']) : null,
    ]),
    region('Published challenges', 'results', [
      h('h3', {}, ['Published challenges']),
      shell.state.challenges.length === 0
        ? h('p', {}, ['No published challenges match this search.'])
        : h(
            'ul',
            { class: 'challenge-list' },
            shell.state.challenges.map((challenge) =>
              h('li', {}, [
                h('span', {}, [
                  `${challenge.title} — ${challenge.difficulty} by ${challenge.creatorName}`,
                ]),
                button(`Open challenge ${challenge.title}`, () => {
                  shell.state.selectedChallenge = challenge;
                  shell.render();
                }, { label: 'Open challenge' }),
              ]),
            ),
          ),
    ]),
  ]);

  shell.surface.set([
    { name: 'board', node: discovery },
    { name: 'manifest', node: challengeDetails(shell) },
    { name: 'summary', node: seasonPanel(shell) },
  ]);
  shell.main.append(shell.surface.element);
  scheduleSeasonRefresh(shell);
}

function scheduleSeasonRefresh(shell: Shell): void {
  if (seasonTimer !== null) window.clearInterval(seasonTimer);
  seasonTimer = window.setInterval(() => {
    if (shell.state.view !== 'Community' || shell.state.seasonContext !== null) return;
    void loadSeason(shell, null);
  }, SEASON_REFRESH_MS);
}

export function renderLeaderboard(shell: Shell): void {
  const board = shell.state.board;
  if (board === null) {
    shell.main.append(
      h('div', { class: 'panel paper' }, [
        h('h2', {}, ['Leaderboard']),
        h('p', {}, ['Open a challenge and view its leaderboard.']),
        button('Return to community', () => shell.navigate('Community')),
      ]),
    );
    return;
  }
  const actions = h('div', { class: 'panel paper' }, [
    h('div', { class: 'actions-row' }, [
      button('Refresh leaderboard', () => void loadBoard(shell, board.digest)),
      button('Return to community', () => shell.navigate('Community')),
    ]),
  ]);
  const tableHost = boardTable('Verified leaderboard', board, shell);
  const summaryHost = boardSummary(board);
  shell.surface.set([
    { name: 'leaderboard', node: tableHost },
    { name: 'summary', node: summaryHost },
    { name: 'actions', node: actions },
  ]);
  shell.main.append(shell.surface.element);
  if (boardTimer !== null) window.clearInterval(boardTimer);
  boardTimer = window.setInterval(() => {
    if (shell.state.view !== 'Leaderboard') { if (boardTimer !== null) window.clearInterval(boardTimer); boardTimer = null; return; }
    void api.get<BoardView>(`/api/challenges/${board.digest}/leaderboard`).then((fresh) => {
      if (!tableHost.isConnected) return;
      shell.state.board = fresh;
      refreshBoardTable(tableHost, 'Verified leaderboard', fresh, shell);
      summaryHost.replaceChildren(...boardSummary(fresh).childNodes);
      tableHost.removeAttribute('data-stale');
      feedback.dependencyRecovered();
    }).catch((error: Error) => {
      tableHost.dataset.stale = 'Stale';
      feedback.dependencyFailed(error.message);
    });
  }, 750);
}
