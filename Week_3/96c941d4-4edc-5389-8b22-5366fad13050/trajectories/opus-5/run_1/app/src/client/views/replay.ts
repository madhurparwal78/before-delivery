import { deviceSpec } from '../../shared/constants.js';
import { formatCharge, formatTick } from '../../shared/format.js';
import { frameWindow } from '../../shared/simulation.js';
import type { Command, Definition, Frame, FrameEvent, Metrics, Ticket } from '../../shared/types.js';
import { api } from '../api.js';
import { HarbourChart } from '../board.js';
import { button, clear, h, region, table } from '../dom.js';
import { PENDING_COPY, SUCCESS_COPY, feedback } from '../feedback.js';
import type { BoardView, Shell } from '../shell.js';
import { boardTable } from './community.js';

const FOLLOW_INTERVAL_MS = 750;
const PUBLISH_INTERVAL_MS = 1000;
const PLAY_INTERVAL_MS = 50;

interface ReplayPayload {
  ticket: Ticket;
  definition: Definition;
  commands: Command[];
  endTick: number;
  metrics: Metrics;
}

interface SnapshotPayload {
  runId: string;
  playback: { version: number; tick: number; playing: boolean };
  frame: Frame;
  leaderboard: BoardView | null;
}

interface InspectorTarget {
  entityId: number;
  device: string;
  lane: number;
  cell: number;
}

class ReplaySession {
  readonly chart: HarbourChart;
  frames: Frame[] = [];
  cursor = 0;
  playing = false;
  sharing = false;
  following = false;
  version = 0;
  inspector: InspectorTarget | null = null;
  leaderboard: BoardView | null = null;
  private playTimer: number | null = null;
  private followTimer: number | null = null;
  private publishTimer: number | null = null;
  private readouts: (() => void)[] = [];

  constructor(
    readonly shell: Shell,
    readonly payload: ReplayPayload,
    readonly owner: boolean,
  ) {
    this.chart = new HarbourChart({
      onSelect: () => undefined,
      onActivate: (lane, cell) => this.inspect(lane, cell),
      inspector: (lane, cell) => this.inspect(lane, cell),
    });
    this.chart.setBuildable(payload.definition.buildable);
    this.frames = frameWindow(
      {
        definition: payload.definition,
        loadout: payload.ticket.loadout,
        initialReserve: payload.ticket.initialReserve,
        initialHealth: payload.ticket.initialHealth,
      },
      payload.commands,
      payload.endTick,
      0,
      payload.endTick + 1,
    );
  }

  onReadout(update: () => void): void {
    this.readouts.push(update);
    update();
  }

  resetReadouts(): void {
    this.readouts = [];
  }

  frame(): Frame {
    return this.frames[Math.min(this.cursor, this.frames.length - 1)];
  }

  events(): { tick: number; event: FrameEvent }[] {
    const out: { tick: number; event: FrameEvent }[] = [];
    for (let index = 0; index <= Math.min(this.cursor, this.frames.length - 1); index += 1) {
      for (const event of this.frames[index].events) out.push({ tick: this.frames[index].tick, event });
    }
    return out;
  }

  refresh(): void {
    this.chart.render(this.frame());
    for (const update of this.readouts) update();
  }

  play(): void {
    if (this.playTimer !== null || this.cursor >= this.frames.length - 1) return;
    this.playing = true;
    this.playTimer = window.setInterval(() => {
      this.cursor += 1;
      if (this.cursor >= this.frames.length - 1) {
        this.cursor = this.frames.length - 1;
        this.pause();
        return;
      }
      this.refresh();
    }, PLAY_INTERVAL_MS);
    this.startPublishing();
    this.refresh();
  }

  pause(): void {
    if (this.playTimer !== null) window.clearInterval(this.playTimer);
    this.playTimer = null;
    this.playing = false;
    this.stopPublishing();
    void this.publishCursor();
    this.refresh();
  }

  restart(): void {
    this.cursor = 0;
    void this.publishCursor();
    this.refresh();
  }

  private startPublishing(): void {
    if (!this.sharing || !this.playing || this.publishTimer !== null) return;
    this.publishTimer = window.setInterval(() => void this.publishCursor(), PUBLISH_INTERVAL_MS);
  }

  private stopPublishing(): void {
    if (this.publishTimer !== null) window.clearInterval(this.publishTimer);
    this.publishTimer = null;
  }

