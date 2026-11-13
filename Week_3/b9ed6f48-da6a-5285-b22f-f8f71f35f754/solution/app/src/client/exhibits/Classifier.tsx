// Chapter VII: the perceptron classifier (brief: Exhibits › Classifier; Motion › Classifier
// training). Every move retrains the published perceptron and scores it on the held-out points;
// Train replays the same training epoch by epoch.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { formatAccuracy, scoreHeldOut, trainPerceptron, type ClassifierSeed, type Point, type Weights } from "../../shared/exhibits.js";
import { copyFor } from "../../shared/copy.js";

const EPOCH_MS = 250;
const MOVES = [
  { direction: "left", dx: -1, dy: 0 },
  { direction: "right", dx: 1, dy: 0 },
  { direction: "up", dx: 0, dy: 1 },
  { direction: "down", dx: 0, dy: -1 },
];
const PLOT = 400;
const PAD = 24;

const toPx = (v: number, max: number) => PAD + (v / max) * (PLOT - 2 * PAD);

/** The decision line w1·x + w2·y + b = 0 clipped to the grid, or null when there is none. */
function decisionLine(w: Weights, max: number): [number, number, number, number] | null {
  const ends: [number, number][] = [];
  if (w.w2 !== 0) for (const x of [0, max]) ends.push([x, -(w.w1 * x + w.b) / w.w2]);
  if (w.w1 !== 0) for (const y of [0, max]) ends.push([-(w.w2 * y + w.b) / w.w1, y]);
  const inside = ends.filter(([x, y]) => x >= -1e-9 && x <= max + 1e-9 && y >= -1e-9 && y <= max + 1e-9);
  if (inside.length < 2) return null;
  return [inside[0][0], inside[0][1], inside[inside.length - 1][0], inside[inside.length - 1][1]];
}

