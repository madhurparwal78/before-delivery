// The turnable instrument model: one procedural three.js model per instrument, built from simple shapes, drawn in
// ink lines and flat ink tints on cream paper. A flat brass band fills its silhouette from the base to the equity
// fraction. It renders only when something changes, so it never moves at idle.

import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState,
  type KeyboardEvent, type PointerEvent } from "react";
import {
  Box3, BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide, EdgesGeometry, ExtrudeGeometry, Float32BufferAttribute,
  Group, LatheGeometry, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, OrthographicCamera, Plane, Scene, Shape,
  TorusGeometry, Vector2, Vector3, WebGLRenderer,
} from "three";
import type { InstrumentType, Size } from "../../shared/vocabulary.js";
import { MEDIUM, tween, type Motion } from "../motion.js";

const PAPER = "#f5eedf";
const INK = "#1a2233";
/** The single brass of the gauge (styles.css `--brass-fill`). */
const BRASS = "#c69a35";
/** Flat ink tints: a quarter and a half of ink laid on the paper. */
const TINT = "#bebbb4";
const TINT_DARK = "#87898e";

/** Every 100 pixels of horizontal drag turn the model 90 degrees; keys turn it 15. */
const DEGREES_PER_PIXEL = 0.9;
const KEY_TURN = 15;
/** World units the camera shows top to bottom; a full-size model is 1 unit tall. */
const VIEW_HEIGHT = 1.08;
const VIEW_BOTTOM = -0.04;

/** Fractional string sizes are drawn smaller on the same canvas. */
const STRING_SCALE: Record<Size, number> = { "1/4": 0.7, "1/2": 0.8, "3/4": 0.9, "4/4": 1, full: 1 };

/** An angle held from 0 up to, not including, 360. */
function wrapAngle(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** The described angle: the nearest multiple of 15, halfway up, wrapped. */
function describedAngle(degrees: number): number {
  return wrapAngle(Math.floor(degrees / KEY_TURN + 0.5) * KEY_TURN);
}

let webglChecked: boolean | null = null;

/** Whether this browser can create a WebGL context at all; checked once. */
export function webglAvailable(): boolean {
  if (webglChecked === null) {
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
    webglChecked = gl !== null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return webglChecked;
}

interface Part { geometry: BufferGeometry; tint: string; at?: [number, number, number]; turn?: [number, number, number] }

const cylinder = (radius: number, from: number, to: number, x = 0, z = 0, tint = TINT): Part =>
  ({ geometry: new CylinderGeometry(radius, radius, to - from, 20), tint, at: [x, (from + to) / 2, z] });

const box = (w: number, from: number, to: number, d: number, x = 0, z = 0, tint = TINT): Part =>
  ({ geometry: new BoxGeometry(w, to - from, d), tint, at: [x, (from + to) / 2, z] });

const lathe = (profile: [number, number][], tint = TINT): Part =>
  ({ geometry: new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), 28), tint });

/** A disc facing the viewer, such as a key pad or a valve cap seen from the front. */
const pad = (radius: number, y: number, z: number, x = 0, tint = TINT_DARK): Part =>
  ({ geometry: new CylinderGeometry(radius, radius, 0.006, 18), tint, at: [x, y, z], turn: [Math.PI / 2, 0, 0] });

