import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PointLight,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from "three";
import { EDITION, PLATES, plateOf, type CellState } from "../../../shared/domain.js";
import { GeoBuilder } from "./builder.js";
import { FLAME, type FlamePoints } from "./flames.js";
import { FINAL_POSITION, FOV_DEG, SHELF_DISTANCE, SHELF_PLANE_Z } from "./path.js";
import type { HoldInput, ShelfLayout } from "./types.js";

const WALL_COLOR = "#11151d";
const MAX_FRAMES = 45;
const MATCH_LENGTH = 0.72;
const MATCH_BASE = -0.34;
const UNLIT_LENGTH = 0.5;
const TINTS = ["#f4f5f8", "#e6e9ef", "#e6ebe8", "#e9e8ee", "#eee9ec"];
const QUANTUM_MS = 10000;
/** Peak candela of the held match's light for a cell of one unit; scaled by the square of the cell size. */
const HELD_LIGHT = 22;
const HELD_COLOR = 0xffa24a;

/** Where the grid of boxes sits in the world: cell 1's top-left corner on the shelf plane and the cell size. */
interface Rig {
  x0: number;
  y0: number;
  size: number;
  columns: number;
  rows: number;
}

const boxGeometry = (): BufferGeometry => {
  const b = new GeoBuilder();
  b.box(0.82, 0.82, 0.5, "#454a54", { z: -0.3 });
  b.box(0.58, 0.3, 0.012, "#42464f", { y: -0.22, z: -0.046 });
  b.box(0.86, 0.34, 0.1, "#969ba6", { y: 0.25, z: -0.05 });
  b.box(0.87, 0.03, 0.02, "#070c17", { y: 0.075, z: -0.008 });
  b.box(0.14, 0.09, 0.03, "#adb1ba", { y: 0.075, z: 0.012 });
  return b.build();
};

const wedgeGeometry = (): BufferGeometry => {
  const shape = new Shape();
  shape.moveTo(0.47, 0.47);
  shape.lineTo(0.06, 0.47);
  shape.lineTo(0.47, 0.06);
  shape.closePath();
  const b = new GeoBuilder();
  b.add(new ExtrudeGeometry(shape, { depth: 0.26, bevelEnabled: false }), WALL_COLOR, { z: -0.2 });
  return b.build();
};

const unlitMatchGeometry = (): BufferGeometry => {
  const b = new GeoBuilder();
  b.add(new CylinderGeometry(0.042, 0.042, UNLIT_LENGTH, 8), "#c9ceda", { y: MATCH_BASE + UNLIT_LENGTH / 2, z: -0.02 });
  b.ball(0.1, "#141926", { y: MATCH_BASE + UNLIT_LENGTH + 0.02, z: -0.02 }, 1, 10);
  return b.build();
};

const matrix = new Matrix4();
const identity = new Quaternion();
const spot = new Vector3();
const sizeVector = new Vector3();
const tint = new Color();

/** The 240 boxes, their shelves and the standing matches, drawn with a handful of instanced meshes. */
export class Shelf {
  readonly group = new Group();
  private readonly boxes: InstancedMesh;
  private readonly wedges: InstancedMesh;
  private readonly matches: InstancedMesh;
  private readonly frames: InstancedMesh;
  private readonly wall: Mesh;
  private readonly stick: Mesh;
  private readonly head: Mesh;
  private readonly lambert = new MeshLambertMaterial({ vertexColors: true });
  private readonly wallMaterial = new MeshLambertMaterial({ color: WALL_COLOR });
  private readonly stickMaterial = new MeshLambertMaterial({ color: "#d9d2bd" });
  private readonly headMaterial = new MeshBasicMaterial({ color: 0xe0562b });
  private states: readonly CellState[] = [];
  private rigNow: Rig = { x0: 0, y0: 0, size: 1, columns: 20, rows: 12 };
  private holdNow: HoldInput | null = null;
  private lengthNow = 0;

