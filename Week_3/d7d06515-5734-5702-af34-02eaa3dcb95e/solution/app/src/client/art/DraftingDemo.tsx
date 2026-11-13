// The drafting stroke demo: a plan outline drawn line by line, then offset inward and trimmed. Plays once per press.
// Under reduced motion no animation is created and the final frame stays.
import { Play } from 'lucide-react';
import { useRef } from 'react';
import { line, offsetPolygon, polyline, type Point } from './geometry.ts';
import { GRIP_POP_MS, popGrip, reducedMotion } from '../ui/motion.ts';

// A plan with a chamfered corner and a notch, so the final frame reads as a floor plan and not as nested boxes.
const OUTLINE: readonly Point[] = [[110, 66], [140, 36], [412, 36], [412, 118], [344, 118], [344, 214], [110, 214]];
const GRIPS: readonly Point[] = [[412, 36], [344, 118], [110, 214]];
const PARTITION = [polyline([[232, 54], [232, 150]]), polyline([[232, 150], [326, 150]])];
const INSET = 18;
const TAIL = 16;
const SIDE_STEP_MS = 200;
const SIDE_MS = 240;
const OFFSET_STEP_MS = 130;
const OFFSET_MS = 280;
const TAIL_MS = 240;
const GRIP_BOX = 8;

const core = offsetPolygon(OUTLINE, INSET);
const outline = [...OUTLINE.map((p, i) => line(p, OUTLINE[(i + 1) % OUTLINE.length] as Point)), ...PARTITION];
const coreSides = core.map((p, i) => line(p, core[(i + 1) % core.length] as Point));
// Offset lines run past their corners; the tails are what TRIM removes.
const tails = core.flatMap((p, i) => {
  const before = core[(i + core.length - 1) % core.length] as Point;
  const after = core[(i + 1) % core.length] as Point;
  const along = (from: Point, to: Point): Point => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
    return [((to[0] - from[0]) / length) * TAIL, ((to[1] - from[1]) / length) * TAIL];
  };
  const forward = along(before, p);
  const backward = along(after, p);
  return [line(p, [p[0] + forward[0], p[1] + forward[1]]), line(p, [p[0] + backward[0], p[1] + backward[1]])];
});

const OFFSET_AT = outline.length * SIDE_STEP_MS + 50;
const TAIL_AT = OFFSET_AT + coreSides.length * OFFSET_STEP_MS + OFFSET_MS - 180;
const TRIM_AT = TAIL_AT + TAIL_MS + 60;
const TRIM_MS = 450;
const TOTAL_MS = TRIM_AT + TRIM_MS + GRIP_POP_MS + 100;

export function DraftingDemo() {
  const svg = useRef<SVGSVGElement>(null);
  const track = useRef<HTMLSpanElement>(null);
  const running = useRef<Animation[]>([]);

  const play = (): void => {
    const node = svg.current;
    if (!node || reducedMotion()) return;
    for (const animation of running.current) animation.cancel();
    const easing = 'ease-in-out';
    const reveal = (selector: string, start: (i: number) => number, duration: number): void => {
      node.querySelectorAll(selector).forEach((path, i) => {
        running.current.push(path.animate({ strokeDashoffset: [1, 0] }, { duration, delay: start(i), easing, fill: 'both', iterations: 1 }));
      });
    };
    running.current = [];
    reveal('.demo-outline', (i) => i * SIDE_STEP_MS, SIDE_MS);
    reveal('.demo-core', (i) => OFFSET_AT + i * OFFSET_STEP_MS, OFFSET_MS);
    reveal('.demo-tail', () => TAIL_AT, TAIL_MS);
    node.querySelectorAll('.demo-tail').forEach((path) => {
      // Trim: the tail is rubbed out from its start toward the corner it was cut at.
      running.current.push(path.animate({ strokeDashoffset: [0, -1] }, { duration: TRIM_MS, delay: TRIM_AT, easing, fill: 'forwards', iterations: 1 }));
    });
    node.querySelectorAll('.grip').forEach((grip) => running.current.push(popGrip(grip, TRIM_AT + TRIM_MS)));
    const bar = track.current;
    if (bar) running.current.push(bar.animate({ transform: ['scaleX(0)', 'scaleX(1)'] }, { duration: TOTAL_MS, easing: 'linear', fill: 'both', iterations: 1 }));
  };

  return (
    <div className="demo-frame">
      <svg ref={svg} role="img" aria-label="Drafting demo" viewBox="0 0 522 300" className="demo-art">
        <g className="demo-plan">
          {outline.map((d) => <path key={d} d={d} pathLength={1} className="demo-outline draw" />)}
          {coreSides.map((d) => <path key={d} d={d} pathLength={1} className="demo-core draw" />)}
          {tails.map((d) => <path key={d} d={d} pathLength={1} className="demo-tail draw" />)}
        </g>
        {GRIPS.map(([x, y]) => <rect key={`${x}-${y}`} x={x - GRIP_BOX / 2} y={y - GRIP_BOX / 2} width={GRIP_BOX} height={GRIP_BOX} className="grip" />)}
        <path d="M110 234h302M110 228v12M412 228v12" className="demo-dim" />
      </svg>
      <div className="demo-controls">
        <button type="button" className="btn btn-primary btn-icon" aria-label="Play drafting demo" onClick={play}>
          <Play aria-hidden="true" size={16} />
        </button>
        <span className="demo-track" aria-hidden="true"><span ref={track} className="demo-track-fill" /></span>
      </div>
    </div>
  );
}
