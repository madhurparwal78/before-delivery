// The Match view: the live 3D course, heads-up display, controls, spectating and the round result banner.
import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { post } from "./api.js";
import { Bean } from "./bean.js";
import { COPY } from "./copy.js";
import { banner, cameraSubject, inPlay, live, type LiveView } from "./live.js";
import { MatchScene } from "./match3d.js";
import { announce, announceFailure } from "./notices.js";
import { send } from "./socket.js";
import { useStore } from "./store.js";
import { formatClock, prefersReducedMotion } from "./ui.js";
import type { Party } from "../shared/api.js";
import { slotsLeft } from "../shared/sim.js";
import { BUTTON, formatPosition, hueOf, kindSpec, slotsLabel, TICKS_PER_SECOND, timeLimitTicks } from "../shared/rules.js";
import type { BeanState } from "../shared/rules.js";

const KEYS: Record<string, number> = {
  KeyW: BUTTON.forward, ArrowUp: BUTTON.forward,
  KeyS: BUTTON.back, ArrowDown: BUTTON.back,
  KeyA: BUTTON.left, ArrowLeft: BUTTON.left,
  KeyD: BUTTON.right, ArrowRight: BUTTON.right,
  Space: BUTTON.jump,
  ShiftLeft: BUTTON.dive, ShiftRight: BUTTON.dive,
};

// Screen directions of the stick's eight sectors, counter-clockwise from screen-right.
const SECTORS = [
  BUTTON.right, BUTTON.forward | BUTTON.right, BUTTON.forward, BUTTON.forward | BUTTON.left,
  BUTTON.left, BUTTON.back | BUTTON.left, BUTTON.back, BUTTON.back | BUTTON.right,
] as const;
const DEAD_ZONE = 0.2;

const STATE_TEXT: Record<BeanState, string> = {
  alive: "Running", falling: "Falling", respawning: "Respawning", qualified: "Qualified", eliminated: "Out",
};

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function useTouchControls(): boolean {
  const query = "(max-width: 1023px), (pointer: coarse)";
  const [shown, setShown] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const change = () => setShown(list.matches);
    list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, []);
  return shown;
}

function stickButtons(element: HTMLElement, x: number, y: number): number {
  const box = element.getBoundingClientRect();
  const radius = Math.min(box.width, box.height) / 2;
  const dx = x - (box.left + box.width / 2);
  const dy = y - (box.top + box.height / 2);
  if (Math.hypot(dx, dy) < radius * DEAD_ZONE) return 0;
  const angle = Math.atan2(-dy, dx);
  const sector = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  return SECTORS[sector] ?? 0;
}

function TouchControls({ onChange }: { onChange: (stick: number, jump: boolean, dive: boolean) => void }) {
  const state = useRef({ stick: 0, jump: false, dive: false });
  const update = (change: Partial<typeof state.current>) => {
    state.current = { ...state.current, ...change };
    onChange(state.current.stick, state.current.jump, state.current.dive);
  };
  const stickMove = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (event.buttons === 0 && event.type === "pointermove") return;
    update({ stick: stickButtons(event.currentTarget, event.clientX, event.clientY) });
  };
  const hold = (key: "jump" | "dive") => ({
    onPointerDown: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      update({ [key]: true });
    },
    onPointerUp: () => update({ [key]: false }),
    onPointerCancel: () => update({ [key]: false }),
  });
  return (
    <div role="group" aria-label="Touch controls" class="touch-controls">
      <div role="group" aria-label="Move stick" class="stick"
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); stickMove(event); }}
        onPointerMove={stickMove}
        onPointerUp={() => update({ stick: 0 })}
        onPointerCancel={() => update({ stick: 0 })}>
        <span class="stick-knob" aria-hidden="true" />
      </div>
      <div class="touch-buttons">
        <button type="button" class="button primary touch" {...hold("jump")}>Jump</button>
        <button type="button" class="button secondary touch" {...hold("dive")}>Dive</button>
      </div>
    </div>
  );
}

// Pops in from slightly smaller, holds for three seconds, then fades out. The pop is scale only, so the
// text keeps full contrast from its first frame; the fading banner is already announced, so it leaves the
// accessibility tree (inert) for its fade.
function BannerCard({ text, onDone }: { text: string; onDone: () => void }) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const reduced = prefersReducedMotion();
    if (!reduced) {
      element.current?.animate([{ transform: "scale(0.9)" }, { transform: "scale(1)" }],
        { duration: 160, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    }
    const timer = window.setTimeout(() => {
      element.current?.setAttribute("inert", "");
      const fade = reduced ? undefined : element.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: "ease-out", fill: "forwards" });
      if (fade === undefined) onDone();
      else fade.onfinish = onDone;
    }, 3000);
    return () => window.clearTimeout(timer);
  }, []);
  return <div ref={element} role="alert" aria-label="Round result" class={`round-result ${text === "Eliminated" ? "out" : "made-it"}`}>{text}</div>;
}

// Lives on the stage, not in the Match view, so a result that ends the match stays up over the results.
export function ResultBanner() {
  const shown = useStore(banner);
  const [done, setDone] = useState(0);
  if (shown === null || shown.serial === done) return null;
  return <BannerCard key={shown.serial} text={shown.text} onDone={() => setDone(shown.serial)} />;
}

function hudSlots(view: LiveView): number {
  const round = view.round;
  if (round === null) return 0;
  if (view.standings.length === 0) return round.kind === "survival" ? Math.max(round.starters.length - round.slots, 0) : round.slots;
  return slotsLeft(round.kind, round.slots, view.standings.map((row) => row.state));
}

