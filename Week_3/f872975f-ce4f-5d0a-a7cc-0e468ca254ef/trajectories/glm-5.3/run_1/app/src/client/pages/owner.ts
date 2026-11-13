import { api } from '../api.js';
import type { BoardSummary } from '../api.js';
import { escapeHtml, type ShellState } from '../shell.js';
import { formatUtc } from '../format.js';

const SPECIES = ['Black walnut', 'Chestnut', 'Douglas fir', 'Heart pine', 'White oak'];
const GRADES = ['Select', 'Character', 'Rustic'];

export function renderOwnerPage(state: ShellState): string {
  if (state.user === null || state.user.role !== 'owner') {
    return `<div class="not-found"><h1>Not on this rack</h1><p>Check the link, or go back to the rack.</p><p><a href="/">Back to the rack</a></p></div>`;
  }
  return `
  <h1 class="page-title">Owner</h1>
  <p class="live-status" id="rate-status" role="status" aria-label="Rate status"></p>
  <div class="section">
    <h2>Grading queue</h2>
    <div id="grading-queue"></div>
  </div>
  <div class="owner-grid">
    <div class="section">
      <h2>Grade rates</h2>
      <div class="scroll-x"><table class="rate-table" id="rate-table"><thead><tr><th>Species</th>${GRADES.map((g) => `<th>${g}</th>`).join('')}</tr></thead><tbody></tbody></table></div>
      <h3>Scheduled rates</h3>
      <ul class="plain scheduled-list" id="scheduled-rates" aria-label="Scheduled rates"></ul>
    </div>
    <div class="section">
      <h2>Stock on hand</h2>
      <div class="scroll-x"><table id="stock-table" aria-label="Stock on hand"><thead><tr>
        <th>Species</th><th>Open boards</th><th>On rack</th><th>Held</th><th class="mono">Volume (mm³)</th><th>Board feet</th>
      </tr></thead><tbody></tbody></table></div>
    </div>
  </div>`;
}

