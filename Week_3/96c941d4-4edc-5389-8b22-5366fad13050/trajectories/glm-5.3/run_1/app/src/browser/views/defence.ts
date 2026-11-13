// Defence view: harbour chart, charge account, planning dialog with Lantern Cast.
import { state, navigate, announceStatus, handleApiError, disabledWhilePending, clearError } from '../app.js';
import { api } from '../api.js';
import type { Ticket } from '../api.js';
import { Simulation, Command, Frame, SimEvent } from '../../shared/sim.js';
import { forecast } from '../../shared/run.js';
import { DEVICES, LIMITS, deviceById } from '../../shared/seed.js';
import type { Definition as SimDefinition } from '../../shared/seed.js';
import { formatMilliCharge, formatTicks } from '../format.js';

export interface DefenceRuntime {
  ticket: Ticket;
  definition: SimDefinition;
  sim: Simulation;
  commands: Command[];
  nextSeq: number;
  paused: boolean;
  pausedBeforePlan: boolean;
  speed: 1 | 2;
  selectedDevice: string | null;
  selectedLane: number;
  selectedCell: number;
  focusedLane: number;
  focusedCell: number;
  proposal: Command | null;
  planOpen: boolean;
  placementOpen: boolean;
  previewReady: boolean;
  previewData: { proposalBranch: Frame[]; baselineBranch: Frame[] } | null;
  leaveOpen: boolean;
  lastReason: string | null;
  finished: boolean;
  endTick: number;
  timer: number | null;
  lastTickTime: number | null;
}

export let defenceRuntime: DefenceRuntime | null = null;