  constructor(
    private readonly flames: FlamePoints,
    private readonly flameSlot: number,
    private readonly light: PointLight,
  ) {
    this.boxes = new InstancedMesh(boxGeometry(), this.lambert, EDITION);
    this.wedges = new InstancedMesh(wedgeGeometry(), this.lambert, EDITION);
    this.matches = new InstancedMesh(unlitMatchGeometry(), this.lambert, EDITION);
    this.frames = new InstancedMesh(new GeoBuilder().box(1, 1, 1, "#20252f").build(), this.lambert, MAX_FRAMES);
    this.wall = new Mesh(new BoxGeometry(160, 120, 2), this.wallMaterial);
    const stickGeometry = new CylinderGeometry(0.045, 0.045, 1, 8);
    stickGeometry.translate(0, 0.5, 0);
    this.stick = new Mesh(stickGeometry, this.stickMaterial);
    this.head = new Mesh(new SphereGeometry(0.1, 10, 8), this.headMaterial);
    this.stick.visible = false;
    this.head.visible = false;
    for (const part of [this.boxes, this.wedges, this.matches, this.frames]) {
      part.frustumCulled = false;
      this.group.add(part);
    }
    this.group.add(this.wall, this.stick, this.head);
    this.wedges.count = 0;
    this.matches.count = 0;
    this.light.intensity = 0;
  }

  /** The centre of box `index` (0-based) on the rig, before the rig slides. */
  private boxCenter(index: number, into: Vector3): Vector3 {
    const { x0, y0, size, columns } = this.rigNow;
    const column = index % columns;
    const row = Math.floor(index / columns);
    return into.set(x0 + (column + 0.5) * size, y0 - (row + 0.5) * size, SHELF_PLANE_Z);
  }

  /** The world position of the centre of box `index` (0-based) on the shelf plane. */
  cellCenter(index: number, into: Vector3): Vector3 {
    this.boxCenter(index, into);
    into.y += this.group.position.y;
    return into;
  }

  /** Slides the whole rig up, in step with the DOM grid's own scrolling; the camera stays on its path. */
  slideTo(height: number): void {
    if (height === this.group.position.y) return;
    this.group.position.y = height;
    this.syncMatch();
  }

  /** Places the rig so that, from the final camera pose, cell 1 covers the DOM grid's first cell. */
  setLayout(layout: ShelfLayout, viewportWidth: number, viewportHeight: number): void {
    const perUnit = viewportHeight / (2 * SHELF_DISTANCE * Math.tan((FOV_DEG * Math.PI) / 360));
    const size = layout.cellPx / perUnit;
    this.rigNow = {
      x0: FINAL_POSITION.x + (layout.left - viewportWidth / 2) / perUnit,
      y0: FINAL_POSITION.y - (layout.top - viewportHeight / 2) / perUnit,
      size,
      columns: layout.columns,
      rows: layout.rows,
    };
    this.placeBoxes();
    this.placeFrames();
    this.wall.position.set(0, -10, SHELF_PLANE_Z - 0.62 * size - 1);
    this.applyStates();
    this.syncMatch();
  }

  setBoxes(states: readonly CellState[]): void {
    this.states = states;
    this.applyStates();
  }

  setHold(hold: HoldInput | null, quantised: boolean): void {
    this.holdNow = hold;
    const fraction = hold && hold.holdMs > 0 ? Math.min(1, Math.max(0, hold.remainingMs / hold.holdMs)) : 0;
    if (!hold || !quantised) this.lengthNow = fraction;
    else this.lengthNow = Math.min(1, (Math.ceil(hold.remainingMs / QUANTUM_MS) * QUANTUM_MS) / hold.holdMs);
    this.syncMatch();
  }

  get matchLit(): boolean {
    return this.holdNow !== null && this.lengthNow > 0;
  }

  /** Shows the lit match's parts (true) or puts them back as the hold says (false), e.g. to draw them once in advance. */
  warm(on: boolean): void {
    if (on) {
      this.stick.visible = true;
      this.head.visible = true;
    } else this.syncMatch();
  }

  /** Sets the held match's light, with `wobble` (-1..1) as the flicker. */
  flicker(wobble: number): void {
    if (!this.matchLit) {
      this.light.intensity = 0;
      return;
    }
    const size = this.rigNow.size;
    this.light.intensity = HELD_LIGHT * size * size * (1 + 0.1 * wobble);
  }

