import {
  CELL_WIDTH,
  DEVICES,
  FORECAST_PHASES,
  INITIAL_HEALTH,
  INITIAL_RESERVE,
  LANES,
  SPAWN_POSITION,
  deviceSpec,
} from '../../shared/constants.js';
import { formatCharge, formatTick } from '../../shared/format.js';
import {
  applyCommand,
  applyCommandsPhase,
  commandRefusal,
  forecast,
  initialFrame,
  installationAt,
  resolveAfterCommands,
} from '../../shared/simulation.js';
import type { ForecastResult } from '../../shared/simulation.js';
import type {
  Command,
  Definition,
  Frame,
  FrameEvent,
  Metrics,
  SimulationConfig,
  Ticket,
} from '../../shared/types.js';
import { api, RequestFailed } from '../api.js';
import { contactMark } from '../art.js';
import { HarbourChart } from '../board.js';
import { dialogs } from '../dialogs.js';
import type { DialogHandle } from '../dialogs.js';
import { button, clear, h, region, select, svg, table } from '../dom.js';
import { PENDING_COPY, SUCCESS_COPY, feedback, rejectionCopy } from '../feedback.js';
import type { ResultView, Shell } from '../shell.js';
import { loadCampaign, loadProgress } from './campaign.js';
import { openReplay } from './replay.js';

export type SessionMode = 'practice' | 'campaign' | 'playtest' | 'challenge';
type ProposalType = 'deploy' | 'upgrade' | 'salvage';

interface PlanningContext {
  frozen: Frame;
  handle: DialogHandle;
  wasRunning: boolean;
  proposalType: ProposalType;
}

interface ProposalContext {
  command: Command;
  result: ForecastResult | null;
  handle: DialogHandle;
}

const TICK_MS = { 1: 50, 2: 25 } as const;

class DefenceSession {
  readonly config: SimulationConfig;
  frame: Frame;
  staged: Frame;
  commands: Command[] = [];
  nextSeq = 1;
  running = false;
  speed: 1 | 2 = 1;
  terminal = false;
  userPaused = false;
  activeDevice: string;
  chart: HarbourChart;
  planning: PlanningContext | null = null;
  proposal: ProposalContext | null = null;
  private timer: number | null = null;
  private readouts: (() => void)[] = [];

  constructor(
    readonly shell: Shell,
    readonly mode: SessionMode,
    readonly ticket: Ticket | null,
    readonly definition: Definition,
    readonly loadout: string[],
  ) {
    this.config = {
      definition,
      loadout,
      initialReserve: ticket?.initialReserve ?? INITIAL_RESERVE,
      initialHealth: ticket?.initialHealth ?? INITIAL_HEALTH,
    };
    this.frame = initialFrame(this.config);
    this.staged = applyCommandsPhase(this.frame, []);
    this.activeDevice = loadout[0];
    this.chart = new HarbourChart({
      onSelect: () => this.onCellSelected(),
      onActivate: () => this.openPlacement(),
    });
    this.chart.setBuildable(definition.buildable);
    this.chart.select(3, definition.buildable.length > 0 ? 9 : 1, false);
    this.chart.render(this.staged);
  }

  onReadout(update: () => void): void {
    this.readouts.push(update);
    update();
  }

  resetReadouts(): void {
    this.readouts = [];
  }

  refresh(): void {
    this.chart.render(this.staged);
    for (const update of this.readouts) update();
  }

  start(): void {
    if (this.terminal || this.timer !== null) return;
    this.running = true;
    this.timer = window.setInterval(() => this.step(), TICK_MS[this.speed]);
    this.refresh();
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.refresh();
  }