export function renderDefence(main: HTMLElement): void {
  const ticket = state.ticket;
  if (!ticket) {
    main.innerHTML = '<h1>Defence</h1><p>No encounter is active. Choose an encounter from the Campaign.</p><button id="back-campaign">Return to campaign</button>';
    document.getElementById('back-campaign')?.addEventListener('click', () => navigate('campaign'));
    return;
  }
  if (!defenceRuntime || defenceRuntime.ticket.id !== ticket.id) {
    const definition = definitionForTicket(ticket);
    if (!definition) {
      // Fetch the authoritative definition for this ticket's source, then render.
      fetchDefinitionForTicket(ticket).then((fetched) => {
        setTicketDefinition(ticket.id, fetched);
        renderDefence(main);
      }).catch(() => {
        main.innerHTML = '<h1>Defence</h1><p>The encounter definition is unavailable. Try starting the defence again.</p><button id="back-campaign">Return to campaign</button>';
        document.getElementById('back-campaign')?.addEventListener('click', () => navigate('campaign'));
      });
      return;
    }
    defenceRuntime = {
      ticket,
      definition,
      sim: new Simulation(definition, ticket.loadout as import('../../shared/seed.js').DeviceId[], ticket.initialReserve, ticket.initialHealth, ticket.seed),
      commands: [],
      nextSeq: 1,
      paused: false,
      pausedBeforePlan: false,
      speed: 1,
      selectedDevice: ticket.loadout[0] ?? null,
      selectedLane: 3,
      selectedCell: 5,
      focusedLane: 3,
      focusedCell: 5,
      proposal: null,
      planOpen: false,
      placementOpen: false,
      previewReady: false,
      previewData: null,
      leaveOpen: false,
      lastReason: null,
      finished: false,
      endTick: 0,
      timer: null,
      lastTickTime: null,
    };
  }
  const rt = defenceRuntime;
  main.innerHTML = `
    <h1>Defence</h1>
    <div class="defence-layout">
      <section aria-label="Defence" class="defence-region panel" id="defence-region">
        <div class="defence-header">
          <p class="run-title">${escapeHtml(rt.definition.title)} — seed ${rt.definition.seed}</p>
          <p class="game-time" id="game-time">Game time ${formatTicks(rt.sim.tick)}</p>
        </div>
        <div class="chart-frame" id="chart-frame">
          <div class="chart-canvas" id="chart-canvas">
            <div role="grid" aria-label="Harbour chart" id="harbour-chart" class="harbour-chart">
              ${chartRows(rt)}
            </div>
          </div>
        </div>
        <div class="chart-navigation" role="group" aria-label="Chart navigation">
          <button id="pan-left" aria-label="Pan left">Pan left</button>
          <button id="pan-right" aria-label="Pan right">Pan right</button>
          <button id="pan-up" aria-label="Pan up">Pan up</button>
          <button id="pan-down" aria-label="Pan down">Pan down</button>
          <button id="zoom-in" aria-label="Zoom in">Zoom in</button>
          <button id="zoom-out" aria-label="Zoom out">Zoom out</button>
        </div>
        <section aria-label="Selected cell" id="selected-cell" class="selected-cell">
          <p>Lane ${rt.selectedLane}, cell ${rt.selectedCell} — ${cellSummary(rt, rt.selectedLane, rt.selectedCell)}</p>
        </section>
      </section>
      <aside class="defence-manifest" aria-label="Run manifest">
        <section aria-label="Charge account" id="charge-account" class="panel compact">
          <h2 class="section-heading">Charge account</h2>
          <dl class="charge-grid">
            <dt>Reserve</dt><dd id="charge-reserve">${formatMilliCharge(rt.sim.reserve)}</dd>
            <dt>Installed</dt><dd id="charge-installed">${formatMilliCharge(installedTotal(rt))}</dd>
            <dt>Source</dt><dd id="charge-source">${formatMilliCharge(rt.sim.source)}</dd>
            <dt>Sink</dt><dd id="charge-sink">${formatMilliCharge(rt.sim.sink)}</dd>
          </dl>
        </section>
        <section aria-label="Combat readout" id="combat-readout" class="panel compact">
          <h2 class="section-heading">Combat</h2>
          <p>Health <span id="health-readout">${rt.sim.health}</span> — Breaches <span id="breach-readout">${rt.sim.breaches}</span> — Creatures <span id="creature-readout">${rt.sim.creatureList().length}</span></p>
        </section>
        <section aria-label="Crew rack" class="panel compact crew-rack" id="crew-rack">
          <h2 class="section-heading">Crew</h2>
          <div class="crew-buttons" role="group" aria-label="In-run crew selection">
            ${ticket.loadout.map((device) => `<button class="crew-device" data-device="${device}" aria-label="${deviceById(device)?.name ?? device}">${deviceById(device)?.name ?? device}</button>`).join('')}
          </div>
        </section>
        <section aria-label="Defence controls" class="panel compact defence-toolbar" role="toolbar" aria-label="Defence controls">
          <button id="plan-btn">Plan</button>
          <button id="pause-btn">${rt.paused ? 'Resume' : 'Pause'}</button>
          <label for="playback-speed">Playback speed</label>
          <select id="playback-speed" aria-label="Playback speed">
            <option value="1" selected>1x</option>
            <option value="2">2x</option>
          </select>
          <button id="leave-run-btn">Leave run</button>
        </section>
      </aside>
    </div>
  `;
  bindDefence(main, rt);
  startLoop(rt);
}

function definitionForTicket(ticket: Ticket): SimDefinition | null {
  return cachedDefinition(ticket);
}

let definitionCache: { ticketId: string; definition: SimDefinition } | null = null;

function cachedDefinition(ticket: Ticket): SimDefinition | null {
  if (definitionCache && definitionCache.ticketId === ticket.id) return definitionCache.definition;
  return null;
}

/** Fetches the ticket's authoritative definition from its source record. */
async function fetchDefinitionForTicket(ticket: Ticket): Promise<SimDefinition> {
  if (ticket.mode === 'campaign') {
    const { data } = await api<{ encounters: Array<{ id: string; definition: SimDefinition }> }>('GET', '/api/campaign');
    const encounter = data.encounters.find((e) => e.id === ticket.sourceId);
    if (!encounter) throw new Error('encounter not found');
    return encounter.definition;
  }
  if (ticket.mode === 'playtest') {
    const { data } = await api<{ definition: SimDefinition }>('GET', `/api/levels/${ticket.sourceId}`);
    return data.definition;
  }
  const { data } = await api<{ definition: SimDefinition }>('GET', `/api/challenges/${ticket.sourceId}`);
  return data.definition;
}