export function ClassifierExhibit({ seed, reducedMotion, onUse }: { seed: ClassifierSeed; reducedMotion: boolean; onUse: () => void }) {
  const max = seed.grid.max;
  const [points, setPoints] = useState<Point[]>(seed.training);
  const [selected, setSelected] = useState<number | null>(null);
  const [shownWeights, setShownWeights] = useState<Weights>(() => trainPerceptron(seed.training, seed.max_epochs).weights);
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef(0);
  const dragging = useRef<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  const model = trainPerceptron(points, seed.max_epochs);
  const score = scoreHeldOut(model.weights, seed.held_out);
  const accuracy = formatAccuracy(score.accuracyTenths);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const move = (index: number, x: number, y: number) => {
    onUse();
    window.clearTimeout(timer.current);
    const next = points.map((p, i) => (i === index ? { ...p, x: Math.min(max, Math.max(seed.grid.min, x)), y: Math.min(max, Math.max(seed.grid.min, y)) } : p));
    const trained = trainPerceptron(next, seed.max_epochs);
    setPoints(next);
    setShownWeights(trained.weights);
    setAnnouncement(copyFor.heldOut(formatAccuracy(scoreHeldOut(trained.weights, seed.held_out).accuracyTenths)));
  };

  const nudge = (dx: number, dy: number) => {
    if (selected === null) return;
    move(selected, points[selected].x + dx, points[selected].y + dy);
  };

  const train = () => {
    onUse();
    window.clearTimeout(timer.current);
    const done = copyFor.trained(accuracy, model.epochs);
    if (reducedMotion) {
      setShownWeights(model.weights);
      setAnnouncement(done);
      return;
    }
    setAnnouncement("");
    const step = (epoch: number) => {
      setShownWeights(model.history[epoch]);
      if (epoch + 1 < model.history.length) timer.current = window.setTimeout(() => step(epoch + 1), EPOCH_MS);
      else timer.current = window.setTimeout(() => setAnnouncement(done), EPOCH_MS);
    };
    setShownWeights({ w1: 0, w2: 0, b: 0 });
    timer.current = window.setTimeout(() => step(0), EPOCH_MS);
  };

  const onPointKey = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    setSelected(index);
    move(index, points[index].x + delta[0], points[index].y + delta[1]);
  };

  const gridPoint = (clientX: number, clientY: number) => {
    const box = (svg.current as SVGSVGElement).getBoundingClientRect();
    const sx = ((clientX - box.left) / box.width) * PLOT;
    const sy = ((clientY - box.top) / box.height) * PLOT;
    return [Math.round(((sx - PAD) / (PLOT - 2 * PAD)) * max), Math.round(((PLOT - sy - PAD) / (PLOT - 2 * PAD)) * max)];
  };

  const line = decisionLine(shownWeights, max);
  const label = (p: Point, i: number) => `Point ${i + 1}, ${p.label === "signal" ? "Signal" : "Noise"}, at ${p.x}, ${p.y}`;

  return (
    <div className="exhibit classifier-exhibit">
      <div className="classifier-layout">
        <svg
          ref={svg}
          viewBox={`0 0 ${PLOT} ${PLOT}`}
          className="classifier-plot"
          aria-hidden="true"
          onPointerMove={(event) => {
            if (dragging.current === null) return;
            const [x, y] = gridPoint(event.clientX, event.clientY);
            const p = points[dragging.current];
            if (x !== p.x || y !== p.y) move(dragging.current, x, y);
          }}
          onPointerUp={() => (dragging.current = null)}
          onPointerLeave={() => (dragging.current = null)}
        >
          {Array.from({ length: max + 1 }, (_, i) => (
            <g key={i} className="grid-line">
              <line x1={toPx(i, max)} y1={PAD} x2={toPx(i, max)} y2={PLOT - PAD} />
              <line x1={PAD} y1={PLOT - toPx(i, max)} x2={PLOT - PAD} y2={PLOT - toPx(i, max)} />
            </g>
          ))}
          {line && <line className="decision-line" x1={toPx(line[0], max)} y1={PLOT - toPx(line[1], max)} x2={toPx(line[2], max)} y2={PLOT - toPx(line[3], max)} />}
          {seed.held_out.map((p, i) => (
            <rect key={`h${i}`} className={`held-out ${p.label}`} x={toPx(p.x, max) - 6} y={PLOT - toPx(p.y, max) - 6} width={12} height={12} transform={`rotate(45 ${toPx(p.x, max)} ${PLOT - toPx(p.y, max)})`} />
          ))}
          {points.map((p, i) => (
            <circle
              key={i}
              className={`training ${p.label}${selected === i ? " is-selected" : ""}`}
              cx={toPx(p.x, max)}
              cy={PLOT - toPx(p.y, max)}
              r={9}
              onPointerDown={(event) => {
                dragging.current = i;
                setSelected(i);
                event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
              }}
            />
          ))}
        </svg>
        <div className="classifier-side">
          <p className="figure accuracy">Held-out accuracy {accuracy}%</p>
          <table aria-label="Confusion counts" className="data-table confusion">
            <thead>
              <tr>
                <td />
                <th scope="col">Predicted signal</th>
                <th scope="col">Predicted noise</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Actual signal</th>
                <td>{score.confusion.signal[0]}</td>
                <td>{score.confusion.signal[1]}</td>
              </tr>
              <tr>
                <th scope="row">Actual noise</th>
                <td>{score.confusion.noise[0]}</td>
                <td>{score.confusion.noise[1]}</td>
              </tr>
            </tbody>
          </table>
          <p className="figure weights">
            w₁ = {shownWeights.w1}, w₂ = {shownWeights.w2}, b = {shownWeights.b} · {model.epochs} epochs
          </p>
          <button type="button" className="button button-primary" onClick={train}>
            Train
          </button>
        </div>
      </div>
      <div role="group" aria-label="Training points" className="point-buttons">
        {points.map((p, i) => (
          <button key={i} type="button" className={`point-button ${p.label}`} aria-pressed={selected === i} aria-label={label(p, i)} onClick={() => setSelected(i)} onKeyDown={onPointKey(i)}>
            <span aria-hidden="true">{i + 1}</span>
          </button>
        ))}
      </div>
      <div className="move-buttons">
        {MOVES.map(({ direction, dx, dy }) => (
          <button key={direction} type="button" className="button" disabled={selected === null} onClick={() => nudge(dx, dy)}>
            Move point {direction}
          </button>
        ))}
      </div>
      <div role="status" aria-label="Classifier results" className="exhibit-status">
        {announcement}
      </div>
    </div>
  );
}
