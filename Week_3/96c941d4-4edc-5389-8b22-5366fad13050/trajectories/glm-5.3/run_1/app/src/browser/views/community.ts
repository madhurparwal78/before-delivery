// Community view: indexed discovery, typed filters, season summary, daily challenge.
import { state, navigate, announceStatus, handleApiError, disabledWhilePending } from '../app.js';
import { api } from '../api.js';
import type { ChallengeShape, SeasonShape } from '../api.js';
import { formatInstantLocal } from '../format.js';

export function renderCommunity(main: HTMLElement): void {
  main.innerHTML = `
    <h1>Community</h1>
    <section aria-label="Challenge search" class="panel search-panel">
      <div class="search-fields">
        <label for="search-challenges">Search challenges</label>
        <input type="text" id="search-challenges" maxlength="100">
        <label for="filter-difficulty">Filter difficulty</label>
        <select id="filter-difficulty" aria-label="Filter difficulty">
          <option value="">Any difficulty</option>
          <option value="calm">calm</option>
          <option value="rough">rough</option>
          <option value="severe">severe</option>
        </select>
        <label for="filter-ruleset">Filter ruleset</label>
        <select id="filter-ruleset" aria-label="Filter ruleset">
          <option value="">Any ruleset</option>
          <option value="orrel-1">orrel-1</option>
        </select>
        <button id="search-button">Search</button>
        <button id="refresh-challenges" class="secondary">Refresh challenges</button>
      </div>
      <p aria-label="Discovery indexing" id="discovery-indexing" class="indexing-state">Discovery state is loading…</p>
    </section>
    <section aria-label="Season summary" id="season-summary" class="panel compact">
      <h2 class="section-heading">Season</h2>
      <p id="season-day-text">Season day is loading…</p>
      <p id="season-local-text"></p>
      <p aria-label="Season streak" id="season-streak-text"></p>
      <div class="season-inspect">
        <label for="season-instant">Season instant</label>
        <input type="text" id="season-instant" placeholder="2026-01-02T10:30:00Z">
        <button id="inspect-season" class="secondary">Inspect season</button>
      </div>
      <section aria-label="Daily challenge" id="daily-challenge" class="daily-challenge">
        <p>Daily challenge is loading…</p>
      </section>
    </section>
    <section aria-label="Published challenges" id="published-challenges" class="panel">
      <h2 class="section-heading">Published challenges</h2>
      <p id="challenges-list">Search to discover published challenges.</p>
    </section>
  `;

  const search = document.getElementById('search-challenges') as HTMLInputElement;
  const difficulty = document.getElementById('filter-difficulty') as HTMLSelectElement;
  const ruleset = document.getElementById('filter-ruleset') as HTMLSelectElement;

  async function runSearch(): Promise<void> {
    const button = document.getElementById('search-button') as HTMLButtonElement;
    const restore = disabledWhilePending(button);
    announceStatus('Searching harbour challenges…');
    try {
      const params = new URLSearchParams();
      if (search.value.trim() !== '') params.set('q', search.value.trim());
      if (difficulty.value) params.set('difficulty', difficulty.value);
      if (ruleset.value) params.set('ruleset', ruleset.value);
      const { data } = await api<{ challenges: ChallengeShape[]; indexing: 'pending' | 'current' }>(
        'GET',
        `/api/challenges?${params.toString()}`,
      );
      const indexing = document.getElementById('discovery-indexing')!;
      indexing.textContent = data.indexing === 'pending' ? 'Discovery is indexing – published results may still be arriving.' : 'Discovery is current.';
      const list = document.getElementById('challenges-list')!;
      if (data.challenges.length === 0) {
        list.innerHTML = '<p>No published challenges match this search.</p>';
      } else {
        list.innerHTML = data.challenges
          .map(
            (challenge) => `
            <article class="challenge-card" data-digest="${challenge.digest}">
              <h3>${escapeHtml(challenge.title)}</h3>
              <p>by ${escapeHtml(challenge.creatorName)} — ${challenge.difficulty} — ${challenge.ruleset}</p>
              <p>${escapeHtml(challenge.description)}</p>
              <button class="open-challenge" data-digest="${challenge.digest}">Open challenge ${escapeHtml(challenge.title)}</button>
            </article>`,
          )
          .join('');
        list.querySelectorAll<HTMLButtonElement>('.open-challenge').forEach((button) => {
          button.addEventListener('click', () => {
            state.selectedChallengeDigest = button.dataset.digest!;
            showChallengeDetails(button.dataset.digest!);
          });
        });
      }
      announceStatus('Search complete.');
    } catch (e) {
      handleApiError(e);
    } finally {
      restore();
    }
  }

  document.getElementById('search-button')?.addEventListener('click', runSearch);
  document.getElementById('refresh-challenges')?.addEventListener('click', runSearch);
  difficulty.addEventListener('change', runSearch);
  ruleset.addEventListener('change', runSearch);

  async function showChallengeDetails(digest: string): Promise<void> {
    try {
      const { data } = await api<ChallengeShape>('GET', `/api/challenges/${digest}`);
      const details = document.createElement('section');
      details.className = 'panel challenge-details';
      details.setAttribute('aria-label', 'Selected challenge');
      details.innerHTML = `
        <h2 class="section-heading">${escapeHtml(data.title)}</h2>
        <p>by ${escapeHtml(data.creatorName)} — ${data.difficulty} — ruleset ${data.ruleset}</p>
        <p>${escapeHtml(data.description)}</p>
        <dl class="manifest-grid">
          <dt>Seed</dt><dd>${data.definition.seed}</dd>
          <dt>Waves</dt><dd>${data.definition.waves.length}</dd>
        </dl>
        <div class="challenge-actions">
          <button class="attempt-challenge">Attempt challenge</button>
          <button class="view-leaderboard">View leaderboard</button>
        </div>
      `;
      const existing = main.querySelector('.challenge-details');
      existing?.remove();
      main.appendChild(details);
      details.querySelector('.attempt-challenge')?.addEventListener('click', async () => {
        const attempt = details.querySelector('.attempt-challenge') as HTMLButtonElement;
        const restore = disabledWhilePending(attempt);
        announceStatus('Preparing the encounter…');
        try {
          const { data: ticketData } = await api<{ ticket: import('../api.js').Ticket }>('POST', '/api/runs', {
            mode: 'challenge',
            sourceId: digest,
            revision: null,
            loadout: ['wick', 'chime', 'siphon', 'wall'],
          });
          state.ticket = ticketData.ticket;
          await api('POST', `/api/runs/${ticketData.ticket.id}/start`, {});
          announceStatus('Encounter ready.');
          navigate('defence');
        } catch (e) {
          handleApiError(e);
          restore();
        }
      });
      details.querySelector('.view-leaderboard')?.addEventListener('click', () => {
        state.selectedChallengeDigest = digest;
        navigate('leaderboard');
      });
    } catch (e) {
      handleApiError(e);
    }
  }

  document.getElementById('inspect-season')?.addEventListener('click', async () => {
    const instant = (document.getElementById('season-instant') as HTMLInputElement).value.trim();
    await refreshSeasonSummary(instant === '' ? null : instant);
  });

  refreshSeasonSummary(null);
}

