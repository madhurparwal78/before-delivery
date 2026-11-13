// Leaderboard view: ordinary standings, personal best, completions, crew usage.
import { state, navigate, announceStatus, handleApiError, disabledWhilePending } from '../app.js';
import { api } from '../api.js';
import type { BoardShape } from '../api.js';
import { formatMilliCharge, formatTicks, formatTenthsPercent } from '../format.js';

export function renderLeaderboard(main: HTMLElement): void {
  const digest = state.selectedChallengeDigest;
  main.innerHTML = `
    <h1>Leaderboard</h1>
    ${
      digest
        ? `<p class="leaderboard-context">Standings for challenge ${escapeHtml(digest.slice(0, 16))}…</p>`
        : '<p>Select a challenge from Community to view its leaderboard.</p>'
    }
    <button id="refresh-leaderboard" class="secondary"${digest ? '' : ' disabled'}>Refresh leaderboard</button>
    <section aria-label="Leaderboard scroll area" class="leaderboard-scroll panel" id="leaderboard-scroll" tabindex="0" role="region">
      <table aria-label="Verified leaderboard" class="leaderboard-table" id="leaderboard-table">
        <thead><tr><th>Rank</th><th>Player</th><th>Breaches</th><th>Completion time</th><th>Remaining charge</th><th>Replay</th></tr></thead>
        <tbody id="leaderboard-body"><tr><td colspan="6">Loading harbour records…</td></tr></tbody>
      </table>
    </section>
    <section aria-label="Personal best" id="personal-best" class="panel compact">
      <h2 class="section-heading">Personal best</h2>
      <p id="personal-best-text">Loading…</p>
    </section>
    <section aria-label="Challenge completions" id="challenge-completions" class="panel compact">
      <h2 class="section-heading">Challenge completions</h2>
      <p id="completions-text">Loading…</p>
    </section>
    <section aria-label="Crew usage" class="panel compact">
      <h2 class="section-heading">Crew usage</h2>
      <table aria-label="Crew usage" class="usage-table" id="crew-usage">
        <thead><tr><th>Crew</th><th>Deployments</th><th>Usage</th></tr></thead>
        <tbody id="usage-body"></tbody>
      </table>
    </section>
  `;
  const scroll = document.getElementById('leaderboard-scroll') as HTMLElement;
  // Keyboard scrolling in this region moves the table without moving the page.
  scroll.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      scroll.scrollLeft += event.key === 'ArrowLeft' ? -60 : 60;
    }
  });
  if (digest) {
    loadBoard(digest);
  } else {
    const body = document.getElementById('leaderboard-body')!;
    body.innerHTML = '<tr><td colspan="6">No challenge selected.</td></tr>';
  }
  document.getElementById('refresh-leaderboard')?.addEventListener('click', () => {
    if (digest) loadBoard(digest);
  });

  async function loadBoard(challengeDigest: string): Promise<void> {
    const button = document.getElementById('refresh-leaderboard') as HTMLButtonElement;
    const restore = disabledWhilePending(button);
    announceStatus('Loading harbour records…');
    try {
      const { data } = await api<BoardShape>('GET', `/api/challenges/${challengeDigest}/leaderboard`);
      const body = document.getElementById('leaderboard-body')!;
      if (data.rows.length === 0) {
        body.innerHTML = '<tr><td colspan="6">No verified results yet.</td></tr>';
      } else {
        body.innerHTML = data.rows
          .map(
            (row) => `
            <tr>
              <td>${row.rank}</td>
              <td>${escapeHtml(row.playerName)}</td>
              <td>${row.breaches}</td>
              <td>${formatTicks(row.completionTick)}</td>
              <td>${formatMilliCharge(row.remainingCharge)}</td>
              <td><button class="watch-replay" data-run="${row.runId}" aria-label="Watch replay ${escapeAttr(row.runId)}">Watch replay</button></td>
            </tr>`,
          )
          .join('');
        body.querySelectorAll<HTMLButtonElement>('.watch-replay').forEach((button) => {
          button.addEventListener('click', () => {
            state.selectedChallengeDigest = challengeDigest;
            replayRunId = button.dataset.run!;
            navigate('replay');
          });
        });
      }
      const personalBest = document.getElementById('personal-best-text')!;
      if (data.personalBest) {
        personalBest.textContent = `Rank ${data.personalBest.rank} — ${data.personalBest.breaches} breaches — ${formatTicks(data.personalBest.completionTick)} — ${formatMilliCharge(data.personalBest.remainingCharge)} remaining.`;
      } else {
        personalBest.textContent = state.account ? 'No verified attempt yet.' : 'Sign in to see your personal best.';
      }
      document.getElementById('completions-text')!.textContent = `${data.completions} distinct winning account${data.completions === 1 ? '' : 's'}.`;
      const usageBody = document.getElementById('usage-body')!;
      usageBody.innerHTML = data.crewUsage
        .map((usage) => `<tr><td>${usage.device}</td><td>${usage.deployments}</td><td>${formatTenthsPercent(usage.tenthsPercent)}</td></tr>`)
        .join('');
      announceStatus('Harbour records loaded.');
    } catch (e) {
      handleApiError(e);
    } finally {
      restore();
    }
  }
}

export let replayRunId: string | null = null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