  setSpeed(speed: 1 | 2): void {
    this.speed = speed;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = window.setInterval(() => this.step(), TICK_MS[speed]);
    }
    this.refresh();
  }

  private step(): void {
    this.frame = resolveAfterCommands(this.staged, this.config);
    this.staged = applyCommandsPhase(this.frame, []);
    if (this.frame.outcome !== null) {
      this.terminal = true;
      this.stop();
      this.finish();
      return;
    }
    this.refresh();
  }

  private finish(): void {
    const metrics: Metrics = {
      outcome: this.frame.outcome as Metrics['outcome'],
      breaches: this.frame.breaches,
      completionTick: this.frame.tick,
      remainingCharge: this.frame.reserve,
      health: this.frame.health,
    };
    if (this.mode === 'practice') {
      this.shell.state.tutorialComplete = true;
      feedback.succeed(SUCCESS_COPY.practice);
      this.shell.render();
      return;
    }
    this.shell.state.localMetrics = metrics;
    this.shell.state.localCommands = [...this.commands];
    this.shell.state.localEndTick = this.frame.tick;
    this.shell.state.result = null;
    this.shell.state.resultRunId = this.ticket === null ? null : this.ticket.id;
    this.shell.navigate('Result');
  }

  private onCellSelected(): void {
    if (this.proposal !== null) {
      this.proposal.handle.close();
      this.proposal = null;
    }
    this.chart.clearTraces();
    for (const update of this.readouts) update();
  }

  selectDevice(device: string): void {
    if (!this.loadout.includes(device)) return;
    this.activeDevice = device;
    if (this.planning !== null) {
      this.proposal?.handle.close();
      this.proposal = null;
      this.chart.clearTraces();
    }
    for (const update of this.readouts) update();
  }

  /** Freezes the current state and opens Planning with the chart inside it. */
  openPlanning(proposalType: ProposalType, boardHost: HTMLElement): void {
    if (this.planning !== null || this.terminal) return;
    const wasRunning = this.running;
    this.stop();
    const frozen = this.staged;
    const handle = dialogs.open(
      'Planning',
      (dialog) => [
        h('h2', {}, ['Planning']),
        h('p', { class: 'frozen-summary' }, [
          `Frozen at ${formatTick(frozen.tick)} · reserve ${formatCharge(frozen.reserve)} · ${frozen.devices.length} installed`,
        ]),
        h('p', {}, [
          'Choose a device and cell, then open Placement. Simulated time is frozen until you place or cancel.',
        ]),
        this.chart.element,
        h('div', { class: 'actions-row' }, [
          button('Cancel', () => {
            dialog.close();
          }),
        ]),
      ],
      {
        initialFocus: () => null,
        restoreFocus: () => {
          const placement = this.proposal;
          this.proposal = null;
          placement?.handle.close();
          boardHost.append(this.chart.element);
          this.chart.clearTraces();
          this.planning = null;
          if (wasRunning) this.start();
          else this.refresh();
        },
      },
    );
    this.planning = { frozen, handle, wasRunning, proposalType };
    this.chart.focusSelected();
  }

  closePlanningAfterPlacement(): void {
    const planning = this.planning;
    if (planning === null) return;
    planning.handle.close();
  }

  proposalCommand(type: ProposalType): Command {
    const selection = this.chart.selection();
    return {
      seq: this.nextSeq,
      tick: (this.planning as PlanningContext).frozen.tick,
      type,
      lane: selection.lane,
      cell: selection.cell,
      device: type === 'deploy' ? this.activeDevice : null,
    };
  }

  /** Opens the nested Placement popover for the selected cell. */
  openPlacement(): void {
    const planning = this.planning;
    if (planning === null) return;
    if (this.proposal !== null) {
      this.proposal.handle.close();
      this.proposal = null;
    }
    const command = this.proposalCommand(planning.proposalType);
    const castRegion = h('div', {
      role: 'region',
      'aria-label': 'Lantern Cast',
      class: 'lantern-cast',
      'data-phase': 'ready',
    });
    const eventsHost = h('div', { class: 'forecast-events' });
    const costLine = h('p', { class: 'numeric' }, [immediateCostText(planning.frozen, command)]);

    const previewButton = button('Preview', () => void this.runPreview(castRegion, eventsHost, placeButton));
    const placeButton = button('Place', () => void this.commitPlacement());
    placeButton.disabled = true;
    const cancelButton = button('Cancel', () => {
      const hadPreview = this.proposal?.result !== null;
      this.proposal?.handle.close();
      this.proposal = null;
      this.chart.clearTraces();
      if (hadPreview) feedback.succeed(SUCCESS_COPY.previewCancelled);
    });

    const handle = dialogs.open(
      'Placement',
      () => [
        h('h3', {}, ['Placement']),
        h('p', {}, [
          `${command.type} at lane ${command.lane}, cell ${command.cell}${command.device === null ? '' : ` with ${deviceSpec(command.device).name}`}`,
        ]),
        costLine,
        h('div', { class: 'actions-row' }, [previewButton, placeButton, cancelButton]),
        castRegion,
        eventsHost,
      ],
      {
        initialFocus: () => previewButton,
        restoreFocus: () => {
          this.chart.focusSelected();
        },
      },
    );
    handle.element.addEventListener('keydown', (event) => {
      const keyboard = event as KeyboardEvent;
      if (keyboard.key !== 'Enter') return;
      const target = keyboard.target as HTMLElement;
      if (target.tagName === 'BUTTON' || target.tagName === 'INPUT') return;
      keyboard.preventDefault();
      if (this.proposal?.result === null) previewButton.click();
      else placeButton.click();
    });
    this.proposal = { command, result: null, handle };
  }

  private async runPreview(
    castRegion: HTMLElement,
    eventsHost: HTMLElement,
    placeButton: HTMLButtonElement,
  ): Promise<void> {
    const planning = this.planning;
    const proposal = this.proposal;
    if (planning === null || proposal === null) return;
    const refusal = commandRefusal(planning.frozen, proposal.command, this.config, {
      previousSeq: null,
      previousTick: null,
    });
    if (refusal !== null) {
      feedback.localFailure(refusal);
      return;
    }
    const result = forecast(planning.frozen, this.config, proposal.command);
    proposal.result = result;
    placeButton.disabled = false;
    renderLanternCast(castRegion, eventsHost, result, proposal.command, planning.proposalType);
    if (planning.proposalType === 'deploy') {
      renderTraces(this.chart, result, proposal.command);
    }
    await revealPhases(castRegion);
    feedback.succeed(SUCCESS_COPY.previewReady);
    placeButton.focus();
  }

  private async commitPlacement(): Promise<void> {
    const planning = this.planning;
    const proposal = this.proposal;
    if (planning === null || proposal === null) return;
    const command = proposal.command;
    if (this.ticket === null) {
      this.applyConfirmed(command);
      feedback.succeed(SUCCESS_COPY.checkCommand);
      return;
    }
    feedback.pending(PENDING_COPY.checkCommand);
    try {
      await api.post(`/api/runs/${this.ticket.id}/commands/check`, {
        commands: this.commands,
        atTick: planning.frozen.tick,
        proposal: command,
      });
      this.applyConfirmed(command);
      feedback.succeed(SUCCESS_COPY.checkCommand);
    } catch (error) {
      feedback.fail(error);
      this.proposal = null;
      proposal.handle.close();
    }
  }

  private applyConfirmed(command: Command): void {
    applyCommand(this.staged, command);
    this.commands.push(command);
    this.nextSeq += 1;
    this.chart.clearTraces();
    const placement = this.proposal;
    this.proposal = null;
    placement?.handle.close();
    this.closePlanningAfterPlacement();
  }

  dispose(): void {
    this.stop();
    this.resetReadouts();
  }
}

