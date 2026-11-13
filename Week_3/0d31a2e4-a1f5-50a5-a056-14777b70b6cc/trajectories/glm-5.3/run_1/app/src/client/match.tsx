import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { store } from "./store";
import { Icon } from "./ui";
import { addBean, animateObstacles, createScene, followCamera, type Scene } from "./three/scene";
import { hueFor } from "../shared/domain.js";
import { formatClock, slotsLabel } from "./types";

const KEY_BITS: Record<string, number> = {
  KeyW: 1,
  ArrowUp: 1,
  KeyS: 2,
  ArrowDown: 2,
  KeyA: 4,
  ArrowLeft: 4,
  KeyD: 8,
  ArrowRight: 8,
  Space: 16,
  ShiftLeft: 32,
  ShiftRight: 32
};

function useButtons(active: boolean, latestTick: () => number, matchId: number | null, round: number): number {
  const [buttons, setButtons] = useState(0);
  const heldRef = useRef(new Set<string>());

  const pushRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!active) return;
    const push = (): void => {
      let value = 0;
      for (const code of heldRef.current) {
        const bit = KEY_BITS[code];
        if (bit) value |= bit;
      }
      setButtons(value);
      const tick = latestTick();
      // Inputs only count while the round runs; the player's held value is
      // re-sent so a key pressed during the countdown still takes effect.
      if (matchId && store.round?.state === "running") {
        store.live.send({ type: "input", matchId, round, tick, buttons: value });
      }
    };
    pushRef.current = push;
    const isField = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
    const down = (event: KeyboardEvent): void => {
      if (isField(event.target)) return;
      if (event.code === "Space" || event.code.startsWith("Arrow")) event.preventDefault();
      if (KEY_BITS[event.code] === undefined) return;
      heldRef.current.add(event.code);
      push();
    };
    const up = (event: KeyboardEvent): void => {
      if (KEY_BITS[event.code] === undefined) return;
      heldRef.current.delete(event.code);
      push();
    };
    const blur = (): void => {
      heldRef.current.clear();
      push();
    };
    // The tick is read from a ref, so this timer survives every re-render.
    const resend = setInterval(() => pushRef.current(), 400);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      clearInterval(resend);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [active, latestTick, matchId, round]);

  return buttons;
}