export function setTicketDefinition(ticketId: string, definition: SimDefinition): void {
  definitionCache = { ticketId, definition };
}

function chartRows(rt: DefenceRuntime): string {
  const lanes = [1, 2, 3, 4, 5];
  return lanes
    .map(
      (lane) => `
      <div role="row" aria-label="Lane ${lane}" class="chart-row" data-lane="${lane}">
        ${Array.from({ length: LIMITS.cellsPerLane }, (_, index) => index + 1)
          .map((cell) => {
            const install = rt.sim.installAt(lane, cell);
            const buildable = rt.definition.buildable.some((b) => b.lane === lane && b.cell === cell);
            const selected = rt.selectedLane === lane && rt.selectedCell === cell;
            const isFocus = rt.focusedLane === lane && rt.focusedCell === cell;
            const occupant = install ? `${install.device} (${install.tier})` : 'empty';
            return `<div role="gridcell" aria-label="Lane ${lane}, cell ${cell}" class="chart-cell${buildable ? ' buildable' : ' unbuildable'}${selected ? ' selected' : ''}" data-lane="${lane}" data-cell="${cell}" data-occupant="${escapeAttr(occupant)}" tabindex="${isFocus ? '0' : '-1'}"></div>`;
          })
          .join('')}
      </div>`,
    )
    .join('');
}

function cellSummary(rt: DefenceRuntime, lane: number, cell: number): string {
  const install = rt.sim.installAt(lane, cell);
  const buildable = rt.definition.buildable.some((b) => b.lane === lane && b.cell === cell);
  if (install) {
    return `${install.device} (${install.tier}), ${formatMilliCharge(install.installedCharge)} invested`;
  }
  return buildable ? 'buildable, empty' : 'not buildable';
}

function installedTotal(rt: DefenceRuntime): number {
  return rt.sim.installations().reduce((sum, install) => sum + install.installedCharge, 0);
}

// ---------- Runtime binding ----------