let session: DefenceSession | null = null;

function immediateCostText(frozen: Frame, command: Command): string {
  if (command.type === 'deploy') {
    return command.device === null
      ? 'Immediate cost unavailable'
      : `Immediate cost ${formatCharge(deviceSpec(command.device).cost)}`;
  }
  const installed = installationAt(frozen, command.lane, command.cell);
  if (installed === undefined) return 'No installed device in this cell';
  if (command.type === 'upgrade') {
    return `Immediate cost ${formatCharge(deviceSpec(installed.device).upgradeCost)}`;
  }
  return `Immediate refund ${formatCharge(Math.floor(installed.installedCharge / 2))}`;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

async function revealPhases(castRegion: HTMLElement): Promise<void> {
  if (prefersReducedMotion()) {
    castRegion.setAttribute('data-phase', 'ready');
    return;
  }
  for (const phase of FORECAST_PHASES) {
    castRegion.setAttribute('data-phase', phase.phase);
    if (phase.durationMs === 0) break;
    await new Promise((resolve) => window.setTimeout(resolve, phase.durationMs));
  }
  castRegion.setAttribute('data-phase', 'ready');
}

function eventRow(branch: string, numbered: { number: number; event: FrameEvent }): (Node | string)[] {
  const event = numbered.event;
  return [
    branch,
    String(numbered.number),
    formatTick(event.tick),
    `${event.lane}·${event.cell}`,
    event.kind === 'damage' ? `creature ${event.targetId}` : `creature ${event.creatureId}`,
    event.kind === 'damage' ? String(event.damage) : '—',
    event.kind === 'breach' ? 'yes' : 'no',
  ];
}

function renderLanternCast(
  castRegion: HTMLElement,
  eventsHost: HTMLElement,
  result: ForecastResult,
  command: Command,
  proposalType: ProposalType,
): void {
  clear(castRegion);
  clear(eventsHost);
  castRegion.append(
    h('h4', {}, ['Lantern Cast']),
    h('p', { class: 'numeric' }, [
      `Immediate ${result.immediateCost < 0 ? 'refund' : 'cost'} ${formatCharge(Math.abs(result.immediateCost))}`,
    ]),
    h('dl', { class: 'paired-summary' }, [
      h('dt', {}, ['Proposed branch']),
      h('dd', { class: 'numeric' }, [
        `ends ${formatTick(result.proposed.endpointTick)} · reserve ${formatCharge(result.proposed.endpointReserve)} · ${result.proposed.events.length} contacts`,
      ]),
      h('dt', {}, ['No-command branch']),
      h('dd', { class: 'numeric' }, [
        `ends ${formatTick(result.none.endpointTick)} · reserve ${formatCharge(result.none.endpointReserve)} · ${result.none.events.length} contacts`,
      ]),
    ]),
    h('p', {}, [
      proposalType === 'deploy'
        ? `Placement silhouette at lane ${command.lane}, cell ${command.cell}.`
        : 'Cost and refund only; no deployment counterfactual traces.',
    ]),
  );
  eventsHost.append(
    table(
      'Forecast events',
      ['Branch', 'Number', 'Tick', 'Cell', 'Target', 'Damage', 'Breach'],
      [
        ...result.proposed.events.map((numbered) => eventRow('proposed', numbered)),
        ...result.none.events.map((numbered) => eventRow('no command', numbered)),
      ],
    ),
  );
}

function horizontal(position: number): number {
  return (Math.min(Math.max(position, 0), SPAWN_POSITION) / (SPAWN_POSITION + 1)) * 100;
}

function vertical(lane: number, offset: number): number {
  return ((lane - 1 + offset) / LANES) * 100;
}

function branchPolylines(branch: ForecastBranchView, offset: number): SVGElement[] {
  const paths = new Map<number, string[]>();
  for (const frame of branch.frames) {
    for (const creature of frame.creatures) {
      const point = `${horizontal(creature.position).toFixed(2)},${vertical(creature.lane, offset).toFixed(2)}`;
      const existing = paths.get(creature.id);
      if (existing === undefined) paths.set(creature.id, [point]);
      else existing.push(point);
    }
  }
  return [...paths.values()]
    .filter((points) => points.length > 1)
    .map((points) =>
      svg('polyline', { points: points.join(' '), class: `trace trace-${branch.label}` }),
    );
}

type ForecastBranchView = ForecastResult['proposed'];

/** Draws both forecast branches, the placement silhouette and numbered contacts over the pier. */
function renderTraces(chart: HarbourChart, result: ForecastResult, command: Command): void {
  const layer = chart.traceLayer();
  clear(layer);

  const silhouette = h('div', { class: 'placement-silhouette' });
  silhouette.style.left = `${horizontal((command.cell - 1) * CELL_WIDTH)}%`;
  silhouette.style.top = `${vertical(command.lane, 0)}%`;
  silhouette.style.width = `${100 / 9}%`;
  silhouette.style.height = `${100 / LANES}%`;
  layer.append(silhouette);

  const spec = command.device === null ? null : deviceSpec(command.device);
  if (spec !== null && spec.range !== null) {
    const centre = CELL_WIDTH * command.cell - CELL_WIDTH / 2;
    const beam = h('div', { class: 'lantern-beam' });
    beam.style.left = `${horizontal(centre - spec.range)}%`;
    beam.style.width = `${horizontal(centre + spec.range) - horizontal(centre - spec.range)}%`;
    beam.style.top = `${vertical(command.lane, 0.3)}%`;
    beam.style.height = `${(0.4 / LANES) * 100}%`;
    layer.append(beam);
  }

  const canvas = svg('svg', {
    class: 'trace-canvas',
    viewBox: '0 0 100 100',
    preserveAspectRatio: 'none',
  });
  for (const line of branchPolylines(result.proposed, 0.36)) canvas.append(line);
  for (const line of branchPolylines(result.none, 0.64)) canvas.append(line);
  layer.append(canvas);

  for (const branch of [result.proposed, result.none]) {
    const offset = branch.label === 'proposed' ? 0.18 : 0.82;
    for (const numbered of branch.events) {
      const event = numbered.event;
      const mark = h('div', { class: `contact-host branch-${branch.label}` });
      mark.style.left = `${horizontal((event.cell - 0.5) * CELL_WIDTH)}%`;
      mark.style.top = `${vertical(event.lane, offset)}%`;
      mark.append(contactMark(event.kind, numbered.number, branch.label));
      layer.append(mark);
    }
  }
}

export function startDefenceSession(
  shell: Shell,
  ticket: Ticket | null,
  definition: Definition,
  mode: SessionMode,
): void {
  session?.dispose();
  const loadout = ticket === null ? DEVICES.map((device) => device.id) : ticket.loadout;
  session = new DefenceSession(shell, mode, ticket, definition, loadout);
  shell.state.ticket = ticket;
  shell.state.runDefinition = definition;
  shell.state.localMetrics = null;
  shell.navigate(mode === 'practice' ? 'Tutorial' : 'Defence');
}

export function activeSession(): DefenceSession | null {
  return session;
}

export function endSession(): void {
  session?.dispose();
  session = null;
}

function chargePanel(active: DefenceSession): HTMLElement {
  const reserve = h('dd', { class: 'numeric' });
  const installed = h('dd', { class: 'numeric' });
  const source = h('dd', { class: 'numeric' });
  const sink = h('dd', { class: 'numeric' });
  const clock = h('dd', { class: 'numeric' });
  const health = h('dd', { class: 'numeric' });
  const breaches = h('dd', { class: 'numeric' });
  active.onReadout(() => {
    const frame = active.staged;
    reserve.textContent = formatCharge(frame.reserve);
    installed.textContent = formatCharge(
      frame.devices.reduce((total, device) => total + device.installedCharge, 0),
    );
    source.textContent = formatCharge(frame.source);
    sink.textContent = formatCharge(frame.sink);
    clock.textContent = formatTick(frame.tick);
    health.textContent = String(frame.health);
    breaches.textContent = String(frame.breaches);
  });
  return h('div', { class: 'manifest-stack' }, [
    region('Charge account', 'panel paper manifest', [
      h('h2', {}, ['Charge account']),
      h('dl', { class: 'manifest-list' }, [
        h('dt', {}, ['Reserve']),
        reserve,
        h('dt', {}, ['Installed']),
        installed,
        h('dt', {}, ['Source']),
        source,
        h('dt', {}, ['Sink']),
        sink,
      ]),
    ]),
    h('div', { class: 'panel paper manifest' }, [
      h('h2', {}, ['Combat readouts']),
      h('dl', { class: 'manifest-list' }, [
        h('dt', {}, ['Game time']),
        clock,
        h('dt', {}, ['Harbour health']),
        health,
        h('dt', {}, ['Breaches']),
        breaches,
      ]),
    ]),
  ]);
}

function selectedCellPanel(active: DefenceSession): HTMLElement {
  const text = h('p', {});
  active.onReadout(() => {
    const selection = active.chart.selection();
    const installed = installationAt(active.staged, selection.lane, selection.cell);
    text.textContent = `Lane ${selection.lane}, cell ${selection.cell} — ${
      installed === undefined
        ? 'empty'
        : `${deviceSpec(installed.device).name} (${installed.tier}), invested ${formatCharge(installed.installedCharge)}`
    }`;
  });
  return region('Selected cell', 'panel paper selected-cell', [text]);
}

function controlsPanel(active: DefenceSession, boardHost: HTMLElement): HTMLElement {
  const toolbar = h('div', { role: 'toolbar', 'aria-label': 'Defence controls', class: 'toolbar crew-rack' });
  for (const device of DEVICES) {
    if (!active.loadout.includes(device.id)) continue;
    const deviceButton = button(device.name, () => active.selectDevice(device.id), {
      className: 'action device-button',
    });
    active.onReadout(() => {
      deviceButton.setAttribute('aria-pressed', active.activeDevice === device.id ? 'true' : 'false');
    });
    toolbar.append(deviceButton);
  }
  const planButton = button('Plan', () => active.openPlanning('deploy', boardHost));
  const pauseButton = button('Pause', () => openPause(active, boardHost));
  const upgradeButton = button('Upgrade', () => active.openPlanning('upgrade', boardHost));
  const salvageButton = button('Salvage', () => active.openPlanning('salvage', boardHost));
  const speed = select(
    'Playback speed',
    `${active.speed}x`,
    [
      { value: '1x', label: '1x' },
      { value: '2x', label: '2x' },
    ],
    (value) => active.setSpeed(value === '2x' ? 2 : 1),
  );
  toolbar.append(planButton, pauseButton, upgradeButton, salvageButton, speed.wrapper);
  return toolbar;
}

function openPause(active: DefenceSession, boardHost: HTMLElement): void {
  active.stop();
  active.userPaused = true;
  dialogs.open('Paused', (dialog) => [
    h('h2', {}, ['Paused']),
    h('p', {}, ['Presentation is paused. No simulated time passes.']),
    h('div', { class: 'actions-row' }, [
      button('Resume', () => {
        dialog.close();
        active.userPaused = false;
        active.start();
      }),
      button('Leave run', () => openLeave(active, boardHost, dialog)),
    ]),
  ]);
}

function openLeave(active: DefenceSession, boardHost: HTMLElement, paused: DialogHandle): void {
  dialogs.open('Leave run', (dialog) => [
    h('h2', {}, ['Leave run']),
    h('p', {}, ['Leaving discards this local run. No evidence is submitted.']),
    h('div', { class: 'actions-row' }, [
      button('Keep playing', () => dialog.close()),
      button('Discard run', () => {
        dialog.close();
        paused.close();
        endSession();
        clear(boardHost);
        active.shell.navigate('Campaign');
      }),
    ]),
  ]);
}

export function renderDefence(shell: Shell): void {
  const active = session;
  if (active === null) {
    shell.main.append(
      region('Defence', 'panel paper', [
        h('h2', {}, ['Defence']),
        h('p', {}, ['Choose an encounter and loadout to begin a defence.']),
        button('Return to campaign', () => shell.navigate('Campaign')),
      ]),
    );
    return;
  }
  active.resetReadouts();
  const boardHost = h('div', { class: 'chart-host' });
  const defenceRegion = region('Defence', 'panel sea defence', [
    h('h2', {}, ['Defence']),
    boardHost,
    selectedCellPanel(active),
  ]);
  if (active.planning === null) boardHost.append(active.chart.element);

  const controls = controlsPanel(active, boardHost);
  const actions = h('div', { class: 'panel paper' }, [
    active.chart.navigation,
    h('p', {}, ['Number keys select devices. Arrow keys move the chart selection; Enter opens Placement.']),
  ]);

  shell.surface.set([
    { name: 'board', node: defenceRegion },
    { name: 'manifest', node: chargePanel(active) },
    { name: 'crew', node: controls },
    { name: 'actions', node: actions },
  ]);
  shell.main.append(shell.surface.element);
  active.refresh();
  if (!active.running && !active.terminal && !active.userPaused && active.planning === null) {
    active.start();
  }
}

/** Number keys select devices in Seed data order within Defence and Planning. */
export function installShortcuts(shell: Shell): void {
  document.addEventListener('keydown', (event) => {
    const active = session;
    if (active === null) return;
    const inScope =
      shell.state.view === 'Defence' || shell.state.view === 'Tutorial' || active.planning !== null;
    if (!inScope) return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
    const index = Number(event.key) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= DEVICES.length) return;
    event.preventDefault();
    active.selectDevice(DEVICES[index].id);
  });
}

