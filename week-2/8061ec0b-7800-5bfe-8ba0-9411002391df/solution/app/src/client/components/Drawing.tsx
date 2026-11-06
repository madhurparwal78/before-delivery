// The contract sheet's drawing group: the turnable 3D model with the slim brass equity gauge beside it, or, without
// WebGL, the flat ink line drawing with its brass hatch. One fill tween moves the band and the gauge together.

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { quotientFloor } from "../../shared/money.js";
import type { InstrumentType, Size } from "../../shared/vocabulary.js";
import { LONG, tween, type Motion } from "../motion.js";
import { InstrumentModel, webglAvailable, type ModelHandle } from "./InstrumentModel.js";

/** The drawing's 200 × 400 frame: `body` paths are the silhouette the brass fills; `detail` paths are line work. */
interface Art { body: string[]; detail: string[] }

const W = 200;
const mirror = (points: [number, number][]): [number, number][] => points.map(([x, y]) => [W - x, y]);

/** A symmetric outline from the right half's cubic segments, starting and ending on the centre line. */
function symmetric(top: number, segments: [number, number][][]): string {
  const right = segments.map((s) => `C ${s.map(([x, y]) => `${x} ${y}`).join(", ")}`).join(" ");
  const left = [...segments].reverse().map((s, i, all) => {
    const [c1, c2] = mirror([s[1], s[0]]);
    const end = i === all.length - 1 ? [W / 2, top] as [number, number] : mirror([all[i + 1][2]])[0];
    return `C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${end[0]} ${end[1]}`;
  }).join(" ");
  return `M ${W / 2} ${top} ${right} ${left} Z`;
}

/** Violin-family body: upper bout, C-bouts and lower bout. */
function stringBody(top: number, bottom: number, upper: number, waist: number, lower: number): string {
  const h = bottom - top;
  const y = (f: number): number => top + h * f;
  const x = (half: number): number => W / 2 + half;
  return symmetric(top, [
    [[x(upper * 0.55), top], [x(upper), y(0.05)], [x(upper), y(0.2)]],
    [[x(upper), y(0.3)], [x(upper * 0.95), y(0.33)], [x(waist + 6), y(0.36)]],
    [[x(waist - 2), y(0.42)], [x(waist - 2), y(0.55)], [x(waist + 6), y(0.6)]],
    [[x(lower * 0.98), y(0.63)], [x(lower), y(0.7)], [x(lower), y(0.8)]],
    [[x(lower), y(0.95)], [x(lower * 0.55), bottom], [W / 2, bottom]],
  ]);
}

function fHoles(top: number, bottom: number, offset: number): string[] {
  const h = bottom - top;
  const y1 = top + h * 0.38;
  const y2 = top + h * 0.62;
  return [-1, 1].map((side) => {
    const cx = W / 2 + side * offset;
    return `M ${cx + side * 4} ${y1} C ${cx - side * 8} ${y1 + 12}, ${cx + side * 8} ${y2 - 14}, ${cx - side * 4} ${y2}
      M ${cx + side * 4} ${y1} m -2 0 a 2 2 0 1 0 4 0 a 2 2 0 1 0 -4 0
      M ${cx - side * 4} ${y2} m -2 0 a 2 2 0 1 0 4 0 a 2 2 0 1 0 -4 0`;
  });
}

function stringFamily(cello: boolean): Art {
  const scrollY = cello ? 26 : 30;
  const nut = cello ? 74 : 86;
  const bodyTop = cello ? 132 : 168;
  const bodyBottom = cello ? 372 : 384;
  const [upper, waist, lower] = cello ? [56, 36, 66] : [50, 32, 60];
  const bridge = bodyTop + (bodyBottom - bodyTop) * 0.56;
  const strings = [-6, -2, 2, 6].map((d) => `M ${W / 2 + d * 0.6} ${nut} L ${W / 2 + d * 1.3} ${bridge} L ${W / 2 + d * 0.9} ${bodyBottom - 30}`);
  return {
    body: [
      stringBody(bodyTop, bodyBottom, upper, waist, lower),
      `M ${W / 2 - 7} ${nut} L ${W / 2 - 9} ${bodyTop + 4} L ${W / 2 + 9} ${bodyTop + 4} L ${W / 2 + 7} ${nut} Z`,
      `M ${W / 2 - 8} ${scrollY + 8} L ${W / 2 - 7} ${nut} L ${W / 2 + 7} ${nut} L ${W / 2 + 8} ${scrollY + 8} Z`,
      `M ${W / 2} ${scrollY - 14} a 13 13 0 1 1 -0.1 0 Z`,
    ],
    detail: [
      `M ${W / 2} ${scrollY - 6} a 6 6 0 1 1 -0.1 0`,
      ...[0.3, 0.55, 0.8].flatMap((f) => {
        const y = scrollY + 8 + (nut - scrollY - 8) * f;
        return [`M ${W / 2 - 8} ${y} l -12 ${f * 2 - 1}`, `M ${W / 2 + 8} ${y} l 12 ${f * 2 - 1}`];
      }),
      `M ${W / 2 - 6} ${nut} L ${W / 2 - 10} ${bridge - 34} L ${W / 2 + 10} ${bridge - 34} L ${W / 2 + 6} ${nut}`,
      ...fHoles(bodyTop, bodyBottom, cello ? 26 : 23),
      `M ${W / 2 - 15} ${bridge} q 15 -7 30 0`,
      `M ${W / 2 - 8} ${bodyBottom - 34} L ${W / 2 - 5} ${bodyBottom - 6} L ${W / 2 + 5} ${bodyBottom - 6} L ${W / 2 + 8} ${bodyBottom - 34} Z`,
      ...strings,
      cello ? `M ${W / 2} ${bodyBottom} L ${W / 2} 398` : `M ${W / 2 - 34} ${bodyBottom - 18} q 14 -14 30 -6`,
    ],
  };
}

