import {
  AdditiveBlending,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  type BufferGeometry,
  type Material,
} from "three";
import type { FlamePoints } from "./flames.js";
import { buildVision, type VisionChapter, type VisionModel } from "./visionModels.js";

const CHAPTERS: readonly VisionChapter[] = ["stove", "goose", "tree", "star", "grandmother"];

interface Loaded {
  model: VisionModel;
  placed: Group;
  riser: Group;
  meshes: Mesh[];
}

/** Where a vision stands: on the ground in front of the camera, facing it. */
interface Anchor {
  x: number;
  z: number;
  yaw: number;
}

const mesh = (
  geometry: BufferGeometry | null,
  material: Material,
  parent: Group,
  castShadow: boolean,
  receiveShadow: boolean,
): Mesh | null => {
  if (!geometry) return null;
  const item = new Mesh(geometry, material);
  item.castShadow = castShadow;
  item.receiveShadow = receiveShadow;
  parent.add(item);
  return item;
};

/**
 * The five visions, built once. One at a time is placed in front of the camera; `update` sets how far it has
 * risen out of the ground and writes its flames into the shared flame points.
 */
export class Visions {
  readonly group = new Group();
  private readonly loaded = new Map<VisionChapter, Loaded>();
  private readonly materials: Material[] = [];
  private current: VisionChapter | null = null;
  private anchor: Anchor = { x: 0, z: 0, yaw: 0 };

  constructor(private readonly flames: FlamePoints, private readonly firstSlot: number) {
    const matte = new MeshPhongMaterial({ vertexColors: true, shininess: 34, specular: 0x4a3c26 });
    const radiant = new MeshPhongMaterial({ vertexColors: true, shininess: 18, specular: 0x2a2418, emissive: 0x4a3f2c });
    const glow = new MeshBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false });
    this.materials.push(matte, radiant, glow);
    for (const chapter of CHAPTERS) {
      const model = buildVision(chapter);
      const placed = new Group();
      const riser = new Group();
      placed.add(riser);
      const meshes = [
        mesh(model.matte, matte, riser, true, true),
        mesh(model.radiant, radiant, riser, true, true),
        mesh(model.glow, glow, riser, model.glowCastsShadow, false),
      ].filter((item): item is Mesh => item !== null);
      placed.visible = false;
      this.group.add(placed);
      this.loaded.set(chapter, { model, placed, riser, meshes });
    }
  }

  /** Every flame slot a vision may use. */
  static get slots(): number {
    return 40;
  }

  /**
   * Makes `chapter` the standing vision (hiding the previous one), in front of a camera at `from` looking along
   * `yaw` (radians right of -Z), facing it.
   */
  place(chapter: VisionChapter, from: { x: number; z: number }, yaw: number, wide: boolean): void {
    if (this.current && this.current !== chapter) this.hideCurrent();
    this.current = chapter;
    const entry = this.loaded.get(chapter);
    if (!entry) return;
    const { model, placed } = entry;
    const aside = wide ? (model.aside ?? 0) : 0;
    this.anchor = {
      x: from.x + Math.sin(yaw) * model.distance + Math.cos(yaw) * aside,
      z: from.z - Math.cos(yaw) * model.distance + Math.sin(yaw) * aside,
      yaw,
    };
    placed.position.set(this.anchor.x, model.lift, this.anchor.z);
    placed.rotation.y = -yaw;
    placed.scale.setScalar(model.scale);
    placed.updateMatrixWorld(true);
  }

  /** Sets how far the vision has risen (0 hidden, 1 complete) and updates its flames. */
  update(amount: number): void {
    const chapter = this.current;
    const entry = chapter ? this.loaded.get(chapter) : undefined;
    if (!entry) {
      this.hideFlames(0);
      return;
    }
    const { model, placed, riser } = entry;
    const hidden = 1 - amount;
    riser.position.set(model.from.x * hidden, model.from.y * hidden, model.from.z * hidden);
    placed.visible = amount > 0.001;
    placed.updateMatrixWorld(true);
    const cosYaw = Math.cos(-this.anchor.yaw);
    const sinYaw = Math.sin(-this.anchor.yaw);
    const fade = Math.min(1, amount * 1.6);
    model.flames.forEach((flame, i) => {
      const lx = (flame.at.x + riser.position.x) * model.scale;
      const ly = (flame.at.y + riser.position.y) * model.scale + model.lift;
      const lz = (flame.at.z + riser.position.z) * model.scale;
      const x = this.anchor.x + lx * cosYaw + lz * sinYaw;
      const z = this.anchor.z - lx * sinYaw + lz * cosYaw;
      const slot = this.firstSlot + i;
      if (amount <= 0.001) this.flames.hide(slot);
      else this.flames.set(slot, { x, y: ly, z }, flame.size * model.scale, flame.alpha * fade, flame.kind);
    });
    this.hideFlames(model.flames.length);
  }

  private hideCurrent(): void {
    const previous = this.current ? this.loaded.get(this.current) : undefined;
    if (previous) previous.placed.visible = false;
    this.hideFlames(0);
  }

  private hideFlames(from: number): void {
    for (let i = from; i < Visions.slots; i += 1) this.flames.hide(this.firstSlot + i);
  }

  /** Shows or hides every vision, e.g. so shaders compile before the first strike. */
  setAllVisible(visible: boolean): void {
    for (const entry of this.loaded.values()) entry.placed.visible = visible;
  }
}
