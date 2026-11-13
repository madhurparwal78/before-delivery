import { api } from '../api.js';
import { escapeHtml, type ShellState } from '../shell.js';
import { intakeStripSvg } from '../svg.js';
import { trapFocus } from './rack.js';

export function renderYardPage(state: ShellState): string {
  if (state.user === null || (state.user.role !== 'hand' && state.user.role !== 'owner')) {
    return `<div class="not-found"><h1>Not on this rack</h1><p>Check the link, or go back to the rack.</p><p><a href="/">Back to the rack</a></p></div>`;
  }
  return `
  <h1 class="page-title">Yard</h1>
  <div class="yard-grid">
    <div>
      <div class="section">
        <h2>Tag a board</h2>
        <form class="intake-form" id="intake-form">
          <div class="field"><label for="lot">Lot</label><select id="lot" aria-label="Lot"></select></div>
          <div class="field"><label for="species">Species</label>
            <select id="species" aria-label="Species">
              ${['Black walnut', 'Chestnut', 'Douglas fir', 'Heart pine', 'White oak'].map((name) => `<option value="${name}">${name}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label for="length-mm">Length (mm)</label><input id="length-mm" inputmode="numeric" autocomplete="off"></div>
          <div class="field"><label for="width-mm">Width (mm)</label><input id="width-mm" inputmode="numeric" autocomplete="off"></div>
          <div class="field"><label for="thickness-mm">Thickness (mm)</label><input id="thickness-mm" inputmode="numeric" autocomplete="off"></div>
          <div class="field"><label for="board-photos">Board photos</label><input type="file" id="board-photos" accept="image/jpeg,image/png"></div>
          <div class="field"><button type="submit" id="tag-board">Tag board</button></div>
        </form>
        <div id="intake-strip-host"></div>
        <div class="section">
          <h3>Defect zones</h3>
          <div class="intake-form" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
            <div class="field"><label for="defect-start">Defect start (mm)</label><input id="defect-start" inputmode="numeric"></div>
            <div class="field"><label for="defect-end">Defect end (mm)</label><input id="defect-end" inputmode="numeric"></div>
            <div class="field"><label for="defect-kind">Defect kind</label>
              <select id="defect-kind" aria-label="Defect kind">
                <option value="nail hole">nail hole</option>
                <option value="check">check</option>
                <option value="bolt hole">bolt hole</option>
              </select>
            </div>
            <div class="field"><button id="add-defect" style="margin-top:20px">Add defect</button></div>
          </div>
          <ul class="plain defect-list" id="defect-list" aria-label="Defect zones"></ul>
        </div>
        <p class="live-status" id="intake-status" role="status" aria-label="Intake status"></p>
      </div>
    </div>
    <div>
      <div class="section saw-queue">
        <h2>Saw queue</h2>
        <p class="live-status" id="saw-status" role="status" aria-label="Saw status"></p>
        <div id="saw-queue"></div>
      </div>
    </div>
  </div>
  <div id="yard-dialogs"></div>`;
}

export function mountYardPage(): void {
  const stripHost = document.getElementById('intake-strip-host') as HTMLElement;
  const defectList = document.getElementById('defect-list') as HTMLElement;
  const intakeStatus = document.getElementById('intake-status') as HTMLElement;
  const sawStatus = document.getElementById('saw-status') as HTMLElement;
  const sawQueue = document.getElementById('saw-queue') as HTMLElement;
  const dialogHost = document.getElementById('yard-dialogs') as HTMLElement;
  let lots: Array<{ id: string; name: string }> = [];
  let defects: Array<{ kind: string; start_mm: number; end_mm: number }> = [];
  let photosStored = true;

  void api.lots().then((result) => {
    lots = result.lots;
    const select = document.getElementById('lot') as HTMLSelectElement;
    select.innerHTML = lots.map((lot) => `<option value="${lot.id}">${escapeHtml(lot.name)}</option>`).join('');
  });

  function drawStrip(): void {
    const lengthText = (document.getElementById('length-mm') as HTMLInputElement).value.trim();
    const lengthMm = /^\d+$/.test(lengthText) ? Number(lengthText) : 0;
    if (lengthMm < 300) {
      stripHost.innerHTML = intakeStripSvg(1000, [], 640, 34).replace('class="strip-svg intake-strip"', 'class="strip-svg intake-strip" aria-hidden="true"');
      const svg = stripHost.querySelector('svg');
      if (svg) {
        svg.dataset['scale'] = '0';
        svg.querySelector('rect')?.remove();
      }
      return;
    }
    stripHost.innerHTML = intakeStripSvg(lengthMm, defects, 640, 34);
    wireStripDrag();
  }

  function wireStripDrag(): void {
    const svg = stripHost.querySelector('svg');
    if (svg === null) return;
    let dragging = false;
    let startX = 0;
    let pendingZone: { start_mm: number; end_mm: number } | null = null;
    const toMm = (clientX: number): number => {
      const rect = svg.getBoundingClientRect();
      const scale = Number(svg.dataset['scale'] ?? '1');
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const raw = ratio * (Number(svg.getAttribute('viewBox')?.split(' ')[2] ?? 640) / scale);
      return raw;
    };
    const snap = (mm: number): number => {
      const length = currentLength();
      const snapped = Math.round(mm / 10) * 10;
      if (mm % 10 === 5) return Math.max(0, Math.min(length, Math.floor(mm / 10) * 10 + 10));
      return Math.max(0, Math.min(length, snapped));
    };
    svg.addEventListener('pointerdown', (event) => {
      if (currentLength() < 300) return;
      dragging = true;
      startX = event.clientX;
      pendingZone = null;
    });
    svg.addEventListener('pointerup', (event) => {
      if (!dragging) return;
      dragging = false;
      const a = toMm(startX);
      const b = toMm(event.clientX);
      const start = snap(Math.min(a, b));
      const end = snap(Math.max(a, b));
      if (end <= start) return;
      pendingZone = { start_mm: start, end_mm: end };
      openDefectSheet(pendingZone);
    });
    svg.addEventListener('touchstart', (event) => {
      if (currentLength() >= 300) event.preventDefault();
    }, { passive: false });
  }

  function currentLength(): number {
    const text = (document.getElementById('length-mm') as HTMLInputElement).value.trim();
    return /^\d+$/.test(text) ? Number(text) : 0;
  }

  function openDefectSheet(zone: { start_mm: number; end_mm: number }): void {
    dialogHost.innerHTML = `<div class="sheet-backdrop" id="defect-backdrop"></div>
      <div class="sheet" role="dialog" aria-label="Defect kind" aria-modal="true" id="defect-sheet">
        <h2>Defect kind</h2>
        <div class="sheet-actions" style="flex-direction:column;align-items:stretch">
          <button data-kind="nail hole">Nail hole</button>
          <button data-kind="check">Check</button>
          <button data-kind="bolt hole">Bolt hole</button>
        </div>
      </div>`;
    const sheet = document.getElementById('defect-sheet') as HTMLElement;
    sheet.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSheet();
        return;
      }
      if (event.key !== 'Tab') return;
      trapFocus(sheet, event);
    });
    document.getElementById('defect-backdrop')?.addEventListener('click', closeSheet);
    for (const button of sheet.querySelectorAll<HTMLButtonElement>('[data-kind]')) {
      button.addEventListener('click', () => {
        defects.push({ kind: button.dataset['kind'] ?? 'nail hole', start_mm: zone.start_mm, end_mm: zone.end_mm });
        defects.sort((a, b) => a.start_mm - b.start_mm);
        renderDefects();
        drawStrip();
        closeSheet();
      });
    }
    sheet.querySelector<HTMLElement>('button')?.focus();
  }

  function closeSheet(): void {
    dialogHost.innerHTML = '';
  }

  function renderDefects(): void {
    defectList.innerHTML = defects.map((zone, index) => {
      return `<li>${escapeHtml(zone.kind)} ${zone.start_mm}–${zone.end_mm} mm <button data-remove="${index}" style="min-height:34px;padding:2px 8px" aria-label="Remove defect ${index + 1}">Remove</button></li>`;
    }).join('');
    for (const button of defectList.querySelectorAll<HTMLButtonElement>('[data-remove]')) {
      button.addEventListener('click', () => {
        defects.splice(Number(button.dataset['remove']), 1);
        renderDefects();
        drawStrip();
      });
    }
  }

  document.getElementById('add-defect')?.addEventListener('click', () => {
    const startText = (document.getElementById('defect-start') as HTMLInputElement).value.trim();
    const endText = (document.getElementById('defect-end') as HTMLInputElement).value.trim();
    if (!/^\d+$/.test(startText) || !/^\d+$/.test(endText)) return;
    const start = Number(startText);
    const end = Number(endText);
    if (start >= end || start < 0) return;
    defects.push({ kind: (document.getElementById('defect-kind') as HTMLSelectElement).value, start_mm: start, end_mm: end });
    defects.sort((a, b) => a.start_mm - b.start_mm);
    renderDefects();
    drawStrip();
  });

  (document.getElementById('length-mm') as HTMLInputElement).addEventListener('input', drawStrip);

  (document.getElementById('intake-form') as HTMLFormElement).addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('tag-board') as HTMLButtonElement;
    const lot = (document.getElementById('lot') as HTMLSelectElement).value;
    const species = (document.getElementById('species') as HTMLSelectElement).value;
    const lengthText = (document.getElementById('length-mm') as HTMLInputElement).value.trim();
    const widthText = (document.getElementById('width-mm') as HTMLInputElement).value.trim();
    const thicknessText = (document.getElementById('thickness-mm') as HTMLInputElement).value.trim();
    const fileInput = document.getElementById('board-photos') as HTMLInputElement;
    const file = fileInput.files?.[0] ?? null;
    button.disabled = true;
    button.textContent = 'Tagging';
    try {
      const result = await api.intake({
        lot,
        species,
        length_mm: Number(lengthText),
        width_mm: Number(widthText),
        thickness_mm: Number(thicknessText),
        defects,
      });
      const tag = result.board.tag;
      if (file) {
        try {
          await api.uploadPhoto(tag, file);
          photosStored = true;
        } catch {
          photosStored = false;
        }
      }
      announceIntake(photosStored ? `Tagged ${tag}.` : `Tagged ${tag}. Photos were not saved.`);
      defects = [];
      renderDefects();
      drawStrip();
      (document.getElementById('intake-form') as HTMLFormElement).reset();
      await refreshQueue();
    } catch (error) {
      const apiError = error as { code?: string; fields?: Record<string, string> };
      if (apiError.code === 'validation' && apiError.fields) {
        for (const field of Object.keys(apiError.fields)) {
          const input = document.getElementById(field.replace('_mm', '-mm')) as HTMLInputElement | null;
          if (input) input.setAttribute('aria-invalid', 'true');
        }
        intakeStatus.textContent = 'Check the highlighted fields.';
      } else {
        intakeStatus.textContent = 'Something went wrong. Try again.';
      }
    } finally {
      button.disabled = false;
      button.textContent = 'Tag board';
    }
  });

  async function refreshQueue(): Promise<void> {
    try {
      const result = await api.tickets();
      const queue = result.tickets.filter((ticket) => ticket.status === 'issued' || ticket.status === 'at-saw');
      queue.sort((a, b) => a.id.localeCompare(b.id));
      sawQueue.innerHTML = queue.map((ticket) => `<div class="card" data-ticket="${ticket.id}">
        <div class="row"><span class="mono">${ticket.id}</span><span class="badge">${ticket.status === 'at-saw' ? 'At saw' : 'Issued'}</span><span>Board ${ticket.board}</span></div>
        <div class="hold-actions">
          ${ticket.status === 'issued' ? `<button data-start="${ticket.id}">Start cut ${ticket.id}</button>` : ''}
          ${ticket.status === 'at-saw' ? `<button data-done="${ticket.id}">Mark ${ticket.id} done</button>` : ''}
        </div>
      </div>`).join('');
      for (const button of sawQueue.querySelectorAll<HTMLButtonElement>('[data-start]')) {
        button.addEventListener('click', () => void startCut(button.dataset['start'] ?? '', button));
      }
      for (const button of sawQueue.querySelectorAll<HTMLButtonElement>('[data-done]')) {
        button.addEventListener('click', () => void markDone(button.dataset['done'] ?? '', button));
      }
    } catch {
      // keep the queue as it was; the banner owns outage messaging
    }
  }

  function announceSaw(text: string): void {
    sawStatus.textContent = text;
  }

  function announceIntake(text: string): void {
    intakeStatus.textContent = text;
  }

  async function startCut(id: string, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    button.textContent = 'Starting';
    try {
      await api.startTicket(id);
      announceSaw(`Ticket ${id} is at the saw.`);
      await refreshQueue();
    } catch (error) {
      const apiError = error as { code?: string };
      if (apiError.code === 'ticket_state') {
        const result = await api.ticket(id).catch(() => null);
        const latest = result?.ticket.events.at(-1);
        announceSaw(result?.ticket.status === 'at-saw'
          ? `Ticket ${id} was already started by ${latest?.by.name ?? 'someone'}.`
          : `Ticket ${id} was already marked done by ${latest?.by.name ?? 'someone'}.`);
      } else {
        announceSaw('Not saved.');
      }
      await refreshQueue();
    }
  }

  async function markDone(id: string, button: HTMLButtonElement): Promise<void> {
    const ticket = await api.ticket(id).catch(() => null);
    if (ticket === null) return;
    const planned = ticket.ticket.offcut;
    if (planned !== null) {
      openMeasureDialog(id, planned.planned_mm);
      return;
    }
    button.disabled = true;
    button.textContent = 'Saving';
    try {
      await api.doneTicket(id, null);
      announceSaw(`Ticket ${id} done.`);
      await refreshQueue();
    } catch (error) {
      await handleDoneError(id, error);
    }
  }

  function openMeasureDialog(id: string, planned: number): void {
    dialogHost.innerHTML = `<div class="sheet-backdrop centre" id="measure-backdrop"></div>
      <div class="sheet-centre" role="dialog" aria-label="Re-measure offcut" aria-modal="true" id="measure-sheet">
        <h2>Re-measure offcut</h2>
        <div class="field"><label for="measured">Measured offcut (mm)</label><input id="measured" inputmode="numeric"></div>
        <div class="sheet-actions"><button id="measure-save" class="primary">Save</button></div>
      </div>`;
    const sheet = document.getElementById('measure-sheet') as HTMLElement;
    sheet.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      trapFocus(sheet, event);
    });
    document.getElementById('measure-backdrop')?.addEventListener('click', () => {
      dialogHost.innerHTML = '';
    });
    document.getElementById('measure-save')?.addEventListener('click', async () => {
      const value = (document.getElementById('measured') as HTMLInputElement).value.trim();
      if (!/^\d+$/.test(value)) return;
      const measured = Number(value);
      if (measured < 1 || measured > planned) return;
      dialogHost.innerHTML = '';
      announceSaw('Saving…');
      try {
        const result = await api.doneTicket(id, measured);
        announceSaw(result.ticket.offcut
          ? `Ticket ${id} done. Offcut ${result.ticket.offcut.tag} is ${measured} mm.`
          : `Ticket ${id} done.`);
        await refreshQueue();
      } catch (error) {
        await handleDoneError(id, error);
      }
    });
    (document.getElementById('measured') as HTMLInputElement).focus();
  }

  async function handleDoneError(id: string, error: unknown): Promise<void> {
    const apiError = error as { code?: string };
    if (apiError.code === 'ticket_state') {
      const result = await api.ticket(id).catch(() => null);
      const latest = result?.ticket.events.at(-1);
      announceSaw(result?.ticket.status === 'done'
        ? `Ticket ${id} was already marked done by ${latest?.by.name ?? 'someone'}.`
        : `Ticket ${id} was already started by ${latest?.by.name ?? 'someone'}.`);
    } else {
      announceSaw('Not saved.');
    }
    await refreshQueue();
  }

  drawStrip();
  renderDefects();
  void refreshQueue();
  window.setInterval(() => void refreshQueue(), 5000);
}