function flute(): Art {
  const x0 = W / 2 - 8;
  const keys = Array.from({ length: 11 }, (_, i) => 150 + i * 19);
  return {
    body: [`M ${x0} 22 L ${x0 + 16} 22 L ${x0 + 16} 392 L ${x0} 392 Z`, `M ${W / 2} 62 m -14 0 a 14 9 0 1 0 28 0 a 14 9 0 1 0 -28 0 Z`],
    detail: [
      `M ${x0 - 2} 16 L ${x0 + 18} 16 L ${x0 + 18} 22 L ${x0 - 2} 22 Z`,
      `M ${W / 2} 62 m -5 0 a 5 3.5 0 1 0 10 0 a 5 3.5 0 1 0 -10 0`,
      `M ${x0} 118 L ${x0 + 16} 118`, `M ${x0} 330 L ${x0 + 16} 330`,
      ...keys.map((y) => `M ${W / 2} ${y} m -6 0 a 6 6 0 1 0 12 0 a 6 6 0 1 0 -12 0`),
      `M ${x0 + 20} 140 L ${x0 + 20} 352`,
      ...keys.map((y) => `M ${x0 + 14} ${y} L ${x0 + 20} ${y}`),
      `M ${x0 + 16} 350 l 10 6 l 0 14 l -10 4`, `M ${x0 + 16} 372 l 8 4 l 0 8 l -8 2`,
    ],
  };
}

function clarinet(): Art {
  const c = W / 2;
  return {
    body: [
      `M ${c - 5} 12 L ${c + 5} 12 L ${c + 9} 60 L ${c + 11} 62 L ${c + 11} 88 L ${c + 9} 92 L ${c + 9} 318
        C ${c + 12} 350, ${c + 22} 372, ${c + 34} 392 L ${c - 34} 392 C ${c - 22} 372, ${c - 12} 350, ${c - 9} 318
        L ${c - 9} 92 L ${c - 11} 88 L ${c - 11} 62 L ${c - 9} 60 Z`,
    ],
    detail: [
      `M ${c - 8} 44 L ${c + 8} 44`, `M ${c - 8} 50 L ${c + 8} 50`,
      `M ${c - 11} 62 L ${c + 11} 62`, `M ${c - 11} 88 L ${c + 11} 88`, `M ${c - 10} 206 L ${c + 10} 206`,
      `M ${c - 10} 212 L ${c + 10} 212`, `M ${c - 9} 318 L ${c + 9} 318`,
      ...[120, 140, 160, 236, 256, 276].map((y) => `M ${c} ${y} m -5 0 a 5 5 0 1 0 10 0 a 5 5 0 1 0 -10 0
        M ${c} ${y} m -8 0 a 8 8 0 1 0 16 0 a 8 8 0 1 0 -16 0`),
      `M ${c + 13} 104 L ${c + 13} 300`, `M ${c - 13} 180 L ${c - 13} 300`,
      ...[110, 190, 226, 296].map((y) => `M ${c + 9} ${y} L ${c + 16} ${y} L ${c + 16} ${y + 10} L ${c + 9} ${y + 10}`),
      `M ${c - 30} 384 L ${c + 30} 384`,
    ],
  };
}

