import { api } from '../api.js';
import { escapeHtml, type ShellState } from '../shell.js';
import { rackStripSvg, tallyStrokesForGrade } from '../svg.js';
import { formatLength, readStoredUnit } from '../format.js';

const VALID_PARAMS = ['species', 'grade', 'min_length_mm', 'min_clear_mm', 'lot'];

export function renderRackPage(_state: ShellState): string {
  return `
  <div class="rack-head">
    <h1 class="page-title">Rack</h1>
  </div>
  <button id="filters-open" class="filters-open">Filters</button>
  <div class="filters-inline" id="filters-inline"></div>
  <p class="live-status" id="rack-count" role="status" aria-label="Rack count"></p>
  <ul class="rack" id="rack" aria-label="Rack"></ul>
  <div id="filters-sheet"></div>
  `;
}

interface RackBoard {
  tag: string;
  species: string;
  grade: string | null;
  status: string;
  lot: { id: string; name: string };
  length_mm: number;
  width_mm: number;
  thickness_mm: number;
  board_feet: string;
  price_cents: number | null;
  defects: Array<{ kind: string; start_mm: number; end_mm: number }>;
}

export function mountRackPage(): void {
  const params = new URLSearchParams(window.location.search);
  for (const key of [...params.keys()]) {
    if (!VALID_PARAMS.includes(key)) params.delete(key);
  }

  const filtersInline = document.getElementById('filters-inline') as HTMLElement;
  const sheetHost = document.getElementById('filters-sheet') as HTMLElement;
  const rackEl = document.getElementById('rack') as HTMLElement;
  const countEl = document.getElementById('rack-count') as HTMLElement;
  const unit = readStoredUnit();

  let species: string[] = [];
  let grades: string[] = [];
  let minLength = '';
  let minClear = '';
  let lot = '';
  let lots = [{ id: 'LOT-01', name: 'Hollis Road dairy barn' }];
  let speciesNames = ['Black walnut', 'Chestnut', 'Douglas fir', 'Heart pine', 'White oak'];
  let latestRequest = 0;
  let timer: number | undefined;

  species = params.getAll('species');
  grades = params.getAll('grade');
  minLength = params.get('min_length_mm') ?? '';
  minClear = params.get('min_clear_mm') ?? '';
  lot = params.get('lot') ?? '';

  function isIntInRange(text: string): boolean {
    if (!/^\d+$/.test(text)) return false;
    const value = Number(text);
    return Number.isInteger(value) && value >= 0 && value <= 12000;
  }

  if (minLength !== '' && !isIntInRange(minLength)) minLength = '';
  if (minClear !== '' && !isIntInRange(minClear)) minClear = '';

  function controlsHtml(): string {
    return `
      <fieldset class="field" style="border:none;padding:0;margin:0 0 6px">
        <legend style="font-size:0.8rem;color:var(--ink-soft)">Species</legend>
        <div role="group" aria-label="Species">
          ${speciesNames.map((name) => `<label style="display:inline-flex;align-items:center;gap:5px;margin-right:12px;min-height:44px"><input type="checkbox" data-filter="species" value="${escapeHtml(name)}"${species.includes(name) ? ' checked' : ''}>${escapeHtml(name)}</label>`).join('')}
        </div>
      </fieldset>
      <fieldset class="field" style="border:none;padding:0;margin:0 0 6px">
        <legend style="font-size:0.8rem;color:var(--ink-soft)">Grade</legend>
        <div role="group" aria-label="Grade">
          ${['Select', 'Character', 'Rustic'].map((grade) => `<label style="display:inline-flex;align-items:center;gap:5px;margin-right:12px;min-height:44px"><input type="checkbox" data-filter="grade" value="${grade}"${grades.includes(grade) ? ' checked' : ''}>${grade}</label>`).join('')}
        </div>
      </fieldset>
      <div class="field"><label for="f-lot">Salvage lot</label>
        <select id="f-lot" aria-label="Salvage lot">
          <option value="">All lots</option>
          ${lots.map((l) => `<option value="${l.id}"${lot === l.id ? ' selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label for="f-min-length">Minimum length (mm)</label>
        <input id="f-min-length" inputmode="numeric" value="${escapeHtml(minLength)}" aria-label="Minimum length (mm)">
      </div>
      <div class="field"><label for="f-min-clear">Minimum clear run (mm)</label>
        <input id="f-min-clear" inputmode="numeric" value="${escapeHtml(minClear)}" aria-label="Minimum clear run (mm)">
      </div>`;
  }

  function readControls(root: HTMLElement): void {
    species = [...root.querySelectorAll<HTMLInputElement>('input[data-filter="species"]:checked')].map((el) => el.value);
    grades = [...root.querySelectorAll<HTMLInputElement>('input[data-filter="grade"]:checked')].map((el) => el.value);
    const lotInput = root.querySelector<HTMLSelectElement>('#f-lot');
    const minLenInput = root.querySelector<HTMLInputElement>('#f-min-length');
    const minClearInput = root.querySelector<HTMLInputElement>('#f-min-clear');
    lot = lotInput?.value ?? '';
    minLength = minLenInput?.value ?? '';
    minClear = minClearInput?.value ?? '';
  }

  function wireControls(root: HTMLElement): void {
    for (const input of root.querySelectorAll<HTMLInputElement>('input, select')) {
      input.addEventListener('input', () => {
        readControls(root);
        applyFilters();
      });
    }
  }

  function updateAddress(): void {
    const query = new URLSearchParams();
    for (const name of species) query.append('species', name);
    for (const name of grades) query.append('grade', name);
    if (minLength !== '' && isIntInRange(minLength)) query.set('min_length_mm', minLength);
    if (minClear !== '' && isIntInRange(minClear)) query.set('min_clear_mm', minClear);
    if (lot !== '') query.set('lot', lot);
    const url = `${window.location.pathname}${query.size > 0 ? `?${query.toString()}` : ''}`;
    window.history.replaceState(null, '', url);
  }

  function applyFilters(): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      updateAddress();
      void refresh();
    }, 100);
  }

  async function refresh(): Promise<void> {
    const query = new URLSearchParams();
    for (const name of species) query.append('species', name);
    for (const name of grades) query.append('grade', name);
    if (minLength !== '' && isIntInRange(minLength)) query.set('min_length_mm', minLength);
    if (minClear !== '' && isIntInRange(minClear)) query.set('min_clear_mm', minClear);
    if (lot !== '') query.set('lot', lot);
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    const request = ++latestRequest;
    try {
      const result = await api.boards(suffix);
      if (request !== latestRequest) return;
      renderBoards(result.count, result.boards);
    } catch {
      if (request !== latestRequest) return;
      countEl.textContent = 'Something went wrong. Try again.';
    }
  }

  function renderBoards(total: number, boards: RackBoard[]): void {
    countEl.textContent = total === 0 ? 'No boards match these filters' : total === 1 ? '1 board on the rack' : `${total} boards on the rack`;
    const widest = Math.max(1, ...boards.map((b) => b.length_mm));
    const stripWidth = 640;
    rackEl.innerHTML = boards.map((board) => {
      const drawnWidth = (board.length_mm / widest) * stripWidth;
      const strip = rackStripSvg(board.tag, board.length_mm, board.defects, tallyStrokesForGrade(board.grade), drawnWidth, 34);
      return `<li>
        <div class="rack-row">
          <div>${strip}</div>
          <div class="rack-text">
            <span class="tag"><a href="/boards/${encodeURIComponent(board.tag)}">${escapeHtml(board.tag)}</a></span>
            ${board.status === 'held' ? ' <span class="badge held">Held</span>' : ''}
            <div>${escapeHtml(board.species)} · ${escapeHtml(board.lot.name)}</div>
            <div class="dims">${formatLength(board.length_mm, unit)} × ${formatLength(board.width_mm, unit)} × ${formatLength(board.thickness_mm, unit)}</div>
            <div class="figures">${board.board_feet} bd ft${board.price_cents !== null ? ` · $${(board.price_cents / 100).toFixed(2)}` : ''}</div>
          </div>
        </div>
      </li>`;
    }).join('');
  }

  const openButton = document.getElementById('filters-open');
  if (openButton) {
    openButton.addEventListener('click', () => {
      renderSheet(controlsHtml());
    });
  }

  function renderSheet(body: string): void {
    sheetHost.innerHTML = `<div class="sheet-backdrop" id="filters-backdrop"></div>
      <div class="sheet" role="dialog" aria-label="Filters" aria-modal="true">
        <h2>Filters</h2>
        <div class="sheet-body">${body}</div>
        <div class="sheet-actions"><button id="filters-done">Done</button></div>
      </div>`;
    const sheet = sheetHost.querySelector('.sheet') as HTMLElement;
    wireControls(sheet);
    sheetHost.querySelector('#filters-backdrop')?.addEventListener('click', closeSheet);
    sheetHost.querySelector('#filters-done')?.addEventListener('click', closeSheet);
    sheet.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSheet();
        return;
      }
      if (event.key !== 'Tab') return;
      trapFocus(sheet, event);
    });
    const first = sheet.querySelector<HTMLElement>('input, select, button');
    first?.focus();
  }

  function closeSheet(): void {
    sheetHost.innerHTML = '';
    document.getElementById('filters-open')?.focus();
  }

  void api.lots().then((result) => {
    lots = result.lots;
    speciesNames = [...speciesNames].sort();
    buildInline();
    void refresh();
  });

  function buildInline(): void {
    filtersInline.innerHTML = controlsHtml();
    wireControls(filtersInline);
  }
  buildInline();
  void refresh();
}

export function trapFocus(sheet: HTMLElement, event: KeyboardEvent): void {
  const focusables = [...sheet.querySelectorAll<HTMLElement>('input, select, button, [href]')];
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === sheet)) {
    event.preventDefault();
    first.focus();
  }
}