function bindDefence(main: HTMLElement, rt: DefenceRuntime): void {
  const region = document.getElementById('defence-region')!;
  let panX = 0;
  let panY = 0;
  let zoom = 1;

  const applyTransform = () => {
    const canvas = document.getElementById('chart-canvas');
    if (canvas) canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  };

  document.getElementById('pan-left')?.addEventListener('click', () => {
    panX += 60;
    applyTransform();
  });
  document.getElementById('pan-right')?.addEventListener('click', () => {
    panX -= 60;
    applyTransform();
  });
  document.getElementById('pan-up')?.addEventListener('click', () => {
    panY += 60;
    applyTransform();
  });
  document.getElementById('pan-down')?.addEventListener('click', () => {
    panY -= 60;
    applyTransform();
  });
  document.getElementById('zoom-in')?.addEventListener('click', () => {
    zoom = Math.min(2, zoom + 0.25);
    applyTransform();
  });
  document.getElementById('zoom-out')?.addEventListener('click', () => {
    zoom = Math.max(0.5, zoom - 0.25);
    applyTransform();
  });

  const frame = document.getElementById('chart-frame');
  frame?.addEventListener('wheel', (event) => {
    if (!(event.target as HTMLElement).closest('.chart-frame')) return;
    event.preventDefault();
    if ((event as WheelEvent).deltaY < 0) {
      zoom = Math.min(2, zoom + 0.1);
    } else {
      zoom = Math.max(0.5, zoom - 0.1);
    }
    applyTransform();
  });

  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  frame?.addEventListener('pointerdown', (event) => {
    dragging = true;
    dragStartX = event.clientX - panX;
    dragStartY = event.clientY - panY;
  });
  frame?.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    panX = event.clientX - dragStartX;
    panY = event.clientY - dragStartY;
    applyTransform();
  });
  window.addEventListener('pointerup', () => {
    dragging = false;
  });

  // Cell selection: click or tap selects; never confirms a command.
  const chart = document.getElementById('harbour-chart')!;
  chart.addEventListener('click', (event) => {
    const cell = (event.target as HTMLElement).closest('[role="gridcell"]') as HTMLElement | null;
    if (!cell) return;
    selectCell(rt, Number(cell.dataset.lane), Number(cell.dataset.cell));
  });
  chart.addEventListener('mouseover', (event) => {
    const cell = (event.target as HTMLElement).closest('[role="gridcell"]') as HTMLElement | null;
    if (!cell) return;
    const summary = cellSummary(rt, Number(cell.dataset.lane), Number(cell.dataset.cell));
    const readout = document.getElementById('selected-cell');
    if (readout) readout.querySelector('p')!.textContent = `Lane ${cell.dataset.lane}, cell ${cell.dataset.cell} — ${summary}`;
  });

  // Roving tab stop with arrows, Home and End.
  chart.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (!target.matches('[role="gridcell"]')) return;
    const lane = Number(target.dataset.lane);
    const cell = Number(target.dataset.cell);
    let nextLane = lane;
    let nextCell = cell;
    switch (event.key) {
      case 'ArrowUp':
        nextLane = Math.max(1, lane - 1);
        break;
      case 'ArrowDown':
        nextLane = Math.min(LIMITS.lanes, lane + 1);
        break;
      case 'ArrowLeft':
        nextCell = Math.max(1, cell - 1);
        break;
      case 'ArrowRight':
        nextCell = Math.min(LIMITS.cellsPerLane, cell + 1);
        break;
      case 'Home':
        nextCell = 1;
        break;
      case 'End':
        nextCell = LIMITS.cellsPerLane;
        break;
      case 'Enter':
        event.preventDefault();
        selectCell(rt, lane, cell);
        openPlanning(rt, 'cell');
        return;
      default:
        return;
    }
    event.preventDefault();
    focusCell(rt, nextLane, nextCell);
  });

  // Number keys select devices even when a nontext control has focus.
  region.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
    if (/^[1-6]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      const deviceId = DEVICES[index]?.id;
      if (deviceId && rt.ticket.loadout.includes(deviceId as never)) {
        rt.selectedDevice = deviceId;
        announceStatus(`${deviceById(deviceId)?.name ?? deviceId} selected.`);
        highlightCrew(rt);
      }
      event.preventDefault();
    }
  });

  main.querySelectorAll<HTMLButtonElement>('.crew-device').forEach((button) => {
    button.addEventListener('click', () => {
      rt.selectedDevice = button.dataset.device ?? null;
      highlightCrew(rt);
    });
  });

  const speed = document.getElementById('playback-speed') as HTMLSelectElement;
  speed.addEventListener('change', () => {
    rt.speed = speed.value === '2' ? 2 : 1;
  });

  document.getElementById('pause-btn')?.addEventListener('click', () => {
    setPaused(rt, !rt.paused);
  });

  document.getElementById('plan-btn')?.addEventListener('click', () => {
    openPlanning(rt, 'button');
  });

  document.getElementById('leave-run-btn')?.addEventListener('click', () => {
    rt.leaveOpen = true;
    renderLeaveDialog(rt);
  });

  highlightCrew(rt);
  updateReadouts(rt);
}

function selectCell(rt: DefenceRuntime, lane: number, cell: number): void {
  rt.selectedLane = lane;
  rt.selectedCell = cell;
  const readout = document.getElementById('selected-cell');
  if (readout) readout.querySelector('p')!.textContent = `Lane ${lane}, cell ${cell} — ${cellSummary(rt, lane, cell)}`;
  updateChartSelection(rt);
}

function focusCell(rt: DefenceRuntime, lane: number, cell: number): void {
  rt.focusedLane = lane;
  rt.focusedCell = cell;
  updateChartSelection(rt);
  const target = document.querySelector(`[role="gridcell"][data-lane="${lane}"][data-cell="${cell}"]`) as HTMLElement | null;
  target?.focus();
}

function updateChartSelection(rt: DefenceRuntime): void {
  document.querySelectorAll('[role="gridcell"]').forEach((element) => {
    const cell = element as HTMLElement;
    const selected = Number(cell.dataset.lane) === rt.selectedLane && Number(cell.dataset.cell) === rt.selectedCell;
    cell.classList.toggle('selected', selected);
    const isFocus = Number(cell.dataset.lane) === rt.focusedLane && Number(cell.dataset.cell) === rt.focusedCell;
    cell.tabIndex = isFocus ? 0 : -1;
  });
}