  async share(): Promise<void> {
    feedback.pending(PENDING_COPY.sharePlayback);
    try {
      await this.writePlayback(this.cursor, this.playing);
      this.sharing = true;
      this.startPublishing();
      feedback.succeed(SUCCESS_COPY.sharePlayback);
    } catch (error) {
      feedback.fail(error);
    }
    this.refresh();
  }

  private async writePlayback(tick: number, playing: boolean): Promise<void> {
    const snapshot = await api.put<{ version: number; tick: number; playing: boolean }>(
      `/api/results/${this.payload.ticket.id}/playback`,
      { expectedVersion: this.version, tick, playing: playing && tick < this.frames.length - 1 },
    );
    this.version = snapshot.version;
  }

  private async publishCursor(): Promise<void> {
    if (!this.sharing) return;
    try {
      await this.writePlayback(this.cursor, this.playing);
    } catch {
      await this.reloadPresentation();
    }
  }

  private async reloadPresentation(): Promise<void> {
    const snapshot = await api.get<SnapshotPayload>(`/api/results/${this.payload.ticket.id}/snapshot`);
    this.version = snapshot.playback.version;
  }

  async follow(): Promise<void> {
    feedback.pending(PENDING_COPY.followPlayback);
    try {
      await this.pollShared();
      this.following = true;
      this.pauseLocal();
      if (this.followTimer === null) {
        this.followTimer = window.setInterval(() => void this.pollShared(), FOLLOW_INTERVAL_MS);
      }
      feedback.succeed(SUCCESS_COPY.followPlayback);
    } catch (error) {
      feedback.fail(error);
    }
    this.refresh();
  }

  private pauseLocal(): void {
    if (this.playTimer !== null) window.clearInterval(this.playTimer);
    this.playTimer = null;
  }

  stopFollowing(): void {
    this.following = false;
    if (this.followTimer !== null) window.clearInterval(this.followTimer);
    this.followTimer = null;
    feedback.succeed(SUCCESS_COPY.stopFollowing);
    this.refresh();
  }

  private async pollShared(): Promise<void> {
    const snapshot = await api.get<SnapshotPayload>(`/api/results/${this.payload.ticket.id}/snapshot`);
    this.version = snapshot.playback.version;
    this.cursor = Math.min(snapshot.playback.tick, this.frames.length - 1);
    this.playing = snapshot.playback.playing;
    this.leaderboard = snapshot.leaderboard;
    feedback.dependencyRecovered();
    this.refresh();
  }

  inspect(lane: number, cell: number): void {
    const installed = this.frame().devices.find(
      (device) => device.lane === lane && device.cell === cell,
    );
    if (installed === undefined) return;
    this.inspector = {
      entityId: installed.id,
      device: installed.device,
      lane: installed.lane,
      cell: installed.cell,
    };
    for (const update of this.readouts) update();
  }

  closeInspector(): void {
    this.inspector = null;
    this.shell.render();
  }

  dispose(): void {
    this.pauseLocal();
    this.stopPublishing();
    if (this.followTimer !== null) window.clearInterval(this.followTimer);
    this.followTimer = null;
    this.resetReadouts();
  }
}

let session: ReplaySession | null = null;

export async function openReplay(shell: Shell, runId: string): Promise<void> {
  feedback.pending(PENDING_COPY.inspection);
  try {
    const payload = await api.get<ReplayPayload>(`/api/results/${runId}/replay`);
    const snapshot = await api.get<SnapshotPayload>(`/api/results/${runId}/snapshot`);
    session?.dispose();
    session = new ReplaySession(shell, payload, payload.ticket.accountId === shell.state.account?.id);
    session.version = snapshot.playback.version;
    session.cursor = Math.min(snapshot.playback.tick, session.frames.length - 1);
    session.leaderboard = snapshot.leaderboard;
    shell.state.replayRunId = runId;
    feedback.succeed(SUCCESS_COPY.inspection);
    shell.navigate('Replay');
  } catch (error) {
    feedback.fail(error);
  }
}

