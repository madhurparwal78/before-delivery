import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatAccuracy,
  scoreClassifier,
  trainPerceptron,
  type ClassifierSeed,
  type LabelledPoint,
  type PerceptronWeights,
} from '../../../shared/exhibits.js';
import { accuracyAnnouncement, trainingFinishedAnnouncement } from '../../../shared/copy.js';
import { useStore } from '../../lib/store.js';

const EPOCH_MS = 250;

function pointName(index: number, point: LabelledPoint): string {
  return `Point ${index + 1}, ${point.label === 'signal' ? 'Signal' : 'Noise'}, at ${point.x}, ${point.y}`;
}

export function ClassifierExhibit({ seed, onUse }: { seed: ClassifierSeed; onUse: () => void }): JSX.Element {
  const { reducedMotion } = useStore();
  const [points, setPoints] = useState<LabelledPoint[]>(seed.training);
  const [selected, setSelected] = useState<number | null>(null);
  const [line, setLine] = useState<PerceptronWeights | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const timer = useRef<number | null>(null);

  const run = useMemo(() => trainPerceptron(points, seed.max_epochs), [points, seed.max_epochs]);
  const score = useMemo(() => scoreClassifier(run.weights, seed.held_out), [run.weights, seed.held_out]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    setAnnouncement(accuracyAnnouncement(formatAccuracy(score.accuracy)));
    setLine(run.weights);
  }, [score.accuracy, run.weights]);

  function movePoint(index: number, dx: number, dy: number): void {
    onUse();
    setPoints((current) =>
      current.map((point, position) =>
        position === index
          ? {
              ...point,
              x: Math.min(seed.grid.max, Math.max(seed.grid.min, point.x + dx)),
              y: Math.min(seed.grid.max, Math.max(seed.grid.min, point.y + dy)),
            }
          : point,
      ),
    );
  }

  function train(): void {
    onUse();
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (reducedMotion) {
      setLine(run.weights);
      setAnnouncement(trainingFinishedAnnouncement(formatAccuracy(score.accuracy), run.epochs));
      return;
    }
    let epoch = 0;
    const step = (): void => {
      const weights = run.history[epoch];
      if (weights) setLine(weights);
      epoch += 1;
      if (epoch < run.history.length) {
        timer.current = window.setTimeout(step, EPOCH_MS);
        return;
      }
      timer.current = null;
      setLine(run.weights);
      setAnnouncement(trainingFinishedAnnouncement(formatAccuracy(score.accuracy), run.epochs));
    };
    step();
  }

  const span = seed.grid.max - seed.grid.min;
  const toPercent = (value: number): number => ((value - seed.grid.min) / span) * 100;

  const boundary = ((): { x1: number; y1: number; x2: number; y2: number } | null => {
    if (!line || (line.w1 === 0 && line.w2 === 0)) return null;
    const at = (x: number): number => (-line.b - line.w1 * x) / (line.w2 === 0 ? 1e-6 : line.w2);
    return { x1: 0, y1: at(seed.grid.min), x2: 100, y2: at(seed.grid.max) };
  })();

  return (
    <div className="exhibit">
      <span className="catalogue">HRR-VII-01</span>
      <h3>The perceptron</h3>
      <p>
        Sixteen training points teach the learning rule; eight held-out points score it. Pick a point and move it to
        see the decision line follow.
      </p>
      <div className="point-grid" role="group" aria-label="Training points">
        {boundary ? (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <line
              x1={boundary.x1}
              y1={100 - toPercent(boundary.y1)}
              x2={boundary.x2}
              y2={100 - toPercent(boundary.y2)}
              stroke="#e2631c"
              strokeWidth="0.6"
            />
          </svg>
        ) : null}
        {points.map((point, index) => (
          <button
            key={index}
            type="button"
            aria-label={pointName(index, point)}
            aria-pressed={selected === index}
            style={{ left: `${toPercent(point.x)}%`, bottom: `${toPercent(point.y)}%` }}
            onClick={() => setSelected(index)}
            onKeyDown={(event) => {
              const moves: Record<string, [number, number]> = {
                ArrowLeft: [-1, 0],
                ArrowRight: [1, 0],
                ArrowUp: [0, 1],
                ArrowDown: [0, -1],
              };
              const move = moves[event.key];
              if (!move) return;
              event.preventDefault();
              setSelected(index);
              movePoint(index, move[0], move[1]);
            }}
          >
            {point.label === 'signal' ? 'S' : 'N'}
            {index + 1}
          </button>
        ))}
      </div>
      <div className="inline-actions">
        <button type="button" disabled={selected === null} onClick={() => movePoint(selected as number, -1, 0)}>
          Move point left
        </button>
        <button type="button" disabled={selected === null} onClick={() => movePoint(selected as number, 1, 0)}>
          Move point right
        </button>
        <button type="button" disabled={selected === null} onClick={() => movePoint(selected as number, 0, 1)}>
          Move point up
        </button>
        <button type="button" disabled={selected === null} onClick={() => movePoint(selected as number, 0, -1)}>
          Move point down
        </button>
        <button type="button" onClick={train}>
          Train
        </button>
      </div>
      <p className="readout">Held-out accuracy {formatAccuracy(score.accuracy)}%</p>
      <div className="table-scroll">
        <table aria-label="Confusion counts">
          <thead>
            <tr>
              <th scope="col"> </th>
              <th scope="col">Predicted signal</th>
              <th scope="col">Predicted noise</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Actual signal</th>
              <td>{score.truePositive}</td>
              <td>{score.falseNegative}</td>
            </tr>
            <tr>
              <th scope="row">Actual noise</th>
              <td>{score.falsePositive}</td>
              <td>{score.trueNegative}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p role="status" aria-label="Classifier results" className="readout">
        {announcement}
      </p>
    </div>
  );
}