/** A violin-family body outline: lower bout at the base, C-bouts, upper bout. */
function stringBody(bottom: number, top: number, upper: number, waist: number, lower: number, depth: number): Part {
  const h = top - bottom;
  const y = (f: number): number => bottom + h * f;
  const s = new Shape();
  s.moveTo(0, bottom);
  s.bezierCurveTo(lower * 0.55, bottom, lower, y(0.05), lower, y(0.2));
  s.bezierCurveTo(lower, y(0.3), lower * 0.98, y(0.37), waist + 0.02, y(0.4));
  s.bezierCurveTo(waist - 0.01, y(0.45), waist - 0.01, y(0.58), waist + 0.02, y(0.64));
  s.bezierCurveTo(upper * 0.95, y(0.67), upper, y(0.7), upper, y(0.8));
  s.bezierCurveTo(upper, y(0.95), upper * 0.55, top, 0, top);
  s.bezierCurveTo(-upper * 0.55, top, -upper, y(0.95), -upper, y(0.8));
  s.bezierCurveTo(-upper, y(0.7), -upper * 0.95, y(0.67), -waist - 0.02, y(0.64));
  s.bezierCurveTo(-waist + 0.01, y(0.58), -waist + 0.01, y(0.45), -waist - 0.02, y(0.4));
  s.bezierCurveTo(-lower * 0.98, y(0.37), -lower, y(0.3), -lower, y(0.2));
  s.bezierCurveTo(-lower, y(0.05), -lower * 0.55, bottom, 0, bottom);
  const geometry = new ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 14 });
  geometry.translate(0, 0, -depth / 2);
  return { geometry, tint: TINT };
}

function stringFamily(cello: boolean): Part[] {
  const base = cello ? 0.07 : 0;
  const bodyTop = cello ? 0.64 : 0.57;
  const depth = cello ? 0.11 : 0.06;
  const [upper, waist, lower] = cello ? [0.16, 0.105, 0.195] : [0.14, 0.09, 0.168];
  const front = depth / 2;
  const neckTop = cello ? 0.87 : 0.85;
  const parts: Part[] = [
    stringBody(base, bodyTop, upper, waist, lower, depth),
    box(0.05, bodyTop, neckTop, 0.04, 0, 0, TINT),
    box(0.044, base + (bodyTop - base) * 0.5, neckTop, 0.012, 0, front + 0.012, TINT_DARK),
    box(0.04, neckTop, 0.94, 0.045, 0, 0, TINT),
    { geometry: new TorusGeometry(0.03, 0.013, 10, 24), tint: TINT_DARK, at: [0, 0.965, 0], turn: [0, Math.PI / 2, 0] },
    box(0.12, base + (bodyTop - base) * 0.34, base + (bodyTop - base) * 0.37, 0.012, 0, front + 0.01, TINT_DARK),
    box(0.07, base + 0.03, base + (bodyTop - base) * 0.2, 0.012, 0, front + 0.008, TINT_DARK),
    ...[0.875, 0.91].flatMap((y) => [-1, 1].map((side) => ({
      geometry: new CylinderGeometry(0.008, 0.008, 0.07, 10), tint: TINT_DARK, at: [side * 0.045, y, 0] as [number, number, number],
      turn: [0, 0, Math.PI / 2] as [number, number, number],
    }))),
  ];
  if (cello) parts.push(cylinder(0.007, 0, base, 0, 0, TINT_DARK));
  return parts;
}

function flute(): Part[] {
  return [
    cylinder(0.022, 0, 0.965),
    cylinder(0.026, 0.965, 1),
    box(0.075, 0.86, 0.9, 0.012, 0, 0.024, TINT_DARK),
    cylinder(0.005, 0.12, 0.66, 0.034, 0, TINT_DARK),
    ...Array.from({ length: 12 }, (_, i) => pad(0.015, 0.14 + i * 0.044, 0.024)),
  ];
}

function clarinet(): Part[] {
  return [
    lathe([[0, 0], [0.09, 0], [0.07, 0.03], [0.045, 0.075], [0.032, 0.12], [0.026, 0.17], [0.026, 0.79], [0.031, 0.79],
      [0.031, 0.86], [0.026, 0.86], [0.024, 0.93], [0.016, 0.985], [0.006, 1], [0, 1]]),
    ...[0.3, 0.34, 0.38, 0.6, 0.64, 0.68].map((y) => pad(0.011, y, 0.026)),
    ...[0.17, 0.48, 0.79].map((y) => ({ geometry: new TorusGeometry(0.028, 0.004, 8, 28), tint: TINT_DARK,
      at: [0, y, 0] as [number, number, number], turn: [Math.PI / 2, 0, 0] as [number, number, number] })),
    cylinder(0.004, 0.24, 0.74, 0.033, 0.012, TINT_DARK),
  ];
}