function metricsList(metrics: Metrics): HTMLElement {
  return h('dl', { class: 'manifest-list' }, [
    h('dt', {}, ['Outcome']),
    h('dd', {}, [metrics.outcome]),
    h('dt', {}, ['Breaches']),
    h('dd', { class: 'numeric' }, [String(metrics.breaches)]),
    h('dt', {}, ['Completion time']),
    h('dd', { class: 'numeric' }, [formatTick(metrics.completionTick)]),
    h('dt', {}, ['Remaining charge']),
    h('dd', { class: 'numeric' }, [formatCharge(metrics.remainingCharge)]),
    h('dt', {}, ['Harbour health']),
    h('dd', { class: 'numeric' }, [String(metrics.health)]),
  ]);
}

function announceResult(result: ResultView): void {
  if (result.state === 'accepted' && result.metrics !== null) {
    feedback.succeed(
      result.metrics.outcome === 'victory' ? SUCCESS_COPY.acceptedVictory : SUCCESS_COPY.acceptedDefeat,
    );
    return;
  }
  if (result.state === 'rejected' && result.failure !== null) {
    feedback.localFailure(
      rejectionCopy(result.failure.tick, result.failure.reason, result.failure.seq),
    );
    return;
  }
  feedback.localFailure(SUCCESS_COPY.pendingEvidence);
}