  private placeBoxes(): void {
    const { size } = this.rigNow;
    for (let i = 0; i < EDITION; i += 1) {
      this.boxCenter(i, spot);
      matrix.compose(spot, identity, sizeVector.set(size, size, size));
      this.boxes.setMatrixAt(i, matrix);
    }
    this.boxes.instanceMatrix.needsUpdate = true;
  }

  private placeFrames(): void {
    const { x0, y0, size, columns, rows } = this.rigNow;
    const width = columns * size;
    let count = 0;
    const put = (x: number, y: number, z: number, w: number, h: number, d: number): void => {
      matrix.compose(spot.set(x, y, z), identity, sizeVector.set(w, h, d));
      this.frames.setMatrixAt(count, matrix);
      count += 1;
    };
    for (let r = 0; r <= rows; r += 1) put(x0 + width / 2, y0 - r * size, SHELF_PLANE_Z - 0.3 * size, width + 0.5 * size, 0.09 * size, 0.8 * size);
    put(x0 - 0.12 * size, y0 - (rows * size) / 2, SHELF_PLANE_Z - 0.3 * size, 0.24 * size, rows * size + 0.7 * size, 0.9 * size);
    put(x0 + width + 0.12 * size, y0 - (rows * size) / 2, SHELF_PLANE_Z - 0.3 * size, 0.24 * size, rows * size + 0.7 * size, 0.9 * size);
    this.frames.count = count;
    this.frames.instanceMatrix.needsUpdate = true;
  }

  private applyStates(): void {
    const { size } = this.rigNow;
    let taken = 0;
    let held = 0;
    for (let i = 0; i < EDITION; i += 1) {
      const state = this.states[i] ?? "available";
      this.boxCenter(i, spot);
      if (state === "taken") {
        matrix.compose(spot, identity, sizeVector.set(size, size, size));
        this.wedges.setMatrixAt(taken, matrix);
        taken += 1;
      } else if (state === "held") {
        matrix.compose(spot, identity, sizeVector.set(size, size, size));
        this.matches.setMatrixAt(held, matrix);
        held += 1;
      }
      tint.set(TINTS[PLATES.indexOf(plateOf(i + 1))] ?? "#ffffff");
      if (state === "taken") tint.multiplyScalar(0.72);
      this.boxes.setColorAt(i, tint);
    }
    this.wedges.count = taken;
    this.matches.count = held;
    this.wedges.instanceMatrix.needsUpdate = true;
    this.matches.instanceMatrix.needsUpdate = true;
    if (this.boxes.instanceColor) this.boxes.instanceColor.needsUpdate = true;
  }

  /** Stands the lit match on the held box, as long as the remaining time says, and moves its light and flame. */
  private syncMatch(): void {
    const hold = this.holdNow;
    const index = hold ? hold.number - 1 : -1;
    const lit = hold !== null && index >= 0 && index < EDITION && this.lengthNow > 0;
    this.stick.visible = lit;
    this.head.visible = lit;
    if (!lit) {
      this.flames.hide(this.flameSlot);
      this.light.intensity = 0;
      return;
    }
    const { size } = this.rigNow;
    this.boxCenter(index, spot);
    const length = MATCH_LENGTH * this.lengthNow;
    this.stick.position.set(spot.x, spot.y + MATCH_BASE * size, spot.z - 0.02 * size);
    this.stick.scale.set(size, length * size, size);
    this.head.position.set(spot.x, spot.y + (MATCH_BASE + length) * size + 0.02 * size, spot.z - 0.02 * size);
    this.head.scale.setScalar(size);
    const flameY = spot.y + (MATCH_BASE + length) * size + 0.2 * size;
    const worldFlameY = flameY + this.group.position.y;
    this.flames.set(this.flameSlot, { x: spot.x, y: worldFlameY, z: spot.z + 0.08 * size }, 0.62 * size, 1, FLAME);
    this.light.position.set(spot.x, worldFlameY, spot.z + 0.55 * size);
    this.light.distance = 4.6 * size;
    this.light.decay = 2;
    this.light.color.set(HELD_COLOR);
  }
}