function trumpet(): Part[] {
  return [
    lathe([[0, 0.6], [0.028, 0.6], [0.04, 0.76], [0.07, 0.88], [0.17, 1], [0, 1]]),
    cylinder(0.02, 0.27, 0.6),
    ...[-0.065, 0, 0.065].flatMap((x) => [cylinder(0.028, 0.28, 0.48, x), cylinder(0.018, 0.48, 0.53, x, 0, TINT_DARK)]),
    { geometry: new TorusGeometry(0.07, 0.014, 10, 24, Math.PI), tint: TINT, at: [0, 0.28, 0.035], turn: [0, 0, Math.PI] },
    { geometry: new TorusGeometry(0.045, 0.011, 10, 20, Math.PI), tint: TINT_DARK, at: [0.065, 0.28, -0.035], turn: [0, 0, Math.PI] },
    cylinder(0.011, 0.05, 0.27),
    lathe([[0, 0], [0.024, 0], [0.024, 0.02], [0.012, 0.05], [0, 0.05]], TINT_DARK),
  ];
}

function partsFor(type: InstrumentType): Part[] {
  switch (type) {
    case "flute": return flute();
    case "clarinet": return clarinet();
    case "trumpet": return trumpet();
    case "violin": return stringFamily(false);
    case "cello": return stringFamily(true);
  }
}

/** Strings run from the tailpiece over the bridge to the nut, as ink lines. */
function strings(type: InstrumentType): LineSegments | null {
  if (type !== "violin" && type !== "cello") return null;
  const cello = type === "cello";
  const base = cello ? 0.07 : 0;
  const bodyTop = cello ? 0.64 : 0.57;
  const front = (cello ? 0.11 : 0.06) / 2 + 0.02;
  const nut = cello ? 0.87 : 0.85;
  const points = [-1.5, -0.5, 0.5, 1.5].flatMap((i) => [
    i * 0.011, base + (bodyTop - base) * 0.2, front, i * 0.014, base + (bodyTop - base) * 0.37, front + 0.004,
    i * 0.014, base + (bodyTop - base) * 0.37, front + 0.004, i * 0.007, nut, front,
  ]);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
  return new LineSegments(geometry, new LineBasicMaterial({ color: INK }));
}

