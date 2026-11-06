// The crate drawn with Three.js. One WebGL context serves the whole document: it draws on a canvas
// that is never on the page, and each crate copies its picture into its own 2D canvas.
import {
  AmbientLight, BoxGeometry, CanvasTexture, CircleGeometry, ColorManagement, CylinderGeometry, DirectionalLight,
  EdgesGeometry, Group, LinearFilter, LinearSRGBColorSpace, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, PlaneGeometry, Scene, WebGLRenderer,
} from "three";
import {
  BOX, type CrateView, LID_OPEN_DEG, palette, slotSpot, type StampKind, type Tone, unitRadius, unitShape,
} from "./model.js";
import type { Pose } from "./pose.js";
import { homeCamera } from "./camera.js";
import { displayFaceReady, kraftCanvas, stampCanvas } from "./textures.js";

ColorManagement.enabled = false;

const INSIDE = "#ebddbc";
const SLOT_MARK = "#d8c698";
const INK = "#1e1a15";
const EDGE_EPSILON = 0.004;

/** The shared renderer. Null when the browser offers no WebGL. */
export class GlRenderer {
  readonly renderer: WebGLRenderer;
  readonly camera = homeCamera(4 / 3);
  private size = { w: 0, h: 0 };

  private constructor(readonly canvas: HTMLCanvasElement, context: WebGL2RenderingContext) {
    this.renderer = new WebGLRenderer({ canvas, context, alpha: true, antialias: true });
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x000000, 0);
  }

  static create(): GlRenderer | null {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2", { alpha: true, antialias: true, depth: true, stencil: false });
    if (!context) return null;
    return new GlRenderer(canvas, context);
  }

  /** Draws one crate into the corner of the shared canvas and copies it to the crate's own canvas. */
  draw(scene: CrateScene, pose: Pose, turn: number, target: HTMLCanvasElement): void {
    const { width: w, height: h } = target;
    if (w > this.size.w || h > this.size.h) {
      this.size = { w: Math.max(w, this.size.w), h: Math.max(h, this.size.h) };
      this.renderer.setSize(this.size.w, this.size.h, false);
    }
    scene.update(pose, turn);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.setScissor(0, 0, w, h);
    this.renderer.setScissorTest(true);
    this.renderer.clear();
    this.renderer.render(scene.root, this.camera);
    const ctx = target.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.canvas, 0, this.size.h - h, w, h, 0, 0, w, h);
  }
}

// ---- Shared materials, geometry and textures ------------------------------------------------------

let shared: {
  inside: MeshBasicMaterial;
  slot: MeshBasicMaterial;
  edge: LineBasicMaterial;
  tops: Record<Tone, MeshBasicMaterial>;
  walls: MeshBasicMaterial[];
  lidTop: MeshBasicMaterial;
  stamps: Partial<Record<StampKind, MeshBasicMaterial>>;
} | null = null;

function wallMaterial(base: string, tape: "none" | "across"): MeshBasicMaterial {
  return new MeshBasicMaterial({ map: new CanvasTexture(kraftCanvas(base, "#6b4f2a", tape)) });
}

function materials() {
  if (shared) return shared;
  const colours = palette();
  shared = {
    inside: new MeshBasicMaterial({ color: INSIDE }),
    slot: new MeshBasicMaterial({ color: SLOT_MARK }),
    edge: new LineBasicMaterial({ color: INK }),
    tops: {
      mine: new MeshBasicMaterial({ color: colours.mine }),
      taken: new MeshBasicMaterial({ color: colours.taken }),
      dropped: new MeshBasicMaterial({ color: colours.dropped }),
    },
    walls: [wallMaterial("#b78f58", "across"), wallMaterial("#a5814e", "none")],
    lidTop: new MeshBasicMaterial({ map: new CanvasTexture(kraftCanvas("#c4a063", "#6b4f2a", "across")) }),
    stamps: {},
  };
  return shared;
}

/** The stamp's material, once the display face has loaded; until then there is no lettering. */
function stampMaterial(kind: StampKind): MeshBasicMaterial | null {
  const m = materials();
  if (!m.stamps[kind]) {
    if (!displayFaceReady()) return null;
    const map = new CanvasTexture(stampCanvas(kind));
    map.generateMipmaps = false;
    map.minFilter = LinearFilter;
    m.stamps[kind] = new MeshBasicMaterial({ map, transparent: true, depthWrite: false });
  }
  return m.stamps[kind]!;
}

const bodies = new Map<string, MeshLambertMaterial>();

function bodyMaterial(colour: string): MeshLambertMaterial {
  let found = bodies.get(colour);
  if (!found) {
    found = new MeshLambertMaterial({ color: colour });
    bodies.set(colour, found);
  }
  return found;
}

const geometries = new Map<string, import("three").BufferGeometry>();

function cached<T extends import("three").BufferGeometry>(key: string, make: () => T): T {
  let found = geometries.get(key);
  if (!found) {
    found = make();
    geometries.set(key, found);
  }
  return found as T;
}

const flat = (w: number, h: number) => cached(`plane-${w}-${h}`, () => new PlaneGeometry(w, h));
const lying = (w: number, h: number) => cached(`lying-${w}-${h}`, () => new PlaneGeometry(w, h).rotateX(-Math.PI / 2));

// ---- One crate's scene ----------------------------------------------------------------------------

export class CrateScene {
  readonly root = new Scene();
  private readonly turner = new Group();
  private readonly units: { group: Group; top: Mesh }[] = [];
  private readonly lid = new Group();
  private readonly stampLid = new Mesh(lying(2.4, 0.9));
  private readonly stampFront = new Mesh(flat(2.5, 0.94));