function highlightCrew(rt: DefenceRuntime): void {
  document.querySelectorAll<HTMLButtonElement>('.crew-device').forEach((button) => {
    const active = button.dataset.device === rt.selectedDevice;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function setPaused(rt: DefenceRuntime, paused: boolean): void {
  rt.paused = paused;
  const button = document.getElementById('pause-btn');
  if (button) button.textContent = paused ? 'Resume' : 'Pause';
  if (paused) {
    renderPauseDialog(rt);
  } else {
    closeDialog('paused-dialog');
  }
}

function renderPauseDialog(rt: DefenceRuntime): void {
  const overlay = dialogOverlay('paused-dialog', 'Paused', `
    <p>The defence is paused. Simulation results are unaffected by pausing.</p>
  `);
  overlay.querySelector('button[data-action="resume"]')?.addEventListener('click', () => setPaused(rt, false));
  overlay.querySelector('button[data-action="leave"]')?.addEventListener('click', () => {
    closeDialog('paused-dialog');
    rt.leaveOpen = true;
    renderLeaveDialog(rt);
  });
}

function renderLeaveDialog(rt: DefenceRuntime): void {
  if (rt.timer !== null) {
    window.clearInterval(rt.timer);
    rt.timer = null;
  }
  const overlay = dialogOverlay('leave-dialog', 'Leave run', `
    <p>Leaving now discards this run. No result is submitted.</p>
  `);
  overlay.querySelector('button[data-action="keep"]')?.addEventListener('click', () => {
    rt.leaveOpen = false;
    closeDialog('leave-dialog');
    // Restore the Paused dialog as the Leave-run opener.
    if (rt.paused) renderPauseDialog(rt);
  });
  overlay.querySelector('button[data-action="discard"]')?.addEventListener('click', () => {
    rt.leaveOpen = false;
    closeDialog('leave-dialog');
    defenceRuntime = null;
    state.ticket = null;
    navigate('campaign');
  });
}

function dialogOverlay(id: string, label: string, body: string): HTMLElement {
  closeDialog(id);
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.id = `${id}-overlay`;
  overlay.innerHTML = `
    <div role="dialog" aria-modal="true" aria-label="${escapeAttr(label)}" id="${id}" class="dialog">
      <h2 class="section-heading">${escapeHtml(label)}</h2>
      ${body}
      <div class="dialog-actions">
        <button data-action="resume">Resume</button>
        <button data-action="leave">Leave run</button>
        <button data-action="keep">Keep playing</button>
        <button data-action="discard">Discard run</button>
      </div>
    </div>
  `;
  overlay.querySelectorAll('button').forEach((button) => {
    if (!button.textContent || button.textContent.trim() === '') button.remove();
  });
  document.body.appendChild(overlay);
  const dialog = overlay.querySelector(`#${id}`) as HTMLElement;
  trapFocus(dialog, overlay);
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      const handler = escapeHandlers.get(id);
      if (handler) handler();
      closeDialog(id);
      escapeHandlers.delete(id);
      restoreOpenerFocus();
    }
  });
  const first = dialog.querySelector('button');
  if (first instanceof HTMLButtonElement) first.focus();
  return overlay;
}

/** Per-dialog Escape handlers restore the opener state before closing a layer. */
const escapeHandlers = new Map<string, () => void>();

function dialogOverlayWithEscape(id: string, label: string, body: string, escapeHandler: () => void): HTMLElement {
  const overlay = dialogOverlay(id, label, body);
  // Register after dialogOverlay runs: its leading closeDialog clears stale entries.
  escapeHandlers.set(id, escapeHandler);
  return overlay;
}

function closeDialog(id: string): void {
  document.getElementById(`${id}-overlay`)?.remove();
  escapeHandlers.delete(id);
}

function restoreOpenerFocus(): void {
  const cell = document.querySelector(`[role="gridcell"][data-lane="${defenceRuntime?.focusedLane ?? 3}"][data-cell="${defenceRuntime?.focusedCell ?? 5}"]`) as HTMLElement | null;
  cell?.focus();
}

