// Replay view: reconstructed frames, local playback, shared presentation, crew inspector.
import { state, announceStatus, handleApiError, disabledWhilePending } from '../app.js';
import { api } from '../api.js';
import type { ReplayShape, SnapshotShape, FrameShape } from '../api.js';
import { Simulation } from '../../shared/sim.js';
import type { Definition as SimDefinition } from '../../shared/seed.js';
import { formatMilliCharge, formatTicks } from '../format.js';
import { replayRunId } from './leaderboard.js';

interface ReplayRuntime {
  runId: string;
  frames: FrameShape[];
  cursor: number;
  playing: boolean;
  timer: number | null;
  following: boolean;
  sharedVersion: number | null;
  inspectorEntity: number | null;
  ownerPresenter: boolean;
}

let runtime: ReplayRuntime | null = null;

export function renderReplay(main: HTMLElement): void {
  const runId = replayRunId;
  if (!runId) {
    main.innerHTML = '<h1>Replay</h1><p>Choose a verified result from a leaderboard to watch its replay.</p>';
    return;
  }
  main.innerHTML = `
    <h1>Replay</h1>
    <section aria-label="Command replay" id="command-replay" class="panel replay-region">
      <p class="replay-time" id="replay-time">Game time ${formatTicks(0)}</p>
      <div class="replay-actions">
        <button id="play-replay">Play replay</button>
        <button id="pause-replay" disabled>Pause replay</button>
        <button id="restart-replay">Restart replay</button>
        <button id="share-playback">Share playback</button>
        <button id="follow-playback">Follow playback</button>
        <button id="stop-following" disabled>Stop following</button>
      </div>
      <section aria-label="Shared playback" id="shared-playback" class="panel compact shared-playback">
        <p>Not shared yet. The owner can share a presentation for spectators.</p>
      </section>
      <div class="replay-board" id="replay-board"></div>
      <section aria-label="Crew inspector" id="crew-inspector" class="panel compact crew-inspector" hidden>
        <p id="inspector-text"></p>
        <button id="close-inspector" class="secondary">Close inspector</button>
      </section>
    </section>
  `;
  loadReplay(main, runId);
}

async function loadReplay(main: HTMLElement, runId: string): Promise<void> {
  try {
    const { data } = await api<ReplayShape>('GET', `/api/results/${runId}/replay`);
    const definition = data.definition as unknown as SimDefinition;
    const sim = new Simulation(
      definition,
      data.ticket.loadout as never,
      data.ticket.initialReserve,
      data.ticket.initialHealth,
      data.ticket.seed,
    );
    const replay = replayFrames(sim, data.commands, data.endTick);
    runtime = {
      runId,
      frames: replay,
      cursor: 0,
      playing: false,
      timer: null,
      following: false,
      sharedVersion: null,
      inspectorEntity: null,
      ownerPresenter: state.account?.id === data.ticket.accountId,
    };
    renderFrame(0);
    bindReplayControls(main);
  } catch (e) {
    handleApiError(e);
  }
}

function replayFrames(sim: Simulation, commands: Array<{ seq: number; tick: number; type: string; lane: number; cell: number; device: string | null }>, endTick: number): FrameShape[] {
  const byTick = new Map<number, typeof commands>();
  for (const cmd of commands) {
    const list = byTick.get(cmd.tick) ?? [];
    list.push(cmd);
    byTick.set(cmd.tick, list);
  }
  const frames: FrameShape[] = [sim.buildInitialFrame() as unknown as FrameShape];
  let applied = 0;
  while (!sim.terminal && sim.tick < endTick) {
    const mark = sim.transferCount;
    const tickCommands = byTick.get(sim.tick) ?? [];
    for (const cmd of tickCommands) {
      const reason = sim.commandReason(cmd as never, null, null);
      if (reason === null) {
        sim.applyLegalCommand(cmd as never);
        applied++;
      }
    }
    sim.resolveTick(mark);
    frames.push(sim.currentFrame as unknown as FrameShape);
  }
  return frames;
}

