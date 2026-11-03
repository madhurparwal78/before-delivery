// The photo-finish: a playhead over every tick of a resolved round, the lane list and the 3D replay.
import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { get } from "./api.js";
import { Bean } from "./bean.js";
import { announceFailure } from "./notices.js";
import { type Motion, ReplayScene } from "./replay3d.js";
import { prefersReducedMotion } from "./ui.js";
import type { FrameView, Match, Round } from "../shared/api.js";
import { type BeanState, formatPosition, slotsLabel } from "../shared/rules.js";

const PAGE_STEP = 20;

const STATE_TEXT: Record<BeanState, string> = {
  alive: "Running", falling: "Falling", respawning: "Respawning", qualified: "Qualified", eliminated: "Out",
};

type Change = "step" | "drag" | "release";

function tickFromPointer(track: HTMLElement, clientX: number, lastTick: number): number {
  const box = track.getBoundingClientRect();
  const fraction = Math.min(1, Math.max(0, (clientX - box.left) / Math.max(1, box.width)));
  return Math.round(fraction * lastTick);
}

function Playhead({ tick, lastTick, onChange }: { tick: number; lastTick: number; onChange: (tick: number, change: Change) => void }) {
  const dragging = useRef(false);
  const keyed = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowRight: tick + 1, ArrowUp: tick + 1, ArrowLeft: tick - 1, ArrowDown: tick - 1,
      PageUp: tick + PAGE_STEP, PageDown: tick - PAGE_STEP, Home: 0, End: lastTick,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onChange(Math.min(lastTick, Math.max(0, next)), "step");
  };
  const percent = lastTick === 0 ? 0 : (tick / lastTick) * 100;
  return (
    <div class="playhead">
      <div role="slider" tabIndex={0} aria-label="Playhead" aria-valuemin={0} aria-valuemax={lastTick} aria-valuenow={tick}
        aria-valuetext={`Tick ${tick} of ${lastTick}`} class="slider" onKeyDown={keyed}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = true;
          onChange(tickFromPointer(event.currentTarget, event.clientX, lastTick), "drag");
        }}
        onPointerMove={(event) => {
          if (dragging.current) onChange(tickFromPointer(event.currentTarget, event.clientX, lastTick), "drag");
        }}
        onPointerUp={(event) => {
          if (!dragging.current) return;
          dragging.current = false;
          onChange(tickFromPointer(event.currentTarget, event.clientX, lastTick), "release");
        }}
        onPointerCancel={() => { dragging.current = false; }}>
        <span class="slider-track" aria-hidden="true"><span class="slider-fill" style={{ width: `${percent}%` }} /></span>
        <span class="slider-thumb" aria-hidden="true" style={{ left: `${percent}%` }} />
      </div>
      <p class="playhead-scale numeric" aria-hidden="true"><span>0</span><span>{lastTick}</span></p>
    </div>
  );
}