export function renderResult(shell: Shell): void {
  const runId = shell.state.resultRunId;
  const local = shell.state.localMetrics;
  const result = shell.state.result;

  const submitButton = button('Submit result', async () => {
    if (runId === null) return;
    submitButton.disabled = true;
    feedback.pending(PENDING_COPY.submit);
    try {
      const response = await api.postEnvelope<ResultView>(`/api/runs/${runId}/submit`, {
        commands: shell.state.localCommands,
        endTick: shell.state.localEndTick,
        claims: local === null ? {} : { outcome: local.outcome, breaches: local.breaches },
      });
      shell.state.result = response.body;
      announceResult(response.body);
      await refreshProgressQuietly(shell);
      shell.render();
    } catch (error) {
      feedback.fail(error);
      submitButton.disabled = false;
    }
  });
  submitButton.disabled = runId === null || result !== null;

  const retryButton = button('Retry verification', async () => {
    if (runId === null) return;
    retryButton.disabled = true;
    feedback.pending(PENDING_COPY.submit);
    try {
      const response = await api.postEnvelope<ResultView>(`/api/runs/${runId}/retry`, {});
      shell.state.result = response.body;
      announceResult(response.body);
      await refreshProgressQuietly(shell);
      shell.render();
    } catch (error) {
      feedback.fail(error);
      retryButton.disabled = false;
    }
  });
  retryButton.disabled = runId === null;

  const refreshButton = button('Refresh result', async () => {
    if (runId === null) return;
    feedback.pending(PENDING_COPY.inspection);
    try {
      const run = await api.get<{ result: ResultView | null }>(`/api/runs/${runId}`);
      shell.state.result = run.result;
      feedback.succeed(SUCCESS_COPY.inspection);
      shell.render();
    } catch (error) {
      feedback.fail(error);
    }
  });

  const resultRegion = region('Run result', 'panel paper', [
    h('h2', {}, ['Run result']),
    h('h3', {}, ['Local outcome']),
    local === null ? h('p', {}, ['No local outcome recorded.']) : metricsList(local),
    h('h3', {}, ['Authoritative verification']),
    h('p', {}, [`Verification state: ${result === null ? 'not submitted' : result.state}`]),
    result !== null && result.evidenceDigest !== null
      ? h('p', { class: 'digest' }, [`Evidence digest ${result.evidenceDigest}`])
      : null,
    result !== null && result.metrics !== null ? metricsList(result.metrics) : null,
    result !== null && result.failure !== null
      ? h('p', { class: 'failure' }, [
          `Rejected at tick ${result.failure.tick}${result.failure.seq === null ? '' : `, sequence ${result.failure.seq}`}: ${result.failure.reason}`,
        ])
      : null,
    h('div', { class: 'actions-row' }, [
      submitButton,
      retryButton,
      refreshButton,
      result !== null && result.state === 'accepted' && runId !== null
        ? button(`Watch replay ${runId}`, () => void openReplay(shell, runId), {
            label: 'Watch replay',
          })
        : null,
      button('Return to campaign', () => {
        endSession();
        shell.navigate('Campaign');
      }),
    ]),
  ]);

  const progressRegion = region('Verified progress', 'panel paper', [
    h('h2', {}, ['Verified progress']),
    h('p', {}, [
      `Completed: ${
        shell.state.progress === null || shell.state.progress.completed.length === 0
          ? 'none'
          : shell.state.progress.completed.join(', ')
      }`,
    ]),
    h('p', {}, [`Unlocked: ${shell.state.progress?.unlocked.join(', ') ?? 'none'}`]),
    button('Refresh progress', () => void loadProgress(shell)),
  ]);

  shell.surface.set([
    { name: 'board', node: resultRegion },
    { name: 'summary', node: progressRegion },
  ]);
  shell.main.append(shell.surface.element);
}

async function refreshProgressQuietly(shell: Shell): Promise<void> {
  try {
    await loadCampaign(shell, false);
  } catch (error) {
    if (!(error instanceof RequestFailed)) throw error;
  }
}