function trapFocus(dialog: HTMLElement, overlay: HTMLElement): void {
  overlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea')).filter((el) => !el.hasAttribute('disabled'));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

// ---------- Planning dialog with Lantern Cast ----------

function openPlanning(rt: DefenceRuntime, _origin: 'button' | 'cell'): void {
  rt.planOpen = true;
  // Planning freezes the current state; cancelling restores this paused state.
  rt.pausedBeforePlan = rt.paused;
  rt.paused = true;
  // Escape on Planning restores the preceding running or paused state, exactly
  // like Cancel in Planning.
  const restoreBeforePlan = () => {
    rt.planOpen = false;
    rt.paused = rt.pausedBeforePlan;
    const pauseButton = document.getElementById('pause-btn');
    if (pauseButton) pauseButton.textContent = rt.paused ? 'Resume' : 'Pause';
    if (rt.paused) renderPauseDialog(rt);
    rt.proposal = null;
    rt.previewReady = false;
    rt.previewData = null;
    announceStatus('Preview cancelled.');
  };
  const overlay = dialogOverlayWithEscape('planning-dialog', 'Planning', `
    <p>Planning freezes the current state. Select a device and a cell, then open Placement to preview.</p>
    <div class="planning-controls">
      <label for="plan-device">Device</label>
      <select id="plan-device">
        ${rt.ticket.loadout.map((device) => `<option value="${device}" ${rt.selectedDevice === device ? 'selected' : ''}>${deviceById(device)?.name ?? device}</option>`).join('')}
      </select>
      <label for="plan-lane">Lane</label>
      <input type="number" id="plan-lane" min="1" max="5" value="${rt.selectedLane}">
      <label for="plan-cell">Cell</label>
      <input type="number" id="plan-cell" min="1" max="9" value="${rt.selectedCell}">
      <button id="open-placement">Open placement</button>
      <button id="cancel-planning">Cancel</button>
    </div>
    <section aria-label="Lantern Cast" id="lantern-cast" class="lantern-cast" data-phase="ready">
      <p class="lantern-hint">No proposal yet. Preview compares one placement against doing nothing.</p>
    </section>
  `, restoreBeforePlan);
  const dialog = overlay.querySelector('#planning-dialog') as HTMLElement;
  dialog.querySelector('#cancel-planning')?.addEventListener('click', () => {
    restoreBeforePlan();
    closeDialog('planning-dialog');
    restoreOpenerFocus();
  });
  dialog.querySelector('#open-placement')?.addEventListener('click', () => {
    const lane = Number((dialog.querySelector('#plan-lane') as HTMLInputElement).value);
    const cell = Number((dialog.querySelector('#plan-cell') as HTMLInputElement).value);
    rt.selectedLane = lane;
    rt.selectedCell = cell;
    rt.selectedDevice = (dialog.querySelector('#plan-device') as HTMLSelectElement).value;
    rt.proposal = {
      seq: rt.nextSeq,
      tick: rt.sim.tick,
      type: 'deploy',
      lane,
      cell,
      device: rt.selectedDevice,
    };
    openPlacement(rt, lane, cell);
  });
}

function openPlacement(rt: DefenceRuntime, lane: number, cell: number): void {
  const overlay = dialogOverlay('placement-dialog', 'Placement', `
    <p>Placement for lane ${lane}, cell ${cell} with ${escapeHtml(deviceById(rt.selectedDevice ?? '')?.name ?? '')}.</p>
    <p id="placement-hint">Preview the Lantern Cast, then confirm with Place.</p>
  `);
  const dialog = overlay.querySelector('#placement-dialog') as HTMLElement;
  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  actions.innerHTML = `
    <button id="placement-preview">Preview</button>
    <button id="placement-place" disabled>Place</button>
    <button id="placement-cancel">Cancel</button>
  `;
  dialog.appendChild(actions);

  // Enter activates Preview until a valid preview exists, then Place.
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    if (event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    const previewButton = dialog.querySelector('#placement-preview') as HTMLButtonElement;
    const placeButton = dialog.querySelector('#placement-place') as HTMLButtonElement;
    if (!rt.previewReady) {
      previewButton.click();
    } else {
      placeButton.click();
    }
  });

  dialog.querySelector('#placement-preview')?.addEventListener('click', () => {
    runPreview(rt);
  });
  dialog.querySelector('#placement-cancel')?.addEventListener('click', () => {
    rt.proposal = null;
    rt.previewReady = false;
    rt.previewData = null;
    closeDialog('placement-dialog');
    announceStatus('Preview cancelled.');
    // Return focus to the selected cell inside Planning.
    const laneInput = document.querySelector('#plan-lane') as HTMLInputElement | null;
    if (laneInput) {
      laneInput.value = String(lane);
      laneInput.focus();
    }
  });
  dialog.querySelector('#placement-place')?.addEventListener('click', async () => {
    if (!rt.proposal) return;
    const placeButton = dialog.querySelector('#placement-place') as HTMLButtonElement;
    const restore = disabledWhilePending(placeButton);
    announceStatus('Checking this command…');
    clearError();
    try {
      await api('POST', `/api/runs/${rt.ticket.id}/commands/check`, {
        commands: rt.commands,
        atTick: rt.sim.tick,
        proposal: rt.proposal,
      });
      announceStatus('Command placed.');
      // Commit locally after the exact server check; a successful check closes
      // planning and resumes play.
      rt.sim.applyLegalCommand(rt.proposal);
      rt.commands.push(rt.proposal);
      rt.nextSeq++;
      rt.planOpen = false;
      rt.paused = false;
      rt.proposal = null;
      rt.previewReady = false;
      rt.previewData = null;
      const pauseButton = document.getElementById('pause-btn');
      if (pauseButton) pauseButton.textContent = 'Pause';
      closeDialog('placement-dialog');
      closeDialog('planning-dialog');
      updateReadouts(rt);
      updateChartSelection(rt);
      restoreOpenerFocus();
    } catch (e) {
      handleApiError(e);
      restore();
      // A refusal keeps the proposal and frozen state; return to the cell in Planning.
      closeDialog('placement-dialog');
      const laneInput = document.querySelector('#plan-lane') as HTMLInputElement | null;
      if (laneInput) {
        laneInput.value = String(lane);
        laneInput.focus();
      }
    }
  });
}

