import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './shell';

const DRAW_EASING = 'cubic-bezier(0.2, 0.9, 0.1, 1)';
export const DRAW_DURATION = 900;
export const DRAW_STAGGER = 40;
export const GRIP_POP = 160;

export interface WireArtProps {
  viewBox: string;
  paths: string[];
  grips?: Array<[number, number]>;
  gripSize?: number;
  animate?: boolean;
  onView?: boolean;
  className?: string;
  preserveAspectRatio?: string;
}

/** One-pixel grey line art whose paths draw in, each followed by a grip pop at its endpoint. */
export function WireArt(props: WireArtProps): JSX.Element {
  const reduced = useReducedMotion();
  const root = useRef<SVGSVGElement>(null);
  const [visible, setVisible] = useState(props.onView !== true);

  useEffect(() => {
    if (props.onView !== true || visible) return;
    const node = root.current;
    if (node === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [props.onView, visible]);

  useEffect(() => {
    const node = root.current;
    if (node === null || !visible || props.animate !== true || reduced) return;
    const paths = [...node.querySelectorAll<SVGPathElement>('path[data-wire]')];
    const grips = [...node.querySelectorAll<SVGRectElement>('rect[data-grip]')];
    const animations: Animation[] = [];
    paths.forEach((path, index) => {
      const length = path.getTotalLength();
      path.style.strokeDasharray = `${length}`;
      animations.push(
        path.animate(
          [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
          { duration: DRAW_DURATION, delay: index * DRAW_STAGGER, easing: DRAW_EASING, fill: 'both' },
        ),
      );
    });
    grips.forEach((grip, index) => {
      animations.push(
        grip.animate([{ transform: 'scale(0)' }, { transform: 'scale(1)' }], {
          duration: GRIP_POP,
          delay: Math.min(index, paths.length - 1) * DRAW_STAGGER + DRAW_DURATION,
          easing: 'ease-out',
          fill: 'both',
        }),
      );
    });
    return () => {
      for (const animation of animations) animation.cancel();
      for (const path of paths) path.style.strokeDasharray = '';
    };
  }, [visible, props.animate, reduced, props.paths]);

  const size = props.gripSize ?? 6;
  return (
    <svg
      ref={root}
      viewBox={props.viewBox}
      className={`wire ${props.className ?? ''}`}
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio={props.preserveAspectRatio ?? 'xMidYMid slice'}
    >
      {props.paths.map((path, index) => (
        <path key={index} d={path} data-wire="" />
      ))}
      {(props.grips ?? []).map(([x, y], index) => (
        <rect
          key={index}
          data-grip=""
          className="grip-node"
          x={x - size / 2}
          y={y - size / 2}
          width={size}
          height={size}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        />
      ))}
    </svg>
  );
}

// ------------------------------------------------------------- seeded generators

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** An invented ribbed roof shell: oblique planes, arcs and offset curves. */
export const HERO_SHELL_PATHS: string[] = [
  'M40 620 L360 420 L760 520 L420 740 Z',
  'M360 420 L360 220 L760 320 L760 520',
  'M40 620 L40 420 L360 220',
  'M760 320 L1180 180 L1180 380 L760 520',
  'M180 540 C330 300 620 250 1100 230',
  'M180 580 C340 350 640 300 1120 280',
  'M180 620 C350 400 660 350 1140 330',
  'M460 700 L460 500 L900 420',
  'M520 680 L520 480',
  'M600 650 L600 450',
  'M680 620 L680 420',
  'M900 420 L900 300',
  'M1000 390 L1000 270',
];

export const HERO_SHELL_GRIPS: Array<[number, number]> = [
  [40, 620],
  [360, 420],
  [760, 520],
  [420, 740],
  [1180, 180],
  [1180, 380],
  [460, 500],
  [900, 420],
  [1100, 230],
  [1140, 330],
];

export const CALLOUT_SHELL_PATHS: string[] = [
  'M0 760 L300 520 L820 600 L1440 440',
  'M300 520 L300 260 L820 340 L820 600',
  'M820 340 L1440 180 L1440 440',
  'M120 700 C420 420 900 360 1420 300',
  'M120 740 C430 470 910 410 1430 350',
  'M380 620 L380 300',
  'M520 600 L520 290',
  'M660 580 L660 320',
  'M960 540 L960 300',
  'M1120 500 L1120 260',
  'M1280 470 L1280 230',
  'M60 780 L160 700',
  'M160 780 L260 700',
  'M260 780 L360 700',
];

export function constellationPaths(seed: number): {
  paths: string[];
  grips: Array<[number, number]>;
} {
  const random = makeRandom(seed);
  const nodes: Array<[number, number]> = [];
  for (let i = 0; i < 9; i += 1) {
    nodes.push([20 + random() * 260, 20 + random() * 260]);
  }
  const paths: string[] = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const a = nodes[i]!;
    const b = nodes[i + 1]!;
    paths.push(`M${a[0].toFixed(1)} ${a[1].toFixed(1)} L${b[0].toFixed(1)} ${b[1].toFixed(1)}`);
  }
  for (let i = 0; i < 3; i += 1) {
    const a = nodes[i]!;
    const b = nodes[nodes.length - 1 - i]!;
    paths.push(`M${a[0].toFixed(1)} ${a[1].toFixed(1)} L${b[0].toFixed(1)} ${b[1].toFixed(1)}`);
  }
  return { paths, grips: nodes };
}

export function GripConstellation(props: { seed: number; className?: string }): JSX.Element {
  const { paths, grips } = constellationPaths(props.seed);
  return (
    <WireArt
      viewBox="0 0 300 300"
      paths={paths}
      grips={grips}
      gripSize={7}
      animate
      onView
      className={props.className}
      preserveAspectRatio="xMidYMid meet"
    />
  );
}

/** A floor plan generated in code: grey walls with a few red grips. */
function floorPlan(seed: number, width: number, height: number): JSX.Element {
  const random = makeRandom(seed);
  const margin = 8;
  const inner = 6;
  const splitX = Math.round(width * (0.35 + random() * 0.25));
  const splitY = Math.round(height * (0.4 + random() * 0.2));
  const doorAt = Math.round(splitY * 0.6);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="wire" aria-hidden="true">
      <path d={`M${margin} ${margin} H${width - margin} V${height - margin} H${margin} Z`} />
      <path
        d={`M${margin + inner} ${margin + inner} H${width - margin - inner} V${height - margin - inner} H${margin + inner} Z`}
      />
      <path d={`M${splitX} ${margin + inner} V${splitY}`} />
      <path d={`M${splitX} ${splitY + 18} V${height - margin - inner}`} />
      <path d={`M${splitX} ${splitY} H${width - margin - inner}`} />
      <path d={`M${margin + inner} ${doorAt} H${splitX}`} />
      <circle cx={splitX + (width - splitX) / 2} cy={splitY / 2} r={Math.min(18, height / 8)} />
      <rect className="grip-node" x={splitX - 3} y={splitY - 3} width="6" height="6" />
      <rect className="grip-node" x={margin - 3} y={margin - 3} width="6" height="6" />
      <rect className="grip-node" x={width - margin - 3} y={height - margin - 3} width="6" height="6" />
    </svg>
  );
}

export function ThreeDevicePreview(): JSX.Element {
  return (
    <div className="device-row" role="img" aria-label="Corbel Draft on a laptop, tablet and phone">
      <div className="device device-laptop">{floorPlan(11, 320, 200)}</div>
      <div className="device device-tablet">{floorPlan(29, 150, 200)}</div>
      <div className="device device-phone">{floorPlan(47, 80, 160)}</div>
    </div>
  );
}

/** A dense contour site plan generated in code: magenta lines over white contours. */
function contourSitePlan(): JSX.Element {
  const random = makeRandom(97);
  const contours: string[] = [];
  for (let ring = 0; ring < 7; ring += 1) {
    const points: string[] = [];
    const radius = 26 + ring * 11;
    for (let step = 0; step <= 24; step += 1) {
      const angle = (step / 24) * Math.PI * 2;
      const wobble = radius * (0.86 + random() * 0.22);
      points.push(`${(160 + Math.cos(angle) * wobble * 1.5).toFixed(1)},${(85 + Math.sin(angle) * wobble * 0.8).toFixed(1)}`);
    }
    contours.push(`M${points.join(' L')} Z`);
  }
  return (
    <svg viewBox="0 0 320 170" aria-hidden="true">
      {contours.map((path, index) => (
        <path key={index} d={path} fill="none" stroke="#e9ecef" strokeWidth="0.6" opacity="0.65" />
      ))}
      <path d="M20 150 H300" stroke="#ff4fd0" strokeWidth="1" fill="none" />
      <path d="M46 150 V48 H140 V150" stroke="#ff4fd0" strokeWidth="1" fill="none" />
      <path d="M140 96 H250 V150" stroke="#ff4fd0" strokeWidth="1" fill="none" />
      <path d="M46 48 L93 22 L140 48" stroke="#ff4fd0" strokeWidth="1" fill="none" />
      <path d="M186 96 V150" stroke="#ff4fd0" strokeWidth="1" fill="none" />
    </svg>
  );
}

export function EditorWindowPreview(): JSX.Element {
  return (
    <div className="editor-preview" role="img" aria-label="Corbel Draft editor preview">
      <div className="editor-preview-bar">
        <span className="editor-preview-dot" />
        <span className="editor-preview-dot" />
        <span className="editor-preview-dot" />
      </div>
      <div className="editor-preview-tools">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="editor-preview-body">
        <div className="editor-preview-panel">
          <div className="editor-preview-row">
            <span>Layer</span>
            <span>A-WALL</span>
          </div>
          <div className="editor-preview-row">
            <span>Length</span>
            <span>6000.00</span>
          </div>
          <div className="editor-preview-row">
            <span>Angle</span>
            <span>90.00°</span>
          </div>
          <div className="editor-preview-row">
            <span>Handle</span>
            <span>1B</span>
          </div>
          <div className="editor-preview-tilegrid">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="editor-preview-canvas">{contourSitePlan()}</div>
      </div>
      <div className="editor-preview-command">
        <b>Command:</b>
        <span>OFFSET</span>
        <span>OSNAP</span>
        <span>ORTHO</span>
        <span>Synced · v14</span>
      </div>
    </div>
  );
}

export function GraphiteSlabBackdrop(): JSX.Element {
  return (
    <div className="slab" aria-hidden="true">
      <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
        <rect width="1440" height="900" fill="#070809" />
        <polygon points="0,560 520,180 760,300 240,700" fill="#14171b" />
        <polygon points="240,700 760,300 1000,420 480,840" fill="#1b1f24" />
        <polygon points="480,840 1000,420 1240,540 720,900" fill="#101316" />
        <polygon points="720,900 1240,540 1440,640 1440,900" fill="#191d22" />
        <path d="M0 560 L520 180" stroke="#f2f4f6" strokeWidth="1" opacity="0.5" fill="none" />
        <path d="M240 700 L760 300" stroke="#f2f4f6" strokeWidth="1" opacity="0.4" fill="none" />
        <path d="M480 840 L1000 420" stroke="#f2f4f6" strokeWidth="1" opacity="0.35" fill="none" />
        <path d="M720 900 L1240 540" stroke="#f2f4f6" strokeWidth="1" opacity="0.3" fill="none" />
        <path d="M0 40 C420 180 860 360 1440 480" stroke="#ff2f70" strokeWidth="3" fill="none" opacity="0.9" />
      </svg>
    </div>
  );
}

export function SheetGlyph(): JSX.Element {
  return (
    <svg className="callout-glyph" viewBox="0 0 104 128" aria-hidden="true">
      <polygon points="0,0 82,0 104,24 104,64 0,64" fill="#1f3f96" />
      <polygon points="82,0 104,24 82,24" fill="#4663bb" />
      <rect x="0" y="64" width="104" height="64" fill="#f2c517" />
      <path d="M26 20 H74" stroke="#ffffff" strokeWidth="1" fill="none" />
      <path d="M50 6 V44" stroke="#ffffff" strokeWidth="1" fill="none" />
      <path d="M14 34 H90" stroke="#ffffff" strokeWidth="1" fill="none" />
      <path d="M16 82 H88" stroke="#1b1b1b" strokeWidth="1" fill="none" />
      <path d="M16 98 H68" stroke="#1b1b1b" strokeWidth="1" fill="none" />
      <path d="M16 112 H80" stroke="#1b1b1b" strokeWidth="1" fill="none" />
    </svg>
  );
}

const DEMO_OUTLINE = [
  'M30 150 H270',
  'M270 150 V30',
  'M270 30 H30',
  'M30 30 V150',
  'M42 138 H258',
  'M258 138 V42',
  'M258 42 H42',
  'M42 42 V138',
];

/** The drafting demo: the outline draws line by line, then offsets and trims, once. */
export function DraftingDemo(): JSX.Element {
  const reduced = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const [played, setPlayed] = useState(false);

  const play = (): void => {
    const node = svgRef.current;
    if (node === null) return;
    setPlayed(true);
    if (reduced) return;
    const paths = [...node.querySelectorAll<SVGPathElement>('path[data-wire]')];
    paths.forEach((path, index) => {
      const length = path.getTotalLength();
      path.style.strokeDasharray = `${length}`;
      path.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
        duration: 420,
        delay: index * 220,
        easing: DRAW_EASING,
        fill: 'both',
      });
    });
  };

  return (
    <div className="media-frame split-media">
      <div role="img" aria-label="Drafting demo">
        <svg
          ref={svgRef}
          viewBox="0 0 300 180"
          className="wire"
          style={{ width: '100%', height: 'auto' }}
          aria-hidden="true"
        >
          {DEMO_OUTLINE.map((path, index) => (
            <path key={index} d={path} data-wire="" />
          ))}
          <rect className="grip-node" x="27" y="147" width="6" height="6" />
          <rect className="grip-node" x="267" y="27" width="6" height="6" />
        </svg>
      </div>
      <button type="button" className="btn btn-outline" onClick={play}>
        Play drafting demo
      </button>
      {played ? <span className="sr-only">Demo played.</span> : null}
    </div>
  );
}

export function BandIcon(props: { kind: 'command' | 'markup' | 'sheet' }): JSX.Element {
  if (props.kind === 'command') {
    return (
      <svg viewBox="0 0 40 40" className="wire" width="40" height="40" aria-hidden="true">
        <path d="M4 8 H36 V32 H4 Z" />
        <path d="M10 18 L16 22 L10 26" />
        <path d="M20 26 H30" />
      </svg>
    );
  }
  if (props.kind === 'markup') {
    return (
      <svg viewBox="0 0 40 40" className="wire" width="40" height="40" aria-hidden="true">
        <path d="M6 32 H34" />
        <path d="M10 32 V12 H24 V32" />
        <path d="M14 8 C20 2 30 6 32 14 C34 22 26 26 22 22" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 40 40" className="wire" width="40" height="40" aria-hidden="true">
      <path d="M6 6 H28 L34 12 V34 H6 Z" />
      <path d="M28 6 V12 H34" />
      <path d="M12 20 H26" />
      <path d="M12 26 H22" />
    </svg>
  );
}