function trumpet(): Art {
  const c = W / 2;
  return {
    body: [
      `M ${c - 52} 14 C ${c - 30} 24, ${c - 12} 60, ${c - 9} 150 L ${c + 9} 150 C ${c + 12} 60, ${c + 30} 24, ${c + 52} 14 Z`,
      `M ${c - 9} 150 L ${c - 9} 196 L ${c + 9} 196 L ${c + 9} 150 Z`,
      `M ${c - 24} 196 L ${c + 24} 196 L ${c + 24} 300 L ${c - 24} 300 Z`,
      `M ${c + 24} 214 C ${c + 66} 214, ${c + 66} 290, ${c + 24} 290 L ${c + 24} 280 C ${c + 54} 280, ${c + 54} 224, ${c + 24} 224 Z`,
      `M ${c - 24} 236 C ${c - 54} 236, ${c - 54} 330, ${c - 6} 330 L ${c - 6} 320 C ${c - 42} 320, ${c - 42} 246, ${c - 24} 246 Z`,
      `M ${c - 4} 300 L ${c + 4} 300 L ${c + 3} 372 L ${c - 3} 372 Z`,
      `M ${c - 9} 372 L ${c + 9} 372 L ${c + 4} 382 L ${c + 4} 394 L ${c - 4} 394 L ${c - 4} 382 Z`,
    ],
    detail: [
      `M ${c - 52} 14 Q ${c} 6 ${c + 52} 14`,
      ...[-16, 0, 16].flatMap((dx) => [`M ${c + dx - 7} 196 L ${c + dx - 7} 300`, `M ${c + dx + 7} 196 L ${c + dx + 7} 300`,
        `M ${c + dx} 196 L ${c + dx} 180`, `M ${c + dx} 180 m -6 0 a 6 3 0 1 0 12 0 a 6 3 0 1 0 -12 0`]),
      `M ${c - 24} 214 L ${c + 24} 214`, `M ${c - 24} 282 L ${c + 24} 282`,
      `M ${c + 3} 340 l 10 0 l 0 8 l -10 0`,
    ],
  };
}

function artFor(type: InstrumentType): Art {
  switch (type) {
    case "flute": return flute();
    case "clarinet": return clarinet();
    case "trumpet": return trumpet();
    case "violin": return stringFamily(false);
    case "cello": return stringFamily(true);
  }
}

interface DrawingProps {
  type: InstrumentType; size: Size; label: string;
  /** The fill's fraction as equity and purchase price, or null for the plain model the tech sees. */
  fill: { equity: number; price: number } | null;
}

/** `group "<label> drawing"`: the model (or flat drawing) and, for the owner and parent, the equity gauge. */
export function Drawing({ type, size, label, fill }: DrawingProps): ReactNode {
  const [webgl] = useState(webglAvailable);
  const art = webgl ? null : artFor(type);
  const ids = useId().replace(/:/g, "");
  const gauge = useRef<HTMLDivElement>(null);
  const model = useRef<ModelHandle>(null);
  const shown = useRef<number | null>(null);
  const filling = useRef<Motion>(null);
  const fraction = fill === null ? 0 : fill.equity / fill.price;
  const owned = fill === null ? 0 : quotientFloor(fill.equity * 100, fill.price);

  useLayoutEffect(() => {
    const apply = (value: number): void => {
      shown.current = value;
      if (gauge.current) gauge.current.style.height = `${value * 100}%`;
      model.current?.fillTo(value);
    };
    filling.current?.stop();
    if (shown.current === null) apply(fraction);
    else filling.current = tween(shown.current, fraction, LONG, apply);
  }, [fraction]);

  useLayoutEffect(() => () => filling.current?.stop(), []);

  if (art === null) {
    return (
      <div className="drawing-stage">
        <div role="group" aria-label={`${label} drawing`} className="model-group">
          <InstrumentModel ref={model} type={type} size={size} label={label} banded={fill !== null} fill={fraction} />
          {fill !== null && (
            <div className="gauge-track">
              <div ref={gauge} role="img" aria-label={`Equity fill, ${owned}% owned`} className="gauge" />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="drawing-stage">
      <div role="group" aria-label={`${label} drawing`} className="drawing" data-size={size}>
        <svg className="drawing__art" viewBox="0 0 200 400" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
          {art.body.map((d, i) => <path key={`b${i}`} d={d} className="drawing__body" />)}
          {art.detail.map((d, i) => <path key={`d${i}`} d={d} className="drawing__detail" />)}
        </svg>
        {fill !== null && (
          <div ref={gauge} role="img" aria-label={`Equity fill, ${owned}% owned`} className="drawing__fill">
            <svg className="drawing__hatch" viewBox="0 0 200 400" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
              <defs>
                <pattern id={`hatch${ids}`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="7" height="7" className="hatch__ground" />
                  <line x1="0" y1="0" x2="0" y2="7" className="hatch__line" />
                </pattern>
                <clipPath id={`clip${ids}`}>{art.body.map((d, i) => <path key={i} d={d} />)}</clipPath>
              </defs>
              <rect width="200" height="400" fill={`url(#hatch${ids})`} clipPath={`url(#clip${ids})`} />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