export function mountOwnerPage(): void {
  const rateStatus = document.getElementById('rate-status') as HTMLElement;

  async function refreshQueue(): Promise<void> {
    const result = await api.boards('?status=tagged&status=graded').catch(() => ({ boards: [] as BoardSummary[] }));
    const queue = result.boards;
    const host = document.getElementById('grading-queue') as HTMLElement;
    host.innerHTML = queue.length === 0 ? '<p class="live-status">Nothing waiting for grading.</p>' : queue.map((board) => `
      <div class="card" data-tag="${board.tag}">
        <div class="row"><span class="mono">${board.tag}</span><span>${escapeHtml(board.species)}</span><span class="badge">${board.grade === null ? 'Tagged' : 'Graded'}</span></div>
        <div class="row">
          <span class="thumb-slot" data-thumb="${board.tag}"></span>
          <select aria-label="Grade for ${board.tag}" data-grade="${board.tag}">
            <option value="">Grade…</option>
            ${GRADES.map((grade) => `<option value="${grade}"${board.grade === grade ? ' selected' : ''}>${grade}</option>`).join('')}
          </select>
          <button data-save-grade="${board.tag}">Save grade for ${board.tag}</button>
          <button data-list="${board.tag}">List ${board.tag} on the rack</button>
        </div>
      </div>`).join('');
    for (const slot of host.querySelectorAll<HTMLElement>('[data-thumb]')) {
      const tag = slot.dataset['thumb'] ?? '';
      void api.board(tag).then((detail) => {
        const first = detail.board.photos[0];
        if (first !== undefined) {
          slot.innerHTML = `<img alt="Thumbnail of ${tag}" src="${first.thumb_url}" style="height:64px;border:1px solid var(--rule)">`;
        }
      }).catch(() => undefined);
    }
    // The queue host handles actions by delegation, so periodic re-renders are safe.
    host.onclick = async (event) => {
      const target = event.target as HTMLElement;
      const saveButton = target.closest<HTMLButtonElement>('[data-save-grade]');
      if (saveButton) {
        const tag = saveButton.dataset['saveGrade'] ?? '';
        const select = host.querySelector<HTMLSelectElement>(`[data-grade="${tag}"]`);
        const grade = select?.value ?? '';
        if (grade === '') return;
        saveButton.disabled = true;
        try {
          await api.grade(tag, grade);
          rateStatus.textContent = 'Saved.';
          await Promise.all([refreshQueue(), refreshStock()]);
        } catch {
          rateStatus.textContent = 'Not saved.';
        }
        return;
      }
      const listButton = target.closest<HTMLButtonElement>('[data-list]');
      if (listButton) {
        const tag = listButton.dataset['list'] ?? '';
        listButton.disabled = true;
        try {
          await api.listBoard(tag);
          rateStatus.textContent = 'Saved.';
          await Promise.all([refreshQueue(), refreshStock()]);
        } catch {
          rateStatus.textContent = 'Not saved.';
        }
      }
    };
  }

  async function refreshRates(): Promise<void> {
    const result = await api.rates().catch(() => ({ rates: [], scheduled: [] }));
    const body = document.querySelector('#rate-table tbody') as HTMLElement;
    body.innerHTML = SPECIES.map((species) => {
      const rate = (grade: string) => result.rates.find((r) => r.species === species && r.grade === grade);
      return `<tr><th>${species}</th>${GRADES.map((grade) => {
        const current = rate(grade);
        return `<td>
          <div class="field"><label class="sr-only" for="rate-${slug(species)}-${slug(grade)}">Rate for ${species} ${grade}</label>
            <input id="rate-${slug(species)}-${slug(grade)}" data-rate="${species}|${grade}" inputmode="numeric" value="${current?.rate_cents ?? ''}" aria-label="Rate for ${species} ${grade}"></div>
          <div class="field"><label class="sr-only" for="eff-${slug(species)}-${slug(grade)}">Effective from for ${species} ${grade}</label>
            <input id="eff-${slug(species)}-${slug(grade)}" data-effective="${species}|${grade}" placeholder="YYYY-MM-DD HH:MM" aria-label="Effective from for ${species} ${grade}"></div>
        </td>`;
      }).join('')}</tr>`;
    }).join('');
    for (const input of body.querySelectorAll<HTMLInputElement>('[data-rate]')) {
      input.addEventListener('keydown', async (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        await saveRate(input);
      });
    }
    const scheduled = document.getElementById('scheduled-rates') as HTMLElement;
    scheduled.innerHTML = result.scheduled.map((rate) => {
      return `<li>${escapeHtml(rate.species)} ${escapeHtml(rate.grade)} ${rate.rate_cents} ¢/bd ft from ${formatUtc(rate.effective_at)}</li>`;
    }).join('') || '<li>No scheduled rates.</li>';
  }

  async function saveRate(input: HTMLInputElement): Promise<void> {
    const [species, grade] = (input.dataset['rate'] ?? '').split('|');
    const effectiveInput = document.querySelector<HTMLInputElement>(`[data-effective="${species}|${grade}"]`);
    const effectiveText = effectiveInput?.value.trim() ?? '';
    const rateValue = input.value.trim();
    if (!/^\d+$/.test(rateValue)) {
      rateStatus.textContent = 'Not saved.';
      return;
    }
    let effectiveAt: string | undefined;
    if (effectiveText !== '') {
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(effectiveText)) {
        rateStatus.textContent = 'Not saved.';
        return;
      }
      effectiveAt = `${effectiveText.replace(' ', 'T')}:00Z`;
    }
    try {
      await api.putRate({ species, grade, rate_cents: Number(rateValue), effective_at: effectiveAt });
      rateStatus.textContent = 'Rate saved';
      await Promise.all([refreshRates(), refreshStock()]);
    } catch {
      rateStatus.textContent = 'Not saved.';
    }
  }

  async function refreshStock(): Promise<void> {
    const result = await api.stock().catch(() => null);
    if (result === null) return;
    const body = document.querySelector('#stock-table tbody') as HTMLElement;
    const rows = result.species.map((row) => `<tr>
      <th>${escapeHtml(row.species)}</th>
      <td class="mono">${row.open_boards}</td>
      <td class="mono">${row.on_rack}</td>
      <td class="mono">${row.held}</td>
      <td class="mono">${Number(row.volume_mm3).toLocaleString('en-US')}</td>
      <td class="mono">${row.board_feet}</td>
    </tr>`).join('');
    const totals = result.totals;
    body.innerHTML = `${rows}<tr>
      <th>All species</th>
      <td class="mono">${totals.open_boards}</td>
      <td class="mono">${totals.on_rack}</td>
      <td class="mono">${totals.held}</td>
      <td class="mono">${Number(totals.volume_mm3).toLocaleString('en-US')}</td>
      <td class="mono">${totals.board_feet}</td>
    </tr>`;
  }

  function slug(value: string): string {
    return value.toLowerCase().replace(/\s+/g, '-');
  }

  void refreshQueue();
  void refreshRates();
  void refreshStock();
  window.setInterval(() => void refreshStock(), 10000);
  window.setInterval(() => void refreshQueue(), 8000);
  window.setInterval(() => void refreshRates(), 8000);
}