function renderFrame(index: number): void {
  const rt = runtime;
  if (!rt) return;
  rt.cursor = Math.max(0, Math.min(index, rt.frames.length - 1));
  const frame = rt.frames[rt.cursor];
  const board = document.getElementById('replay-board');
  if (board) {
    board.innerHTML = `
      <div class="replay-chart" role="grid" aria-label="Harbour chart">
        ${[1, 2, 3, 4, 5]
          .map((lane) => {
            const devices = frame.devices.filter((d) => d.lane === lane);
            const creatures = frame.creatures.filter((c) => c.lane === lane);
            return `<div role="row" aria-label="Lane ${lane}" class="replay-row">
              ${Array.from({ length: 9 }, (_, i) => i + 1)
                .map((cell) => {
                  const device = devices.find((d) => d.cell === cell);
                  const creatureHere = creatures.find((c) => Math.floor(Math.min(8999, Math.max(0, c.position)) / 1000) + 1 === cell);
                  return `<div role="gridcell" aria-label="Lane ${lane}, cell ${cell}" class="replay-cell" data-lane="${lane}" data-cell="${cell}">
                    ${device ? `<button class="inspect-crew" data-entity="${device.id}" aria-label="Inspect crew ${lane}, ${cell}">Inspect crew</button>` : ''}
                    ${creatureHere ? `<span class="replay-creature">${creatureHere.creature}</span>` : ''}
                  </div>`;
                })
                .join('')}
            </div>`;
          })
          .join('')}
      </div>
    `;
    board.querySelectorAll<HTMLButtonElement>('.inspect-crew').forEach((button) => {
      button.addEventListener('click', () => {
        const entity = Number(button.dataset.entity);
        openInspector(entity);
      });
    });
  }
  const time = document.getElementById('replay-time');
  if (time) time.textContent = `Game time ${formatTicks(frame.tick)}`;
}

function openInspector(entityId: number): void {
  const rt = runtime;
  if (!rt) return;
  rt.inspectorEntity = entityId;
  const region = document.getElementById('crew-inspector') as HTMLElement;
  region.hidden = false;
  updateInspector();
}

function updateInspector(): void {
  const rt = runtime;
  if (!rt || rt.inspectorEntity === null) return;
  const frame = rt.frames[rt.cursor];
  const device = frame.devices.find((d) => d.id === rt.inspectorEntity);
  const text = document.getElementById('inspector-text')!;
  if (device) {
    text.textContent = `Installation ${device.id} — ${device.device} — tier ${device.tier} — invested ${formatMilliCharge(device.installedCharge)} — next firing tick ${device.nextFireTick ?? 'none'} — present at this cursor.`;
  } else {
    text.textContent = `Installation ${rt.inspectorEntity} is absent at the current cursor. Its identity is retained.`;
  }
}