let seasonTimer: number | null = null;

export async function refreshSeasonSummary(explicitInstant: string | null = null): Promise<void> {
  if (explicitInstant === null) {
    if (seasonTimer !== null) {
      window.clearTimeout(seasonTimer);
    }
    // Current-time season surfaces refresh at least every 30 seconds while visible.
    seasonTimer = window.setInterval(() => {
      const dayText = document.getElementById('season-day-text');
      if (dayText) refreshSeasonSummary(null);
    }, 30000);
  }
  try {
    const query = explicitInstant ? `?at=${encodeURIComponent(explicitInstant)}` : '';
    const { data } = await api<SeasonShape>('GET', `/api/season${query}`);
    const dayText = document.getElementById('season-day-text');
    if (dayText) dayText.textContent = `Season day: ${data.seasonDay}`;
    const localText = document.getElementById('season-local-text');
    if (localText) localText.textContent = `Kathmandu local time: ${formatInstantLocal(data.localTime)}`;
    const streakText = document.getElementById('season-streak-text');
    if (streakText) {
      streakText.textContent = data.streak === null ? 'Sign in to see your streak.' : `Your season streak: ${data.streak} day${data.streak === 1 ? '' : 's'}.`;
    }
    const daily = document.getElementById('daily-challenge');
    if (daily) {
      if (data.dailyDigest) {
        daily.innerHTML = `<p>Daily challenge: ${escapeHtml(data.dailyDigest.slice(0, 16))}…</p>`;
      } else {
        daily.innerHTML = '<p>No challenge is selected for this season day.</p>';
      }
    }
    const standings = data.standings;
    if (standings && document.getElementById('season-standings') === null) {
      const region = document.createElement('section');
      region.id = 'season-standings';
      region.className = 'panel compact';
      region.innerHTML = `
        <h3 class="section-subheading">Season standings</h3>
        <table aria-label="Season standings" class="leaderboard-table">
          <thead><tr><th>Rank</th><th>Player</th><th>Breaches</th><th>Completion time</th><th>Remaining charge</th><th>Replay</th></tr></thead>
          <tbody>
            ${standings.rows
              .map(
                (row) => `<tr><td>${row.rank}</td><td>${escapeHtml(row.playerName)}</td><td>${row.breaches}</td><td>${row.completionTick}</td><td>${row.remainingCharge}</td><td></td></tr>`,
              )
              .join('')}
          </tbody>
        </table>
      `;
      document.getElementById('season-summary')?.appendChild(region);
    }
  } catch {
    // Season surfaces stay on their last confirmed snapshot.
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
