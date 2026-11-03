import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { addBean, animateObstacles, createScene, followCamera, type Scene } from "./three/scene";
import { hueFor } from "../shared/domain.js";
import { formatPosition, reducedMotion, slotsLabel, type FrameBean, type FramesView, type MatchView } from "./types";

const GLIDE_MS = 150;
const CAMERA_MS = 500;

export function PhotoFinishPage({
  matchId,
  roundN,
  initialTick
}: {
  matchId: number;
  roundN: number;
  initialTick: number | null;
}): JSX.Element {
  const [match, setMatch] = useState<MatchView | null>(null);
  const [frame, setFrame] = useState<FramesView | null>(null);
  const [tick, setTick] = useState<number>(initialTick ?? 0);
  const [beansMoving, setBeansMoving] = useState(false);
  const [cameraMoving, setCameraMoving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const glideRef = useRef<{ from: Map<number, { x: number; y: number; z: number }>; to: Map<number, { x: number; y: number; z: number }>; start: number } | null>(null);
  const cameraRef = useRef<{ from: { pos: [number, number, number]; look: [number, number, number] }; to: { pos: [number, number, number]; look: [number, number, number] }; start: number } | null>(null);
  const reduced = reducedMotion();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const view = await api.get<{ match: MatchView }>(`/api/matches/${matchId}`);
      if (cancelled) return;
      setMatch(view.match);
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const view = await api.get<FramesView>(`/api/matches/${matchId}/rounds/${roundN}/frames?tick=${tick}`);
      if (cancelled) return;
      setFrame(view);
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId, roundN, tick]);

  // Keep the URL tick fresh without adding history entries.
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("tick", String(tick));
    history.replaceState(null, "", url);
  }, [tick]);

  const round = match?.rounds.find((r) => r.n === roundN) ?? null;

  // 3D scene
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !round || !frame) return;
    if (!sceneRef.current) {
      const scene = createScene(canvas, round.kind, round.seed);
      for (const starter of round.starters) {
        const marker = frame.beans.find((bean) => bean.userId === starter)?.marker ?? null;
        addBean(scene, starter, hueFor(starter), marker);
      }
      sceneRef.current = scene;
    }
    const scene = sceneRef.current;
    const onResize = (): void => scene.resize();

    const positions = new Map<number, { x: number; y: number; z: number }>();
    const from = new Map<number, { x: number; y: number; z: number }>();
    for (const bean of scene.beans.values()) {
      from.set(bean.userId, { x: bean.group.position.x, y: bean.group.position.y, z: bean.group.position.z });
    }
    for (const bean of frame.beans) {
      positions.set(bean.userId, { x: bean.x, y: bean.y + 0.5, z: bean.z });
    }
    glideRef.current = { from, to: positions, start: performance.now() };
    setBeansMoving(!reduced);

    const lead = [...frame.beans].sort((a, b) => a.rank - b.rank)[0];
    const leadPos = lead ? { x: lead.x, y: 0.5, z: lead.z } : null;
    const target = leadPos
      ? round.kind === "survival"
        ? { pos: ([leadPos.x + 8, 9, leadPos.z + 8] as [number, number, number]), look: ([leadPos.x, 0.5, leadPos.z] as [number, number, number]) }
        : { pos: ([leadPos.x, 6, leadPos.z - 10] as [number, number, number]), look: ([leadPos.x, 0.5, Math.min(leadPos.z + 6, (scene.course.length || 0) + 4)] as [number, number, number]) }
      : null;
    if (target) {
      cameraRef.current = {
        from: {
          pos: [scene.camera.position.x, scene.camera.position.y, scene.camera.position.z],
          look: [0, 0, 0]
        },
        to: target,
        start: performance.now()
      };
      setCameraMoving(!reduced);
    }

    let raf = 0;
    const loop = (): void => {
      scene.resize();
      const now = performance.now();
      const glide = glideRef.current;
      if (glide && !reduced) {
        const t = Math.min(1, (now - glide.start) / GLIDE_MS);
        const eased = 1 - Math.pow(1 - t, 3);
        for (const mesh of scene.beans.values()) {
          const to = glide.to.get(mesh.userId);
          const fromPos = glide.from.get(mesh.userId) ?? to;
          if (to && fromPos) {
            mesh.group.position.set(
              fromPos.x + (to.x - fromPos.x) * eased,
              fromPos.y + (to.y - fromPos.y) * eased,
              fromPos.z + (to.z - fromPos.z) * eased
            );
          }
        }
        if (t >= 1) {
          glideRef.current = null;
          setBeansMoving(false);
        }
      } else if (reduced) {
        for (const mesh of scene.beans.values()) {
          const to = positions.get(mesh.userId);
          if (to) mesh.group.position.set(to.x, to.y, to.z);
        }
      }
      animateObstacles(scene, frame.tick);

      const cam = cameraRef.current;
      if (cam && !reduced) {
        const t = Math.min(1, (now - cam.start) / CAMERA_MS);
        const eased = 1 - Math.pow(1 - t, 3);
        scene.camera.position.set(
          cam.from.pos[0] + (cam.to.pos[0] - cam.from.pos[0]) * eased,
          cam.from.pos[1] + (cam.to.pos[1] - cam.from.pos[1]) * eased,
          cam.from.pos[2] + (cam.to.pos[2] - cam.from.pos[2]) * eased
        );
        scene.camera.lookAt(
          cam.from.look[0] + (cam.to.look[0] - cam.from.look[0]) * eased,
          cam.from.look[1] + (cam.to.look[1] - cam.from.look[1]) * eased,
          cam.from.look[2] + (cam.to.look[2] - cam.from.look[2]) * eased
        );
        if (t >= 1) {
          cameraRef.current = null;
          setCameraMoving(false);
        }
      } else if (reduced && cameraRef.current) {
        const cam2 = cameraRef.current;
        scene.camera.position.set(cam2.to.pos[0], cam2.to.pos[1], cam2.to.pos[2]);
        scene.camera.lookAt(cam2.to.look[0], cam2.to.look[1], cam2.to.look[2]);
        cameraRef.current = null;
        setCameraMoving(false);
      } else if (!cameraRef.current) {
        followCamera(scene, round.kind, positions, null);
      }
      scene.render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [frame, round, reduced]);

  useEffect(() => {
    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  const jump = useCallback((target: number) => {
    const clamped = Math.max(0, Math.min(frame?.lastTick ?? 0, target));
    setTick(clamped);
  }, [frame?.lastTick]);

  const lastTick = frame?.lastTick ?? 0;
  const slotsLabelText = slotsLabel(frame?.kind ?? "race");
  const slotsLabelLower = slotsLabelText === "Falls to go" ? "falls to go" : "slots left";


  if (!frame || !match || !round) {
    return <div className="page">Loading photo-finish…</div>;
  }

  const ranked = [...frame.beans].sort((a, b) => a.rank - b.rank);

  return (
    <div className="photo-finish">
      <div>
        <div className="pf-canvas-wrap">
          <canvas ref={canvasRef} role="img" aria-label="3D photo-finish view" />
          <div className="pf-hud">
            <span className="hud-chip" role="region" aria-label="Photo-finish" data-camera={cameraMoving ? "moving" : "still"} data-beans={beansMoving ? "moving" : "still"}>
              {round.name}
            </span>
            <span className="hud-chip">
              <span>{slotsLabelText}: </span>
              <span className="num" data-slots-left>
                {frame.slotsLeft}
              </span>
            </span>
          </div>
        </div>
        <div className="playhead" style={{ marginTop: 12 }}>
          <label htmlFor="playhead" className="sr-only">
            Playhead
          </label>
          <input
            id="playhead"
            type="range"
            min={0}
            max={lastTick}
            value={tick}
            role="slider"
            aria-label="Playhead"
            aria-valuetext={`Tick ${tick} of ${lastTick}`}
            onChange={(e) => jump(Number(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") { e.preventDefault(); jump(tick + 1); }
              if (e.key === "ArrowLeft") { e.preventDefault(); jump(tick - 1); }
              if (e.key === "PageUp") { e.preventDefault(); jump(tick + 20); }
              if (e.key === "PageDown") { e.preventDefault(); jump(tick - 20); }
              if (e.key === "Home") { e.preventDefault(); jump(0); }
              if (e.key === "End") { e.preventDefault(); jump(lastTick); }
            }}
          />
          <span className="num" role="status" aria-label="Frame">
            Tick {tick} of {lastTick}, {frame.slotsLeft} {slotsLabelLower}
          </span>
        </div>
        {reduced && (
          <table className="panel" style={{ marginTop: 12, padding: 10, width: "100%" }} aria-label="Photo-finish frame" role="status">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>X</th>
                <th>Y</th>
                <th>Z</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody className="mono">
              {ranked.map((bean) => (
                <tr key={bean.userId}>
                  <td>{bean.rank}</td>
                  <td>{bean.handle}</td>
                  <td>{formatPosition(bean.x)}</td>
                  <td>{formatPosition(bean.y)}</td>
                  <td>{formatPosition(bean.z)}</td>
                  <td>{bean.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="pf-side">
        <ul className="lanes" aria-label="Lanes">
          {ranked.map((bean: FrameBean) => (
            <li
              key={bean.userId}
              className="lane-row"
              data-user-id={bean.userId}
              data-tick={frame.tick}
              data-x={bean.x}
              data-y={bean.y}
              data-z={bean.z}
              data-rank={bean.rank}
              data-state={bean.state}
              data-hue={hueFor(bean.userId)}
              data-marker={bean.marker ?? undefined}
            >
              <span className="rank num">{bean.rank}</span>
              <svg width="18" height="18" viewBox="0 0 32 32" data-hue={hueFor(bean.userId)} aria-hidden="true">
                <ellipse cx="16" cy="17" rx="12.5" ry="13" fill={`hsl(${hueFor(bean.userId)} 72% 62%)`} stroke="#241b4e" strokeWidth="1.6" />
              </svg>
              <span className="truncate" style={{ minWidth: 0, flex: 1 }}>
                {bean.handle ?? bean.userId}
              </span>
              <span className="lane-pos">{formatPosition(bean.x)} · {formatPosition(bean.y)} · {formatPosition(bean.z)}</span>
              {bean.state === "qualified" && bean.finishTick !== null && (
                <span style={{ color: "var(--teal)", fontWeight: 700, fontSize: 12 }}>Qualified</span>
              )}
              {bean.marker === "last_slot" && <span className="lane-marker">Last slot</span>}
              {bean.marker === "first_out" && <span className="lane-marker">First out</span>}
            </li>
          ))}
        </ul>
        <p>
          <a className="btn btn-small" href={`#/matches/${matchId}`}>
            Back to Cup #{matchId}
          </a>
        </p>
      </div>
    </div>
  );
}