function bindReplayControls(_main: HTMLElement): void {
  const rt = runtime;
  if (!rt) return;
  const play = document.getElementById('play-replay') as HTMLButtonElement;
  const pause = document.getElementById('pause-replay') as HTMLButtonElement;
  const restart = document.getElementById('restart-replay') as HTMLButtonElement;
  const share = document.getElementById('share-playback') as HTMLButtonElement;
  const follow = document.getElementById('follow-playback') as HTMLButtonElement;
  const stop = document.getElementById('stop-following') as HTMLButtonElement;

  play.addEventListener('click', () => {
    if (rt.following) {
      announceStatus('Following shared playback. Local controls are paused while following.');
      return;
    }
    rt.playing = true;
    play.disabled = true;
    pause.disabled = false;
    startLocalTimer();
    if (rt.ownerPresenter) publishShared(rt, rt.cursor, true);
  });
  pause.addEventListener('click', () => {
    rt.playing = false;
    play.disabled = false;
    pause.disabled = true;
    stopTimer();
    if (rt.ownerPresenter) publishShared(rt, rt.cursor, false);
  });
  restart.addEventListener('click', () => {
    stopTimer();
    rt.playing = false;
    play.disabled = false;
    pause.disabled = true;
    renderFrame(0);
    updateInspector();
    if (rt.ownerPresenter) publishShared(rt, 0, false);
  });

  share.addEventListener('click', async () => {
    if (!rt.ownerPresenter) {
      announceStatus('Only this run owner can share playback.');
      return;
    }
    const restore = disabledWhilePending(share);
    announceStatus('Sharing playback…');
    try {
      await publishShared(rt, rt.cursor, rt.playing);
      announceStatus("Playback shared – follow the keeper's cursor.");
      await refreshShared();
    } catch (e) {
      handleApiError(e);
    } finally {
      restore();
    }
  });

  follow.addEventListener('click', async () => {
    const restore = disabledWhilePending(follow);
    announceStatus('Following playback…');
    try {
      rt.following = true;
      follow.disabled = true;
      stop.disabled = false;
      await refreshShared();
      announceStatus('Following shared playback.');
    } catch (e) {
      handleApiError(e);
      rt.following = false;
      follow.disabled = false;
      stop.disabled = true;
      restore();
    }
  });

  stop.addEventListener('click', () => {
    rt.following = false;
    follow.disabled = false;
    stop.disabled = true;
    stopSharedPolling();
    announceStatus('Local playback restored.');
  });

  document.getElementById('close-inspector')?.addEventListener('click', () => {
    const region = document.getElementById('crew-inspector') as HTMLElement;
    region.hidden = true;
    if (rt) rt.inspectorEntity = null;
  });

  function startLocalTimer(): void {
    stopTimer();
    if (!rt) return;
    rt.timer = window.setInterval(() => {
      const current = runtime;
      if (!current || !current.playing) return;
      if (current.cursor >= current.frames.length - 1) {
        current.playing = false;
        play.disabled = false;
        pause.disabled = true;
        stopTimer();
        return;
      }
      renderFrame(current.cursor + 1);
      updateInspector();
      if (current.ownerPresenter && current.cursor % 20 === 0) publishShared(current, current.cursor, true);
    }, 100);
  }

  function stopTimer(): void {
    const current = runtime;
    if (current && current.timer !== null) {
      window.clearInterval(current.timer);
      current.timer = null;
    }
  }
}

let sharedPoller: number | null = null;

async function publishShared(rt: ReplayRuntime, tick: number, playing: boolean): Promise<void> {
  const snapshot = await api<SnapshotShape>('GET', `/api/results/${rt.runId}/snapshot`);
  const version = snapshot.data.playback.version;
  await api('PUT', `/api/results/${rt.runId}/playback`, { expectedVersion: version, tick, playing });
  rt.sharedVersion = version + 1;
}

async function refreshShared(): Promise<void> {
  const rt = runtime;
  if (!rt) return;
  const { data } = await api<SnapshotShape>('GET', `/api/results/${rt.runId}/snapshot`);
  const region = document.getElementById('shared-playback')!;
  region.innerHTML = `
    <p>Version ${data.playback.version} — cursor tick ${data.playback.tick} — ${data.playback.playing ? 'playing' : 'paused'}.</p>
  `;
  if (rt.following) {
    renderFrame(data.playback.tick);
    updateInspector();
  }
  startSharedPolling();
}

function startSharedPolling(): void {
  stopSharedPolling();
  sharedPoller = window.setInterval(async () => {
    const rt = runtime;
    if (!rt || !rt.following) return;
    try {
      const { data } = await api<SnapshotShape>('GET', `/api/results/${rt.runId}/snapshot`);
      const region = document.getElementById('shared-playback');
      if (region) {
        region.innerHTML = `<p>Version ${data.playback.version} — cursor tick ${data.playback.tick} — ${data.playback.playing ? 'playing' : 'paused'}.</p>`;
      }
      renderFrame(data.playback.tick);
      updateInspector();
    } catch {
      // Followers keep their last confirmed snapshot on a background failure.
    }
  }, 1000);
}

function stopSharedPolling(): void {
  if (sharedPoller !== null) {
    window.clearInterval(sharedPoller);
    sharedPoller = null;
  }
}