/** The whole scene for one instrument, with the band height as a clip plane in world space. */
class InstrumentScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-0.5, 0.5, VIEW_BOTTOM + VIEW_HEIGHT, VIEW_BOTTOM, 0.1, 20);
  private readonly turnable = new Group();
  private readonly brass = new Group();
  private readonly above = new Plane(new Vector3(0, 1, 0), 0);
  private readonly below = new Plane(new Vector3(0, -1, 0), 0);
  private readonly bottom: number;
  private readonly height: number;
  private angle = 0;
  private fill = 0;

  constructor(canvas: HTMLCanvasElement, type: InstrumentType, size: Size, banded: boolean) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(new Color(PAPER), 1);
    this.camera.position.set(0, 0, 5);

    const model = new Group();
    const brassMaterial = new MeshBasicMaterial({ color: BRASS, side: DoubleSide, clippingPlanes: [this.below], toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const edgeMaterial = new LineBasicMaterial({ color: INK, toneMapped: false });
    for (const part of partsFor(type)) {
      const ink = new Mesh(part.geometry, new MeshBasicMaterial({
        color: part.tint, side: DoubleSide, clippingPlanes: banded ? [this.above] : [], toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      }));
      const edges = new LineSegments(new EdgesGeometry(part.geometry, 28), edgeMaterial);
      const pieces: (Mesh | LineSegments)[] = [ink, edges];
      if (banded) pieces.push(new Mesh(part.geometry, brassMaterial));
      for (const piece of pieces) {
        if (part.at) piece.position.set(...part.at);
        if (part.turn) piece.rotation.set(...part.turn);
        if (piece.material === brassMaterial) this.brass.add(piece);
        else model.add(piece);
      }
    }
    const lines = strings(type);
    if (lines) model.add(lines);
    const scale = type === "violin" || type === "cello" ? STRING_SCALE[size] : 1;
    this.turnable.add(model, this.brass);
    this.turnable.scale.setScalar(scale);
    this.scene.add(this.turnable);
    this.scene.updateMatrixWorld(true);
    const extent = new Box3().setFromObject(model, true);
    this.bottom = extent.min.y;
    this.height = extent.max.y - extent.min.y;
  }

  resize(width: number, height: number): void {
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(width, height, false);
    const half = (VIEW_HEIGHT * width) / height / 2;
    this.camera.left = -half;
    this.camera.right = half;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  turnTo(degrees: number): void {
    this.angle = degrees;
    this.draw();
  }

  fillTo(fraction: number): void {
    this.fill = fraction;
    this.draw();
  }

  private draw(): void {
    const top = this.bottom + this.height * this.fill;
    this.above.constant = -top;
    this.below.constant = top;
    this.brass.visible = this.fill > 0;
    this.turnable.rotation.y = (this.angle * Math.PI) / 180;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

export interface ModelHandle { fillTo: (fraction: number) => void }

interface ModelProps { type: InstrumentType; size: Size; label: string; banded: boolean; fill: number }

/** `img "<label> model"`: focusable, turned by Left and Right in 15-degree steps or by a horizontal drag. */
export const InstrumentModel = forwardRef<ModelHandle, ModelProps>(function InstrumentModel({ type, size, label, banded, fill }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<InstrumentScene | null>(null);
  const shown = useRef(0);
  const target = useRef(0);
  const turning = useRef<Motion>(null);
  const drag = useRef<{ id: number; x: number; y: number; from: number; touch: boolean; active: boolean } | null>(null);
  const [described, setDescribed] = useState(0);
  const descriptionId = useId();
  const initialFill = useRef(fill);

  useImperativeHandle(ref, () => ({ fillTo: (fraction: number) => scene.current?.fillTo(fraction) }), []);

  useLayoutEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const built = new InstrumentScene(node, type, size, banded);
    scene.current = built;
    built.fillTo(initialFill.current);
    const fit = (): void => {
      const box = node.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) built.resize(box.width, box.height);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => {
      observer.disconnect();
      built.dispose();
      scene.current = null;
    };
  }, [type, size, banded]);

  useEffect(() => () => turning.current?.stop(), []);

  const easeTo = (degrees: number): void => {
    turning.current?.stop();
    target.current = degrees;
    setDescribed(describedAngle(degrees));
    turning.current = tween(shown.current, degrees, MEDIUM, (value) => {
      shown.current = value;
      scene.current?.turnTo(value);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>): void => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    easeTo(target.current + (event.key === "ArrowRight" ? KEY_TURN : -KEY_TURN));
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    const touch = event.pointerType === "touch";
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, from: shown.current, touch, active: !touch };
    if (!touch) event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const dx = event.clientX - d.x;
    if (!d.active) {
      if (Math.abs(dx) < 6 || Math.abs(dx) <= Math.abs(event.clientY - d.y)) return;
      d.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    turning.current?.stop();
    shown.current = d.from + dx * DEGREES_PER_PIXEL;
    target.current = shown.current;
    setDescribed(describedAngle(shown.current));
    scene.current?.turnTo(shown.current);
  };
  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>): void => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== event.pointerId || !d.active) return;
    easeTo(Math.floor(shown.current / KEY_TURN + 0.5) * KEY_TURN);
  };

  return (
    <>
      <canvas ref={canvas} className="model" role="img" aria-label={`${label} model`} aria-describedby={descriptionId}
        tabIndex={0} onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; }} />
      <span id={descriptionId} className="visually-hidden">Turned {described} degrees. Left and Right arrow keys turn it.</span>
    </>
  );
});