export function PhotoFinishPage({ matchId, roundNumber, initialTick }: { matchId: number; roundNumber: number; initialTick: number | null }) {
  const [round, setRound] = useState<Round | null>(null);
  const [missing, setMissing] = useState(false);
  const [tick, setTick] = useState(initialTick ?? 0);
  const [frame, setFrame] = useState<FrameView | null>(null);
  const region = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<ReplayScene | null>(null);
  const cache = useRef(new Map<number, FrameView>());
  const wanted = useRef(tick);
  const shown = useRef<number | null>(null);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    void get<{ match: Match }>(`/api/matches/${matchId}`).then(({ match }) => {
      const found = match.rounds.find((candidate) => candidate.n === roundNumber && candidate.state === "resolved");
      if (found === undefined) setMissing(true);
      else setRound(found);
    }).catch((error: unknown) => {
      setMissing(true);
      announceFailure(error);
    });
  }, [matchId, roundNumber]);

  useLayoutEffect(() => {
    if (round === null || canvas.current === null) return undefined;
    scene.current = ReplayScene.create(canvas.current, round.kind, round.seed, reduced, (camera: Motion, beans: Motion) => {
      region.current?.setAttribute("data-camera", camera);
      region.current?.setAttribute("data-beans", beans);
    });
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, [round?.seed, round?.kind]);

  const show = (next: FrameView, change: Change): void => {
    const previous = shown.current;
    const jump = change === "release" || (previous !== null && Math.abs(next.tick - previous) > 1);
    shown.current = next.tick;
    setFrame(next);
    scene.current?.show(next, jump);
  };

  const request = (next: number, change: Change): void => {
    wanted.current = next;
    const url = new URL(window.location.href);
    url.searchParams.set("tick", String(next));
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
    const cached = cache.current.get(next);
    if (cached !== undefined) {
      show(cached, change);
      return;
    }
    void get<FrameView>(`/api/matches/${matchId}/rounds/${roundNumber}/frames?tick=${next}`).then((loaded) => {
      cache.current.set(next, loaded);
      if (wanted.current === next) show(loaded, change);
    }).catch((error: unknown) => announceFailure(error));
  };

  useEffect(() => {
    if (round === null || round.lastTick === null) return;
    const start = Math.min(Math.max(initialTick ?? 0, 0), round.lastTick);
    setTick(start);
    request(start, "step");
  }, [round]);

  const change = (next: number, kind: Change): void => {
    if (next === tick && kind !== "release") return;
    setTick(next);
    request(next, kind);
  };

  if (missing) return <section class="page card"><h1>No photo-finish here</h1><p>This round has no finished replay.</p></section>;
  const lastTick = round?.lastTick ?? 0;
  const label = round === null ? "Slots left" : slotsLabel(round.kind);
  return (
    <section ref={region} role="region" aria-label="Photo-finish" class="page photo-finish" data-camera="still" data-beans="still">
      <h1 class="display">{round === null ? "Photo-finish" : <>{round.name} <span class="nowrap">photo-finish</span></>}</h1>
      <div class="replay-layout">
        <div class="replay-main">
          <div class="replay-view">
            <canvas ref={canvas} role="img" aria-label="3D photo-finish view" class="replay-canvas" />
            <p class="slots overlay" data-slots-left={frame?.slotsLeft ?? 0}>
              <span class="slots-label">{label}</span> <span class="numeric slots-value">{frame?.slotsLeft ?? 0}</span>
            </p>
          </div>
          <Playhead tick={tick} lastTick={lastTick} onChange={change} />
          <p role="status" aria-label="Frame" class="frame-status numeric">
            {frame === null ? "" : `Tick ${frame.tick} of ${frame.lastTick}, ${frame.slotsLeft} ${label.toLowerCase()}`}
          </p>
          {reduced && frame !== null ? (
            <div aria-live="polite" class="frame-table-wrap">
              <table aria-label="Photo-finish frame" class="frame-table">
                <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">X</th><th scope="col">Y</th><th scope="col">Z</th><th scope="col">State</th></tr></thead>
                <tbody>
                  {frame.beans.map((bean) => (
                    <tr key={bean.userId}>
                      <td class="numeric">{bean.rank}</td><td>{bean.handle ?? ""}</td>
                      <td class="numeric">{formatPosition(bean.x)}</td><td class="numeric">{formatPosition(bean.y)}</td>
                      <td class="numeric">{formatPosition(bean.z)}</td><td>{STATE_TEXT[bean.state]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
        <ul aria-label="Lanes" class="lanes">
          {(frame?.beans ?? []).map((bean) => (
            <li key={bean.userId} data-user-id={bean.userId} data-tick={frame?.tick} data-x={formatPosition(bean.x)} data-y={formatPosition(bean.y)}
              data-z={formatPosition(bean.z)} data-rank={bean.rank} data-state={bean.state} data-hue={bean.hue} data-marker={bean.marker ?? undefined}
              class={`lane ${bean.state} ${bean.marker ?? ""}`}>
              <span class="numeric rank">{bean.rank}</span>
              <Bean userId={bean.userId} size={28} />
              <span class="handle">{bean.handle ?? ""}</span>
              <span class="numeric lane-z">z {formatPosition(bean.z)}</span>
              <span class="state">{STATE_TEXT[bean.state]}</span>
              {bean.marker === "last_slot" ? <span class="marker last-slot">Last slot</span> : null}
              {bean.marker === "first_out" ? <span class="marker first-out">First out</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