  constructor(view: CrateView) {
    const m = materials();
    const { w, d, h } = BOX;
    this.root.add(new AmbientLight(0xffffff, 2.8), new DirectionalLight(0xffffff, 1.6).translateX(-3).translateY(6).translateZ(5));
    this.root.add(this.turner);

    const floor = new Mesh(lying(w, d), m.inside);
    floor.position.y = 0.002;
    this.turner.add(floor);

    // four walls, each with a kraft outside and a light inside
    const wall = (width: number, outer: MeshBasicMaterial, x: number, z: number, turn: number) => {
      const out = new Mesh(flat(width, h), outer);
      out.position.set(x, h / 2, z);
      out.rotation.y = turn;
      const inner = new Mesh(flat(width, h), m.inside);
      inner.position.set(x - Math.sin(turn) * EDGE_EPSILON, h / 2, z - Math.cos(turn) * EDGE_EPSILON);
      inner.rotation.y = turn + Math.PI;
      this.turner.add(out, inner);
    };
    wall(w, m.walls[0]!, 0, d / 2, 0);
    wall(w, m.walls[1]!, 0, -d / 2, Math.PI);
    wall(d, m.walls[1]!, w / 2, 0, Math.PI / 2);
    wall(d, m.walls[1]!, -w / 2, 0, -Math.PI / 2);
    const edges = new LineSegments(cached("box-edges", () => new EdgesGeometry(new BoxGeometry(w, h, d))), m.edge);
    edges.position.y = h / 2;
    // the floor meets the walls: a thin ink line round the inside makes the box read as a box
    const joint = new LineSegments(cached("floor-edges", () => new EdgesGeometry(new BoxGeometry(w - 0.02, 0.004, d - 0.02))), m.edge);
    joint.position.y = 0.004;
    this.turner.add(edges, joint);

    // slots and the units that stand in them
    const r = unitRadius(view.cols, view.rows);
    const shape = unitShape(view.unit, r);
    view.slots.forEach((_, i) => {
      const spot = slotSpot(i, view.cols, view.rows);
      const mark = new Mesh(cached(`mark-${r}`, () => new CircleGeometry(r * 1.05, 24).rotateX(-Math.PI / 2)), m.slot);
      mark.position.set(spot.x, 0.005, spot.z);
      const group = new Group();
      group.position.set(spot.x, 0, spot.z);
      for (const part of shape.parts) {
        const geometry =
          part.shape === "cyl"
            ? cached(`cyl-${part.r}-${part.y1 - part.y0}`, () => new CylinderGeometry(part.r, part.r, part.y1 - part.y0, 20))
            : cached(`box-${part.w}-${part.d}-${part.y1 - part.y0}`, () => new BoxGeometry(part.w, part.y1 - part.y0, part.d));
        const mesh = new Mesh(geometry, bodyMaterial(part.body));
        mesh.position.set(part.shape === "cyl" ? (part.dx ?? 0) : 0, (part.y0 + part.y1) / 2, 0);
        group.add(mesh);
      }
      const topGeometry =
        shape.top.shape === "disc"
          ? cached(`disc-${shape.top.r}`, () => new CircleGeometry(shape.top.r, 24).rotateX(-Math.PI / 2))
          : lying(2 * shape.top.r, 2 * shape.top.r);
      const top = new Mesh(topGeometry, m.tops.mine);
      top.position.y = shape.top.y;
      group.add(top);
      this.units.push({ group, top });
      this.turner.add(mark, group);
    });

    // the lid hinges on the back edge and swings shut over the units
    const lidOuter = new Mesh(lying(w, d), m.lidTop);
    lidOuter.position.set(0, 0.008, d / 2);
    const lidInner = new Mesh(cached(`lying-under-${w}-${d}`, () => new PlaneGeometry(w, d).rotateX(Math.PI / 2)), m.inside);
    lidInner.position.set(0, -0.004, d / 2);
    const lidEdges = new LineSegments(cached("lid-edges", () => new EdgesGeometry(new BoxGeometry(w, 0.012, d))), m.edge);
    lidEdges.position.set(0, 0.002, d / 2);
    this.stampLid.position.set(0, 0.016, d / 2);
    this.stampLid.rotation.y = 0;
    this.lid.add(lidOuter, lidInner, lidEdges, this.stampLid);
    this.lid.position.set(0, h + 0.012, -d / 2);
    this.turner.add(this.lid);

    this.stampFront.position.set(0, h / 2, d / 2 + 0.012);
    this.turner.add(this.stampFront);
  }

  /** Arranges the scene for a pose and a turn; units take their top colours from the pose. */
  update(pose: Pose, turn: number): void {
    const m = materials();
    this.turner.rotation.y = (turn * Math.PI) / 180;
    pose.slots.forEach((slot, i) => {
      const unit = this.units[i]!;
      unit.group.visible = slot.tone !== null;
      unit.group.position.y = slot.lift;
      if (slot.tone) unit.top.material = m.tops[slot.tone];
    });
    this.lid.visible = pose.lidShown;
    this.lid.rotation.x = -((LID_OPEN_DEG * Math.PI) / 180) * (1 - pose.lid);
    const stamp = pose.stamp;
    const material = stamp ? stampMaterial(stamp.kind) : null;
    const onFront = stamp?.kind === "dropped";
    this.stampLid.visible = material !== null && !onFront && pose.lidShown;
    this.stampFront.visible = material !== null && onFront;
    if (stamp && material) {
      material.opacity = stamp.alpha;
      this.stampLid.material = material;
      this.stampLid.scale.set(stamp.scale, 1, stamp.scale);
      this.stampFront.material = material;
      this.stampFront.scale.set(stamp.scale, stamp.scale, 1);
    }
  }

  dispose(): void {
    this.root.clear();
  }
}
