import { BufferGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { BUNDLE_MATCHES } from "../../../shared/domain.js";
import { GeoBuilder } from "./builder.js";
import { FLAME, GLOW, type FlamePoints } from "./flames.js";
import { FOV_DEG } from "./path.js";

const HAND_DEPTH = 0.72;
const FLAME_SIZE = 0.07;
const STICK_LENGTH = 0.17;
/** How far the stick runs on below the fan point, out of the bottom of the view. */
const STICK_TAIL = 0.14;
const FAN = 0.32;

const spreadOf = (index: number, count: number): number =>
  count === 1 ? 0 : ((index - (count - 1) / 2) / ((count - 1) / 2)) * FAN;

const sticksFor = (count: number): BufferGeometry => {
  const b = new GeoBuilder();
  for (let i = 0; i < count; i += 1) {
    const spread = spreadOf(i, count);
    const tip = { x: Math.sin(spread) * STICK_LENGTH, y: Math.cos(spread) * STICK_LENGTH, z: ((i % 3) - 1) * 0.006 };
    const middle = (STICK_LENGTH - STICK_TAIL) / 2;
    b.cylinder(0.0028, 0.0028, STICK_LENGTH + STICK_TAIL, "#b8a982", { x: Math.sin(spread) * middle, y: Math.cos(spread) * middle, z: tip.z, rz: -spread }, 6);
    b.ball(0.006, "#6a2c20", tip, 1, 8);
  }
  if (count > 1) b.cylinder(0.012, 0.012, 0.02, "#8a2a32", { y: 0.05 }, 8);
  return b.build();
};

const tipOf = (index: number, count: number, into: Vector3): Vector3 => {
  const spread = spreadOf(index, count);
  return into.set(Math.sin(spread) * STICK_LENGTH, Math.cos(spread) * STICK_LENGTH + FLAME_SIZE * 0.4, ((index % 3) - 1) * 0.006);
};

const local = new Vector3();

/**
 * The match (or the bundle of twelve) in the reader's hand at the lower right of the view. It is a child of the
 * camera, so it is always where the reader's hand is; its flames are the visible, flickering ones.
 */
export class HandMatches {
  readonly group = new Group();
  private readonly single: Mesh;
  private readonly bundle: Mesh;
  private readonly material = new MeshBasicMaterial({ vertexColors: true });
  private count = 0;

  constructor(private readonly flames: FlamePoints, private readonly firstSlot: number) {
    this.single = new Mesh(sticksFor(1), this.material);
    this.bundle = new Mesh(sticksFor(BUNDLE_MATCHES), this.material);
    for (const item of [this.single, this.bundle]) {
      item.visible = false;
      item.frustumCulled = false;
      this.group.add(item);
    }
    this.group.rotation.z = 0.3;
  }

  /** The most flames that can be lit at once. */
  static get slots(): number {
    return BUNDLE_MATCHES;
  }

  /** How many matches are lit right now. */
  get lit(): number {
    return this.count;
  }

  /**
   * The light's place, in world space: above and a little outside the flames, as if the hand held the match out,
   * so the visions throw their shadows across the ground to the side. The camera's world matrix must be current.
   */
  lightAt(into: Vector3): Vector3 {
    return this.group.localToWorld(into.set(0.12, STICK_LENGTH + 0.55, 0.05));
  }

  /** Puts the hand at the lower right corner of the view for this aspect ratio. */
  layout(aspect: number): void {
    const halfHeight = Math.tan((FOV_DEG * Math.PI) / 360) * HAND_DEPTH;
    this.group.position.set(halfHeight * Math.min(aspect, 1.6) * (aspect < 1 ? 1.1 : 0.62), -halfHeight * 0.95, -HAND_DEPTH);
  }

  /**
   * Shows the flames of `matches` lit matches (0, 1 or 12). `size` is the flame's growth 0..1 through the flare,
   * with 0 meaning only the strike's spark (`spark`, 0..1) shows. The camera's world matrix must be current.
   */
  update(matches: number, size: number, spark: number): void {
    this.count = matches;
    this.single.visible = matches === 1;
    this.bundle.visible = matches === BUNDLE_MATCHES;
    this.group.updateMatrixWorld(true);
    for (let i = 0; i < BUNDLE_MATCHES; i += 1) {
      const slot = this.firstSlot + i;
      if (i >= matches) {
        this.flames.hide(slot);
        continue;
      }
      const at = this.group.localToWorld(tipOf(i, matches, local));
      if (size === 0) this.flames.set(slot, at, FLAME_SIZE * 1.1 * spark, 1, GLOW);
      else this.flames.set(slot, at, FLAME_SIZE * (0.35 + 0.65 * size) * (matches > 1 ? 0.75 : 1), matches > 1 ? 0.8 : 1, FLAME);
    }
  }
}
