import * as THREE from "three";
import { LANES, type LayoutId } from "../../shared/model";
import { h } from "../dom";
import { PALETTE, buildCar, lights, webgl2Renderer } from "../scene";
import { bounds, pointAt, trackPath, type TrackPath } from "../track";

const LANE_OFFSET = 3.6;
const HALF_WIDTH = 7.5;
const KERB = 1.4;

interface CarMark {
  readonly carId: string;
  readonly distance: number;
  readonly offset: number;
}

interface RaceFrame {
  readonly player: CarMark;
  readonly others: readonly CarMark[];
  readonly ghost: CarMark | null;
}

export interface RaceView {
  readonly canvas: HTMLCanvasElement;
  draw(frame: RaceFrame): void;
  dispose(): void;
}

// The WebGL race view: one track ribbon (with ruled kerbs, lane marks, coins and the start line
// in the same mesh), the player's car, AI cars and a translucent ghost, behind a chase camera.
class WebGlRaceView implements RaceView {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 16 / 10, 0.5, 2000);
  private readonly path: TrackPath;
  private readonly cars = new Map<string, THREE.Group>();
  private readonly resize: ResizeObserver;
  private last: RaceFrame | null = null;

  constructor(readonly canvas: HTMLCanvasElement, private readonly renderer: THREE.WebGLRenderer, layoutId: LayoutId,
    showCoins: boolean) {
    this.path = trackPath(layoutId);
    lights(this.scene);
    this.scene.add(ribbon(this.path, showCoins));
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(canvas);
  }

  private fit(): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.last) this.draw(this.last);
  }

  private place(key: string, mark: CarMark, colour: number, ghost = false): void {
    let car = this.cars.get(key);
    if (!car) {
      car = buildCar(mark.carId, colour, ghost);
      this.cars.set(key, car);
      this.scene.add(car);
    }
    const p = pointAt(this.path, mark.distance, mark.offset);
    car.position.set(p.x, 0, -p.y);
    car.rotation.y = p.heading;
  }

  draw(frame: RaceFrame): void {
    this.last = frame;
    this.place("player", frame.player, PALETTE.accent);
    frame.others.forEach((mark, i) => this.place(`ai-${i}`, mark, PALETTE.ink));
    if (frame.ghost) this.place("ghost", frame.ghost, PALETTE.ink, true);
    const behind = pointAt(this.path, frame.player.distance - 9, frame.player.offset);
    const ahead = pointAt(this.path, frame.player.distance + 22, frame.player.offset);
    this.camera.position.set(behind.x, 3.8, -behind.y);
    this.camera.lookAt(ahead.x, 0.4, -ahead.y);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.resize.disconnect();
    this.renderer.dispose();
  }
}