export function MatchView({ selfId, current }: { selfId: number; current: Party }) {
  const view = useStore(live);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<MatchScene | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [keys, setKeys] = useState(0);
  const [touch, setTouch] = useState({ stick: 0, jump: false, dive: false });
  const touchShown = useTouchControls();
  const lastSent = useRef<{ round: number; buttons: number } | null>(null);
  const round = view?.round ?? null;
  const buttons = keys | touch.stick | (touch.jump ? BUTTON.jump : 0) | (touch.dive ? BUTTON.dive : 0);
  const partyIds = current.members.map((member) => member.user.id).filter((id) => id !== selfId);
  const following = view === null ? null : cameraSubject(view, selfId, partyIds, chosen);
  const handles = new Map(view?.match?.participants.map((user) => [user.id, user.handle]) ?? []);
  const mine = view?.standings.find((row) => row.userId === selfId);
  const playing = mine !== undefined && inPlay(mine.state);

  useLayoutEffect(() => {
    const element = canvas.current;
    if (element === null || round === null) return undefined;
    scene.current = MatchScene.create(element, round.kind, round.seed);
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, [round?.n, round?.seed]);

  useLayoutEffect(() => {
    if (view !== null) scene.current?.update(Math.max(view.tick, 0), view.standings, following);
  }, [view?.received, following]);

  // The client sends its button value whenever it changes, and once more as each round starts running.
  const running = view !== null && round?.state === "running" && view.tick >= 0;
  useEffect(() => {
    if (!running || view === null || round === null) return;
    const previous = lastSent.current;
    const freshRound = previous === null || previous.round !== round.n;
    lastSent.current = { round: round.n, buttons };
    if (freshRound ? buttons === 0 : previous.buttons === buttons) return;
    send({ type: "input", matchId: view.matchId, round: round.n, tick: view.tick, buttons });
  }, [buttons, round?.n, running]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const bit = KEYS[event.code];
      if (bit === undefined || typing(event.target)) return;
      event.preventDefault();
      setKeys((held) => held | bit);
    };
    const up = (event: KeyboardEvent) => {
      const bit = KEYS[event.code];
      if (bit === undefined) return;
      setKeys((held) => held & ~bit);
    };
    const clear = () => setKeys(0);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);

  if (view === null) return <section role="region" aria-label="Match" class="match"><p>Joining the match…</p></section>;
  const spec = round === null ? null : kindSpec(round.kind);
  const limit = round === null ? 0 : timeLimitTicks(round.kind);
  const clock = round === null ? 0 : round.state === "resolved" ? 0 : round.state === "pending" || view.tick < 0 ? limit / TICKS_PER_SECOND
    : (limit - view.tick) / TICKS_PER_SECOND;
  const ordered = view.standings.filter((row) => inPlay(row.state));
  const cycle = (step: number) => {
    if (ordered.length === 0) return;
    const index = ordered.findIndex((row) => row.userId === following);
    const next = ordered[(index + step + ordered.length) % ordered.length];
    if (next !== undefined) setChosen(next.userId);
  };
  const spectating = following !== null && following !== selfId;

  return (
    <section role="region" aria-label="Match" class="match" data-match-id={view.matchId} data-round={round?.n ?? ""}
      data-tick={Math.max(view.tick, 0)} data-buttons={buttons} data-following-user-id={following ?? ""}>
      <div class="match-canvas-wrap">
        <canvas ref={canvas} role="img" aria-label="3D course view" class="match-canvas" tabIndex={-1} />
        <div class="hud">
          <p role="status" aria-label="Round" class="round-name">{round === null ? "" : `${round.name} · ${spec?.kindLabel ?? ""}`}</p>
          <p role="timer" aria-label="Round clock" class="numeric clock">{formatClock(clock)}</p>
          <p class="slots" data-slots-left={hudSlots(view)}>
            <span class="slots-label">{round === null ? "Slots left" : slotsLabel(round.kind)}</span>{" "}
            <span class="numeric slots-value">{hudSlots(view)}</span>
          </p>
        </div>
        {playing ? (
          <button type="button" class="button secondary forfeit" onClick={() => {
            post(`/api/matches/${view.matchId}/forfeit`).then(() => announce(COPY.forfeited)).catch((error: unknown) => announceFailure(error));
          }}>Forfeit</button>
        ) : null}
        {spectating ? (
          <div class="spectating">
            <button type="button" class="button quiet" onClick={() => cycle(-1)}>Previous player</button>
            <p role="status" aria-label="Spectating">Spectating {handles.get(following) ?? ""}</p>
            <button type="button" class="button quiet" onClick={() => cycle(1)}>Next player</button>
          </div>
        ) : null}
        {touchShown && playing ? <TouchControls onChange={(stick, jump, dive) => setTouch({ stick, jump, dive })} /> : null}
      </div>
      <ul aria-label="Live standings" class="live-standings">
        {view.standings.map((row) => (
          <li key={row.userId} data-user-id={row.userId} data-rank={row.rank} data-state={row.state} data-hue={hueOf(row.userId)}
            data-x={formatPosition(row.x)} data-y={formatPosition(row.y)} data-z={formatPosition(row.z)} class={`standing ${row.state}`}>
            <span class="numeric rank">{row.rank}</span>
            <Bean userId={row.userId} size={24} />
            <span class="handle">{handles.get(row.userId) ?? ""}</span>
            <span class="state">{STATE_TEXT[row.state]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