function inspectorPanel(active: ReplaySession): HTMLElement {
  const identity = h('dd', {});
  const type = h('dd', {});
  const tier = h('dd', {});
  const invested = h('dd', { class: 'numeric' });
  const firing = h('dd', { class: 'numeric' });
  const presence = h('dd', {});
  const closeButton = button('Close inspector', () => active.closeInspector());
  active.onReadout(() => {
    const target = active.inspector;
    if (target === null) {
      identity.textContent = 'none';
      type.textContent = 'none';
      tier.textContent = 'none';
      invested.textContent = 'none';
      firing.textContent = 'none';
      presence.textContent = 'No installation inspected.';
      return;
    }
    const live = active.frame().devices.find((device) => device.id === target.entityId);
    identity.textContent = `Entity ${target.entityId} at lane ${target.lane}, cell ${target.cell}`;
    type.textContent = deviceSpec(target.device).name;
    tier.textContent = live === undefined ? 'unknown' : live.tier;
    invested.textContent = live === undefined ? 'unknown' : formatCharge(live.installedCharge);
    firing.textContent =
      live === undefined || live.nextFireTick === null ? 'none' : formatTick(live.nextFireTick);
    presence.textContent =
      live === undefined ? 'Absent at the current cursor' : 'Present at the current cursor';
  });
  return region('Crew inspector', 'panel paper inspector', [
    h('h3', {}, ['Crew inspector']),
    h('dl', { class: 'manifest-list' }, [
      h('dt', {}, ['Installation identity']),
      identity,
      h('dt', {}, ['Type']),
      type,
      h('dt', {}, ['Tier']),
      tier,
      h('dt', {}, ['Invested charge']),
      invested,
      h('dt', {}, ['Next firing tick']),
      firing,
      h('dt', {}, ['Presence']),
      presence,
    ]),
    closeButton,
  ]);
}

export function renderReplay(shell: Shell): void {
  const active = session;
  if (active === null) {
    shell.main.append(
      h('div', { class: 'panel paper' }, [
        h('h2', {}, ['Replay']),
        h('p', {}, ['Choose a verified result to study its command replay.']),
        button('Return to community', () => shell.navigate('Community')),
      ]),
    );
    return;
  }
  active.resetReadouts();

  const clock = h('p', { class: 'numeric' });
  const eventsHost = h('div', { class: 'replay-events' });
  const sharedVersion = h('p', { class: 'numeric' });
  active.onReadout(() => {
    const frame = active.frame();
    clock.textContent = `Game time ${formatTick(frame.tick)} · reserve ${formatCharge(frame.reserve)} · breaches ${frame.breaches}`;
    clear(eventsHost);
    const rows = active
      .events()
      .map(({ tick, event }) => [
        formatTick(tick),
        event.kind,
        `${event.lane}·${event.cell}`,
        event.kind === 'damage' ? `creature ${event.targetId}` : `creature ${event.creatureId}`,
        event.kind === 'damage' ? String(event.damage) : '—',
      ]);
    eventsHost.append(table('Replay events', ['Tick', 'Event', 'Cell', 'Subject', 'Damage'], rows));
    sharedVersion.textContent = `Version ${active.version} · cursor ${formatTick(frame.tick)} · ${
      active.playing ? 'playing' : 'paused'
    }${active.following ? ' · following shared playback' : ''}`;
  });

  const replayRegion = region('Command replay', 'panel sea', [
    h('h2', {}, ['Command replay']),
    active.chart.element,
    active.chart.navigation,
    clock,
    h('div', { class: 'actions-row' }, [
      button('Play replay', () => active.play()),
      button('Pause replay', () => active.pause()),
      button('Restart replay', () => active.restart()),
    ]),
    h('div', { class: 'actions-row' }, [
      button('Share playback', () => void active.share()),
      button('Follow playback', () => void active.follow()),
      button('Stop following', () => active.stopFollowing()),
    ]),
    region('Shared playback', 'shared-playback', [h('h3', {}, ['Shared playback']), sharedVersion]),
    eventsHost,
  ]);

  const panels: { name: 'board' | 'manifest' | 'leaderboard' | 'actions'; node: HTMLElement }[] = [
    { name: 'board', node: replayRegion },
    { name: 'manifest', node: inspectorPanel(active) },
  ];
  if (active.leaderboard !== null) {
    panels.push({ name: 'leaderboard', node: boardTable('Verified leaderboard', active.leaderboard, shell) });
  }
  panels.push({
    name: 'actions',
    node: h('div', { class: 'panel paper' }, [
      button('Return to community', () => shell.navigate('Community')),
    ]),
  });
  shell.surface.set(panels);
  shell.main.append(shell.surface.element);
  active.refresh();
}