function ribbon(path: TrackPath, showCoins: boolean): THREE.Mesh {
  const layout = path.layout;
  const positions: number[] = [];
  const colours: number[] = [];
  const colour = new THREE.Color();
  const quad = (d0: number, d1: number, o0: number, o1: number, hex: number, lift = 0) => {
    const a = pointAt(path, d0, o0);
    const b = pointAt(path, d0, o1);
    const c = pointAt(path, d1, o1);
    const d = pointAt(path, d1, o0);
    for (const p of [a, b, c, a, c, d]) positions.push(p.x, lift, -p.y);
    colour.setHex(hex);
    for (let i = 0; i < 6; i += 1) colours.push(colour.r, colour.g, colour.b);
  };
  const step = 2;
  for (let d = 0; d < layout.length; d += step) {
    quad(d, d + step, -HALF_WIDTH, HALF_WIDTH, 0x4b453c);
    const corner = layout.corners.find((c) => c.start <= d && d < c.end);
    const stripe = Math.floor(d / 4) % 2 === 0 ? PALETTE.ink : PALETTE.surface;
    const edge = corner ? stripe : PALETTE.kerb;
    quad(d, d + step, HALF_WIDTH, HALF_WIDTH + KERB, edge, 0.01);
    quad(d, d + step, -HALF_WIDTH - KERB, -HALF_WIDTH, edge, 0.01);
    if (Math.floor(d / 6) % 2 === 0) {
      for (const lane of [LANE_OFFSET / 2, -LANE_OFFSET / 2]) quad(d, d + step, lane - 0.12, lane + 0.12, PALETTE.kerb, 0.02);
    }
  }
  for (let i = 0; i < 8; i += 1) {
    const o0 = -HALF_WIDTH + (i * 2 * HALF_WIDTH) / 8;
    const o1 = -HALF_WIDTH + ((i + 1) * 2 * HALF_WIDTH) / 8;
    quad(0, 1, o0, o1, i % 2 ? PALETTE.ink : PALETTE.surface, 0.03);
    quad(1, 2, o0, o1, i % 2 ? PALETTE.surface : PALETTE.ink, 0.03);
  }
  if (showCoins) {
    for (const coin of layout.coins) {
      const offset = laneCentre(LANES.indexOf(coin.lane));
      quad(coin.at - 0.8, coin.at + 0.8, offset - 0.8, offset + 0.8, PALETTE.accent, 0.04);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}

// Without WebGL 2: a top-down outline of the track with dots for the cars, still stepped by the race.
class OutlineRaceView implements RaceView {
  private readonly context: CanvasRenderingContext2D;
  private readonly path: TrackPath;

  constructor(readonly canvas: HTMLCanvasElement, layoutId: LayoutId) {
    this.context = canvas.getContext("2d")!;
    this.path = trackPath(layoutId);
    canvas.width = 960;
    canvas.height = 600;
  }

  draw(frame: RaceFrame): void {
    const { context: g, path } = this;
    const b = bounds(path);
    const scale = Math.min((this.canvas.width - 80) / (b.maxX - b.minX), (this.canvas.height - 80) / (b.maxY - b.minY));
    const x = (px: number) => 40 + (px - b.minX) * scale;
    const y = (py: number) => this.canvas.height - 40 - (py - b.minY) * scale;
    g.fillStyle = "#f3ead3";
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.strokeStyle = "#1c1a16";
    g.lineWidth = 14;
    g.lineJoin = "round";
    g.beginPath();
    path.points.forEach((p, i) => (i ? g.lineTo(x(p.x), y(p.y)) : g.moveTo(x(p.x), y(p.y))));
    g.closePath();
    g.stroke();
    const dot = (mark: CarMark, fill: string, radius: number) => {
      const p = pointAt(path, mark.distance, mark.offset);
      g.fillStyle = fill;
      g.beginPath();
      g.arc(x(p.x), y(p.y), radius, 0, Math.PI * 2);
      g.fill();
    };
    if (frame.ghost) dot(frame.ghost, "rgba(28,26,22,0.35)", 9);
    frame.others.forEach((mark) => dot(mark, "#faf5e6", 8));
    dot(frame.player, "#b93e0b", 10);
  }

  dispose(): void {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

export function createRaceView(layoutId: LayoutId, mode: string): RaceView {
  const canvas = h("canvas", { role: "img", "aria-label": "Race view" });
  const renderer = webgl2Renderer(canvas);
  if (renderer) return new WebGlRaceView(canvas, renderer, layoutId, mode === "practice" || mode === "circuit");
  const flat = h("canvas", { role: "img", "aria-label": "Race view" });
  return new OutlineRaceView(flat, layoutId);
}

// Sideways offset of a lane's centre line (left is positive).
export function laneCentre(index: number): number {
  return (1 - index) * LANE_OFFSET;
}

export function laneOffset(lane: number, change: { target: number; done: number } | null, laneChangeSteps: number): number {
  if (!change) return laneCentre(lane);
  return laneCentre(lane) + (laneCentre(change.target) - laneCentre(lane)) * Math.min(1, change.done / laneChangeSteps);
}
