import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useReducedMotion } from "../lib/motion.ts";

const LENGTH = 12;
const PAGE = 4;

/** The six tracks of the motion chapter, as published: time in seconds and value. */
const TRACKS: readonly { property: string; frames: readonly (readonly [number, number])[] }[] = [
  { property: "Opacity", frames: [[0, 0], [2, 1], [10, 1], [12, 0]] },
  { property: "Scale", frames: [[0, 0.8], [3, 1], [12, 1]] },
  { property: "Offset X", frames: [[0, -40], [4, 0], [8, 0], [12, 40]] },
  { property: "Offset Y", frames: [[0, 24], [3, 0], [12, 0]] },
  { property: "Rotate", frames: [[0, -6], [6, 0], [12, 6]] },
  { property: "Blur", frames: [[0, 8], [2, 0], [10, 0], [12, 4]] },
];

const mmss = (seconds: number): string => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

/** Linear interpolation between neighbouring keyframes, two decimals rounded half up. */
function valueAt(frames: readonly (readonly [number, number])[], t: number): string {
  const index = Math.max(1, frames.findIndex(([time]) => time >= t));
  const [t0, v0] = frames[index - 1];
  const [t1, v1] = frames[index];
  const value = v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  return (Math.floor(value * 100 + 0.5 + 1e-9) / 100).toFixed(2);
}

/** Motion chapter: a 12-second timeline with six tracks, a playhead, keyframe buttons and the values at the playhead. */
export function TimelineFigure(): ReactNode {
  const reduced = useReducedMotion();
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const lanes = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setT((current) => Math.min(LENGTH, current + 1)), 1000);
    return () => window.clearInterval(timer);
  }, [playing]);
  useEffect(() => {
    if (t >= LENGTH) setPlaying(false);
  }, [t]);

  const toggle = (): void => {
    if (playing) return setPlaying(false);
    if (reduced) return setT(LENGTH);
    if (t >= LENGTH) setT(0);
    setPlaying(true);
  };

  const seek = (clientX: number): void => {
    const box = lanes.current!.getBoundingClientRect();
    setT(Math.min(LENGTH, Math.max(0, Math.round(((clientX - box.left) / box.width) * LENGTH))));
  };
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    setPlaying(false);
    seek(event.clientX);
    const move = (e: PointerEvent): void => seek(e.clientX);
    const stop = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  const pageKeys = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      setT(Math.min(LENGTH, Math.max(0, t + (event.key === "PageUp" ? PAGE : -PAGE))));
    }
  };

  return (
    <section className="figure-cell cell cell-pad" data-frame aria-labelledby="timeline-title">
      <h2 id="timeline-title" className="cell-label">
        Timeline
      </h2>
      <div className="timeline">
        <ul className="tracks" aria-label="Tracks">
          {TRACKS.map((track) => (
            <li key={track.property}>
              {track.property}, {track.frames.length} keyframes
            </li>
          ))}
        </ul>
        <div className="lanes" role="group" aria-label="Timeline" ref={lanes} onPointerDown={startDrag}>
          {TRACKS.map((track) => (
            <div className="lane" key={track.property}>
              {track.frames.map(([time]) => (
                <button
                  key={time}
                  type="button"
                  className="keyframe"
                  style={{ left: `${(time / LENGTH) * 100}%` }}
                  aria-label={`${track.property} keyframe at ${mmss(time)}`}
                  onClick={() => {
                    setPlaying(false);
                    setT(time);
                  }}
                >
                  <span className="keyframe-dot" />
                </button>
              ))}
            </div>
          ))}
          <span className="playhead-line" style={{ left: `${(t / LENGTH) * 100}%` }} aria-hidden="true" />
        </div>
      </div>
      <div className="playhead-controls">
        <button type="button" className="btn btn-primary" onClick={toggle}>
          {playing ? "Pause" : "Play"}
        </button>
        <label htmlFor="playhead">Playhead</label>
        <input id="playhead" type="range" min={0} max={LENGTH} step={1} value={t} onChange={(e) => (setPlaying(false), setT(Number(e.target.value)))} onKeyDown={pageKeys} />
        <span className="readout">
          {mmss(t)} / {mmss(LENGTH)}
        </span>
      </div>
      <div className="table-wrap">
        <table className="table values-table" aria-label="Values at playhead">
          <thead>
            <tr>
              <th scope="col">Property</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {TRACKS.map((track) => (
              <tr key={track.property}>
                <td>{track.property}</td>
                <td>{valueAt(track.frames, t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="prose muted">
        A title sequence lasts twelve seconds across six tracks. Each property is set at its keyframes and moves in a straight line between them. Move the playhead with the arrow keys, Page Up and Page Down, by dragging or tapping the timeline, or by choosing a keyframe, and read the value of every property below.
      </p>
    </section>
  );
}
