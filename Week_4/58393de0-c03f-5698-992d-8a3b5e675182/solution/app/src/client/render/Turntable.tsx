import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../lib/motion";
import { SnapshotStill } from "./SnapshotStill";
import { TurntableScene } from "./TurntableScene";
import type { TurntableProps } from "./types";
import { hasWebGL } from "./webgl";

const FILL = { position: "relative", width: "100%", height: "100%", overflow: "hidden" } as const;
const CANVAS = { display: "block", width: "100%", height: "100%" } as const;

function TurntableGl({ snapshot, playing, turnSeconds = 12, className, onReady }: TurntableProps) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<TurntableScene | null>(null);
  const shown = useRef<TurntableProps["snapshot"] | null>(null);
  const playingNow = useRef(playing);
  playingNow.current = playing;
  const readyNow = useRef(onReady);
  readyNow.current = onReady;

  useEffect(() => {
    const element = host.current;
    if (!element) return undefined;
    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, CANVAS);
    element.appendChild(canvas);
    const created = new TurntableScene(canvas, turnSeconds * 1000);
    created.setPlaying(playingNow.current);
    scene.current = created;
    shown.current = null;
    return () => {
      created.dispose();
      canvas.remove();
      scene.current = null;
    };
  }, [turnSeconds]);

  useEffect(() => {
    const current = scene.current;
    if (!current || shown.current === snapshot) return;
    current.setSnapshot(snapshot, shown.current !== null && !prefersReducedMotion(), () => readyNow.current?.());
    shown.current = snapshot;
  }, [snapshot, turnSeconds]);

  useEffect(() => {
    scene.current?.setPlaying(playing);
  }, [playing, turnSeconds]);

  return <div ref={host} className={className} style={FILL} data-playing={String(playing)} />;
}

/**
 * A WebGL canvas that turns the snapshot's model once every 12 seconds, driven by requestAnimationFrame and
 * performance.now() so a controlled page clock steps it. When `snapshot` changes the old model crossfades into the new
 * one over about 250 ms in place (no fade under prefers-reduced-motion). Without WebGL it renders SnapshotStill and
 * never turns. Sets `data-playing="true|false"` on its root element.
 */
export function Turntable(props: TurntableProps) {
  const unlit = !hasWebGL();
  const { onReady } = props;
  useEffect(() => {
    if (unlit) onReady?.();
  }, [unlit, onReady]);
  if (unlit) {
    return (
      <div className={props.className} style={FILL} data-playing="false">
        <SnapshotStill snapshot={props.snapshot} />
      </div>
    );
  }
  return <TurntableGl {...props} />;
}