function runPreview(rt: DefenceRuntime): void {
  if (!rt.proposal) return;
  const result = forecast(rt.sim, rt.proposal, 100);
  rt.previewReady = true;
  rt.previewData = result;
  announceStatus('Preview ready.');
  const cast = document.querySelector('#lantern-cast') as HTMLElement | null;
  if (cast) {
    cast.dataset.phase = 'beam';
    window.setTimeout(() => {
      if (cast.dataset.phase === 'beam') cast.dataset.phase = 'contacts';
    }, 180);
    window.setTimeout(() => {
      if (cast.dataset.phase === 'contacts') cast.dataset.phase = 'ready';
    }, 180 + 260);
    const proposalEvents = result.proposalBranch.flatMap((frame) => frame.events as SimEvent[]);
    const baselineEvents = result.baselineBranch.flatMap((frame) => frame.events as SimEvent[]);
    const proposalReserve = result.proposalBranch.length > 0 ? result.proposalBranch[result.proposalBranch.length - 1].reserve : rt.sim.reserve;
    const baselineReserve = result.baselineBranch.length > 0 ? result.baselineBranch[result.baselineBranch.length - 1].reserve : rt.sim.reserve;
    cast.innerHTML = `
      <h3 class="section-subheading">Lantern Cast</h3>
      <p class="cast-summary">Proposed: ${escapeHtml(deviceById(rt.proposal.device ?? '')?.name ?? '')} at lane ${rt.proposal.lane}, cell ${rt.proposal.cell} — immediate cost ${formatMilliCharge(deviceById(rt.proposal.device ?? '')?.cost ?? 0)}.</p>
      <div class="cast-branches">
        <div class="cast-branch">
          <h4>With command</h4>
          <p>Endpoint tick ${result.proposalBranch.length > 0 ? result.proposalBranch[result.proposalBranch.length - 1].tick : rt.sim.tick} — reserve ${formatMilliCharge(proposalReserve)}</p>
        </div>
        <div class="cast-branch">
          <h4>Without command</h4>
          <p>Endpoint tick ${result.baselineBranch.length > 0 ? result.baselineBranch[result.baselineBranch.length - 1].tick : rt.sim.tick} — reserve ${formatMilliCharge(baselineReserve)}</p>
        </div>
      </div>
      <table class="forecast-table" aria-label="Forecast events">
        <thead><tr><th>Branch</th><th>Number</th><th>Tick</th><th>Cell</th><th>Target</th><th>Damage</th><th>Breach</th></tr></thead>
        <tbody>
          ${branchRows('With', proposalEvents)}${branchRows('Without', baselineEvents)}
        </tbody>
      </table>
    `;
  }
  const place = document.querySelector('#placement-place') as HTMLButtonElement | null;
  if (place) place.disabled = false;
}