export function MatchView(): JSX.Element {
  const match = store.match;
  const round = store.round;
  const me = store.me;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [following, setFollowing] = useState<number | null>(null);
  const [tick, setTick] = useState(store.tick);

  const tickRef = useRef(store.tick);
  tickRef.current = store.tick;
  const latestTick = useCallback(() => tickRef.current, []);

  const buttons = useButtons(
    store.party?.state === "in_match",
    latestTick,
    store.party?.matchId ?? null,
    round?.n ?? 1
  );

  const beans = store.beans;

  const inPlay = (state: string): boolean => state === "alive" || state === "falling" || state === "respawning";
  const myBean = beans.find((b) => b.userId === me?.id);
  const myInPlay = myBean ? inPlay(myBean.state) : true;

  // Spectating follows the lowest-id party friend still in play, else rank 1.
  useEffect(() => {
    if (!myBean || myInPlay) {
      setFollowing(me?.id ?? null);
      return;
    }
    const partyFriends = (store.party?.members ?? [])
      .map((m) => m.user.id)
      .filter((id) => id !== me?.id)
      .sort((a, b) => a - b);
    const friendInPlay = partyFriends.find((id) => {
      const bean = beans.find((b) => b.userId === id);
      return bean ? inPlay(bean.state) : false;
    });
    if (friendInPlay !== undefined) {
      setFollowing(friendInPlay);
      return;
    }
    const rank1 = [...beans].sort((a, b) => a.rank - b.rank).find((b) => inPlay(b.state));
    setFollowing(rank1?.userId ?? null);
  }, [beans, myBean, myInPlay, me?.id]);

  // 3D scene lifecycle
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !round) return;
    const scene = createScene(canvas, round.kind, round.seed);
    sceneRef.current = scene;
    for (const userId of round.starters) {
      addBean(scene, userId, hueFor(userId));
    }
    const onResize = (): void => scene.resize();
    window.addEventListener("resize", onResize);
    let raf = 0;
    const loop = (): void => {
      scene.resize();
      const positions = new Map<number, { x: number; y: number; z: number }>();
      for (const bean of store.beans) {
        positions.set(bean.userId, { x: bean.x, y: bean.y + 0.5, z: bean.z });
        const mesh = scene.beans.get(bean.userId);
        if (mesh) {
          mesh.group.position.set(bean.x, bean.y + 0.5, bean.z);
          mesh.group.visible = bean.state !== "respawning" ? true : false;
        }
      }
      animateObstacles(scene, store.tick);
      followCamera(scene, round.kind, positions, following);
      scene.render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      scene.dispose();
      sceneRef.current = null;
    };
  }, [round?.n, round?.seed, round?.kind, round, following]);

  useEffect(() => {
    setTick(store.tick);
  }, [store.tick]);

  if (!match || !round || !me) return <div className="stage-inner" />;

  const label = round.kind === "survival" ? "Survival" : round.kind === "final" ? "Final" : "Race";
  const roundClock = Math.max(0, (round.kind === "survival" ? 45 : 60) - tick / 20);
  const slotsLeft = store.slotsLeft ?? round.slots;
  const slotsLabelValue = slotsLabel(round.kind);

  const touchVisible = window.matchMedia("(max-width: 1023px)").matches || window.matchMedia("(pointer: coarse)").matches;

  const standings = [...beans].sort((a, b) => a.rank - b.rank);
  const inPlayIds = standings.filter((b) => inPlay(b.state)).map((b) => b.userId);

  const cycleFollow = (dir: 1 | -1): void => {
    if (inPlayIds.length === 0) return;
    const index = following === null ? -1 : inPlayIds.indexOf(following);
    const next = (index + dir + inPlayIds.length) % inPlayIds.length;
    setFollowing(inPlayIds[next] ?? null);
  };

  const forfeit = async (): Promise<void> => {
    try {
      await api.post(`/api/matches/${match.id}/forfeit`);
      store.notify("You forfeited this round.", "success");
    } catch (e) {
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    }
  };

  return (
    <div
      className="match-view"
      role="region"
      aria-label="Match"
      data-match-id={match.id}
      data-round={round.n}
      data-tick={tick}
      data-buttons={buttons}
      data-following-user-id={following ?? ""}
    >
      <div className="match-canvas-wrap">
        <canvas ref={canvasRef} role="img" aria-label="3D course view" />
        <div className="hud">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span className="hud-chip" role="status" aria-label="Round">
              {round.name} · {label}
            </span>
            <span className="hud-chip num" role="timer" aria-label="Round clock">
              {formatClock(roundClock)}
            </span>
            <span className="hud-chip">
              <span aria-hidden="true">{slotsLabelValue}: </span>
              <span className="num" data-slots-left>
                {slotsLeft}
              </span>
            </span>
          </div>
          <div className="standings" style={{ maxHeight: "46vh" }}>
            <ul className="standings-list" aria-label="Live standings">
              {standings.map((bean) => (
                <li
                  key={bean.userId}
                  className="standings-row"
                  data-user-id={bean.userId}
                  data-rank={bean.rank}
                  data-state={bean.state}
                  data-hue={hueFor(bean.userId)}
                  data-x={bean.x}
                  data-y={bean.y}
                  data-z={bean.z}
                >
                  <span className="rank num">{bean.rank}</span>
                  <svg width="16" height="16" viewBox="0 0 32 32" data-hue={hueFor(bean.userId)} aria-hidden="true">
                    <ellipse cx="16" cy="17" rx="12.5" ry="13" fill={`hsl(${hueFor(bean.userId)} 72% 62%)`} stroke="#241b4e" strokeWidth="1.6" />
                  </svg>
                  <span className="truncate" style={{ minWidth: 0, flex: 1 }}>
                    {match.participants.find((p) => p.id === bean.userId)?.handle ?? bean.userId}
                  </span>
                  <span className="state-tag">
                    {bean.state === "qualified" ? "Qualified" : bean.state === "eliminated" ? "Out" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {store.outcome && (
          <div
            className="banner"
            data-kind={store.outcome === "eliminated" ? "eliminated" : store.outcome === "winner" ? "qualified" : "qualified"}
            role="alert"
            aria-label="Round result"
            style={{ position: "absolute", left: "50%", top: "38%", transform: "translateX(-50%)" }}
          >
            {store.outcome === "winner" ? "You won Pratfall Cup!" : store.outcome === "qualified" ? "Qualified!" : "Eliminated"}
          </div>
        )}

        {myBean && !myInPlay && inPlayIds.length > 0 && (
          <div
            className="hud-chip"
            role="status"
            aria-label="Spectating"
            style={{ position: "absolute", left: "50%", bottom: "78px", transform: "translateX(-50%)", display: "flex", gap: 8 }}
          >
            <span>Spectating {match.participants.find((p) => p.id === following)?.handle ?? ""}</span>
            <button type="button" className="btn btn-small" aria-label="Previous player" onClick={() => cycleFollow(-1)}>
              <Icon name="chevronLeft" size={16} />
            </button>
            <button type="button" className="btn btn-small" aria-label="Next player" onClick={() => cycleFollow(1)}>
              <Icon name="chevronRight" size={16} />
            </button>
          </div>
        )}

        {myInPlay && (
          <button
            type="button"
            className="btn btn-small"
            style={{ position: "absolute", right: 12, bottom: 68 }}
            onClick={() => void forfeit()}
          >
            Forfeit
          </button>
        )}

        {touchVisible && (
          <div className="touch-controls" role="group" aria-label="Touch controls" data-buttons={buttons}>
            <TouchStick onButtons={(value) => setTouchButtons(value, () => tickRef.current, match.id, round.n)} />
            <span className="touch-btns">
              <TouchButton label="Jump" onHold={(held) => setTouchButtons(held ? 16 : 0, () => tickRef.current, match.id, round.n, true)} />
              <TouchButton label="Dive" onHold={(held) => setTouchButtons(held ? 32 : 0, () => tickRef.current, match.id, round.n, true)} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

let touchBits = 0;

function setTouchButtons(
  bits: number,
  latestTick: () => number,
  matchId: number,
  round: number,
  replace = false
): void {
  touchBits = replace ? bits : touchBits | bits;
  if (bits === 0 && !replace) return;
  store.live.send({ type: "input", matchId, round, tick: latestTick(), buttons: touchBits });
}

function TouchStick({ onButtons }: { onButtons: (value: number) => void }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);

  const apply = (clientX: number, clientY: number): void => {
    const node = ref.current;
    const thumb = thumbRef.current;
    if (!node || !thumb) return;
    const rect = node.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    const radius = rect.width / 2;
    if (dist < radius / 5) {
      thumb.style.transform = "translate(0px, 0px)";
      onButtons(0);
      return;
    }
    const angle = Math.atan2(dy, dx);
    const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    const norm = Math.min(1, dist / radius);
    thumb.style.transform = `translate(${Math.cos(snapped) * norm * radius * 0.6}px, ${Math.sin(snapped) * norm * radius * 0.6}px)`;
    // Each 45-degree sector maps to one direction or a diagonal pair.
    const sector = Math.round(angle / (Math.PI / 4));
    let value = 0;
    if (sector === -4 || sector === 4) value = 2;
    else if (sector === -3) value = 2 | 8;
    else if (sector === -2) value = 8;
    else if (sector === -1) value = 1 | 8;
    else if (sector === 0) value = 1;
    else if (sector === 1) value = 1 | 4;
    else if (sector === 2) value = 4;
    else if (sector === 3) value = 2 | 4;
    onButtons(value);
  };

  const reset = (): void => {
    const thumb = thumbRef.current;
    if (thumb) thumb.style.transform = "translate(0px, 0px)";
    onButtons(0);
  };

  return (
    <div
      ref={ref}
      className="stick"
      role="group"
      aria-label="Move stick"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        apply(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) apply(e.clientX, e.clientY);
      }}
      onPointerUp={reset}
      onPointerCancel={reset}
    >
      <div className="stick-thumb" ref={thumbRef} />
    </div>
  );
}

function TouchButton({ label, onHold }: { label: string; onHold: (held: boolean) => void }): JSX.Element {
  return (
    <button
      type="button"
      className="btn btn-primary"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onHold(true);
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
    >
      {label}
    </button>
  );
}