function branchRows(branch: string, events: SimEvent[]): string {
  return events
    .map((event, index) => {
      const kind = event.kind;
      const tick = event.tick;
      const lane = event.lane;
      const cell = event.cell;
      const damage = kind === 'damage' ? (event as { damage: number }).damage : '';
      const target = kind === 'damage' ? (event as { targetId: number }).targetId : (event as { creatureId: number }).creatureId;
      const breach = kind === 'breach' ? 'breach' : '';
      return `<tr class="forecast-row" data-branch="${branch.toLowerCase()}"><td>${branch}</td><td>${index + 1}</td><td>${tick}</td><td>${lane},${cell}</td><td>${target}</td><td>${damage}</td><td>${breach}</td></tr>`;
    })
    .join('');
}

// ---------- Simulation loop ----------

function startLoop(rt: DefenceRuntime): void {
  if (rt.timer !== null) window.clearInterval(rt.timer);
  const tickOnce = () => {
    const mark = rt.sim.transferCount;
    const commands = rt.commands.filter((cmd) => cmd.tick === rt.sim.tick);
    for (const cmd of commands) {
      const reason = rt.sim.commandReason(cmd, null, null);
      if (reason === null) rt.sim.applyLegalCommand(cmd);
    }
    rt.sim.resolveTick(mark);
    updateReadouts(rt);
    updateChartSelection(rt);
    if (rt.sim.terminal) {
      finishRun(rt);
    }
  };
  // Presentation speed changes only how quickly ticks are displayed: one tick
  // per 50ms at 1x, two per 50ms at 2x. It never changes the simulation result.
  rt.timer = window.setInterval(() => {
    if (rt.paused || rt.planOpen || rt.finished) return;
    const perInterval = rt.speed === 2 ? 2 : 1;
    for (let i = 0; i < perInterval; i++) {
      if (rt.sim.terminal) {
        finishRun(rt);
        return;
      }
      tickOnce();
    }
  }, 50);
}

function updateReadouts(rt: DefenceRuntime): void {
  const reserve = document.getElementById('charge-reserve');
  if (reserve) reserve.textContent = formatMilliCharge(rt.sim.reserve);
  const installed = document.getElementById('charge-installed');
  if (installed) installed.textContent = formatMilliCharge(installedTotal(rt));
  const source = document.getElementById('charge-source');
  if (source) source.textContent = formatMilliCharge(rt.sim.source);
  const sink = document.getElementById('charge-sink');
  if (sink) sink.textContent = formatMilliCharge(rt.sim.sink);
  const health = document.getElementById('health-readout');
  if (health) health.textContent = String(rt.sim.health);
  const breaches = document.getElementById('breach-readout');
  if (breaches) breaches.textContent = String(rt.sim.breaches);
  const creatures = document.getElementById('creature-readout');
  if (creatures) creatures.textContent = String(rt.sim.creatureList().length);
  const time = document.getElementById('game-time');
  if (time) time.textContent = `Game time ${formatTicks(rt.sim.tick)}`;
}

function finishRun(rt: DefenceRuntime): void {
  if (rt.timer !== null) {
    window.clearInterval(rt.timer);
    rt.timer = null;
  }
  rt.finished = true;
  rt.endTick = rt.sim.tick;
  navigate('result');
}

export function currentRuntime(): DefenceRuntime | null {
  return defenceRuntime;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
