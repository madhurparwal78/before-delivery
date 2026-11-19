import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Shape,
  Vector3,
  WebGLRenderer,
} from "three";
import type { Layout, PersonView } from "../../shared/protocol";

const INK = 0x23303b;
const COLORS = { tileA: 0xf1e6c8, tileB: 0xe8dab4, wall: 0xb7a58a, stool: 0xd9b98c, accent: 0xf2b632, calm: 0x3f9086, ground: 0xf7f0df, plain: 0xb8b2a2 };
const FIGURES = [0x6f879b, 0x8da58b, 0xc98b84];
const GLIDE_MS = 200;
const CAMERA_MS = 400;
const CAMERA_MARGIN = 4.5;
const CAMERA_OFFSET = new Vector3(5, 10, 10);
const FACING_TURN = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 } as const;

const centre = (x: number, y: number, height = 0): Vector3 => new Vector3(x + 0.5, height, y + 0.5);
const easeOut = (t: number): number => 1 - (1 - t) ** 3;

/** Ink edge lines for many copies of one box, merged into one draw. */
function edgeLines(box: BoxGeometry, spots: Vector3[], opacity = 1): LineSegments {
  const edges = new EdgesGeometry(box).getAttribute("position");
  const positions: number[] = [];
  for (const spot of spots) {
    for (let index = 0; index < edges.count; index += 1) {
      positions.push(edges.getX(index) + spot.x, edges.getY(index) + spot.y, edges.getZ(index) + spot.z);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return new LineSegments(geometry, new LineBasicMaterial({ color: INK, transparent: opacity < 1, opacity }));
}

function instanced(geometry: BufferGeometry, color: number, spots: Vector3[], emissive = 0): InstancedMesh {
  const mesh = new InstancedMesh(geometry, new MeshLambertMaterial({ color, emissive }), Math.max(spots.length, 1));
  const matrix = new Matrix4();
  spots.forEach((spot, index) => mesh.setMatrixAt(index, matrix.makeTranslation(spot.x, spot.y, spot.z)));
  mesh.count = spots.length;
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/** A flat paper figure: a round head on a rounded body, cut out and given thickness. */
function figureGeometry(): ExtrudeGeometry {
  const shape = new Shape();
  shape.moveTo(-0.22, 0);
  shape.lineTo(0.22, 0);
  shape.quadraticCurveTo(0.27, 0.5, 0.12, 0.62);
  shape.absarc(0, 0.78, 0.17, -0.55, Math.PI + 0.55, false);
  shape.quadraticCurveTo(-0.27, 0.5, -0.22, 0);
  return new ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false }).translate(0, 0, -0.04);
}

interface Walker {
  group: Group;
  figure: Group;
  from: Vector3;
  to: Vector3;
  startedAt: number;
}

export class RoomScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(36, 1, 0.1, 200);
  private readonly lookAt = new Vector3();
  private cameraFrom = new Vector3();
  private cameraTo = new Vector3();
  private cameraStart = 0;
  private readonly stage = new Group();
  private readonly walkers = new Map<string, Walker>();
  private readonly figure = figureGeometry();
  private readonly figureEdges = new EdgesGeometry(this.figure, 40);
  private ripple = new Group();
  private frame = 0;
  private layoutKey = "";
  private size = { width: 12, height: 12 };
  private reduced = false;
  private selfId = "";
  private placed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    if (!canvas.getContext("webgl2") && !canvas.getContext("webgl")) throw new Error("WebGL is not available");
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(COLORS.ground);
    this.scene.add(new AmbientLight(0xffffff, 1.55));
    const sun = new DirectionalLight(0xfff1d6, 1.4);
    sun.position.set(-4, 10, 6);
    this.scene.add(sun, this.stage);
    this.resize();
  }

  setReduced(reduced: boolean): void {
    this.reduced = reduced;
  }

  /** Builds the floor, walls, stools and exits of one room version, once per layout. */
  setLayout(layout: Layout): void {
    const key = JSON.stringify(layout);
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.size = { width: layout.width, height: layout.height };
    this.stage.clear();
    this.stage.add(this.ripple);
    const tile = new BoxGeometry(0.96, 0.12, 0.96);
    const floorA: Vector3[] = [];
    const floorB: Vector3[] = [];
    for (let y = 0; y < layout.height; y += 1) {
      for (let x = 0; x < layout.width; x += 1) (((x + y) % 2 === 0 ? floorA : floorB).push(centre(x, y, -0.06)));
    }
    const under = new Mesh(new PlaneGeometry(layout.width, layout.height).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0xcdbf9a }));
    under.position.set(layout.width / 2, -0.125, layout.height / 2);
    this.stage.add(under, instanced(tile, COLORS.tileA, floorA), instanced(tile, COLORS.tileB, floorB), edgeLines(tile, [...floorA, ...floorB], 0.28));

    const block = new BoxGeometry(0.96, 1.15, 0.96);
    const walls = layout.walls.map((wall) => centre(wall.x, wall.y, 0.575));
    const stool = new BoxGeometry(0.62, 0.3, 0.62);
    const stools = layout.seats.map((seat) => centre(seat.x, seat.y, 0.15));
    const back = new BoxGeometry(0.62, 0.5, 0.08);
    const backs = layout.seats.map((seat) => new Vector3(seat.x + 0.5, 0.25, seat.y + 0.2));
    const exits = layout.exits.map((exit) => centre(exit.x, exit.y, 0.07));
    const exitTile = new BoxGeometry(0.96, 0.14, 0.96);
    this.stage.add(
      instanced(block, COLORS.wall, walls),
      edgeLines(block, walls),
      instanced(stool, COLORS.stool, stools),
      edgeLines(stool, stools),
      instanced(back, COLORS.stool, backs),
      edgeLines(back, backs),
      instanced(exitTile, COLORS.accent, exits, 0x6b4a08),
      edgeLines(exitTile, exits),
    );
    const shadows = new InstancedMesh(new PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.22 }), Math.max(walls.length + stools.length, 1));
    const matrix = new Matrix4();
    [...walls, ...stools].forEach((spot, index) => shadows.setMatrixAt(index, matrix.makeTranslation(spot.x + 0.16, 0.004, spot.z + 0.16)));
    shadows.count = walls.length + stools.length;
    this.stage.add(shadows);
    this.walkers.forEach((walker) => this.stage.add(walker.group));
    this.draw();
  }

  /** Puts each person on their tile; a glide eases to the new tile unless motion is reduced. */
  setPeople(people: PersonView[], selfId: string): void {
    this.selfId = selfId;
    const now = performance.now();
    const present = new Set(people.map((person) => person.personId));
    for (const [id, walker] of this.walkers) {
      if (present.has(id)) continue;
      this.stage.remove(walker.group);
      this.walkers.delete(id);
    }
    for (const person of people) {
      const target = centre(person.x, person.y, person.seated ? 0.18 : 0);
      let walker = this.walkers.get(person.personId);
      if (!walker) {
        walker = this.makeWalker(person);
        walker.group.position.copy(target);
        this.walkers.set(person.personId, walker);
        this.stage.add(walker.group);
      }
      this.dress(walker, person);
      if (!walker.to.equals(target)) {
        walker.from.copy(walker.group.position);
        walker.to.copy(target);
        walker.startedAt = now;
        if (this.reduced) walker.group.position.copy(target);
      }
      walker.group.rotation.y = FACING_TURN[person.facing];
    }
    const me = this.walkers.get(selfId);
    if (me) {
      // The camera follows the avatar but stays far enough inside the room to keep its walls and floor in frame.
      const focus = me.to.clone();
      focus.x = Math.min(Math.max(focus.x, Math.min(CAMERA_MARGIN, this.size.width / 2)), Math.max(this.size.width - CAMERA_MARGIN, this.size.width / 2));
      focus.z = Math.min(Math.max(focus.z, Math.min(CAMERA_MARGIN, this.size.height / 2)), Math.max(this.size.height - CAMERA_MARGIN, this.size.height / 2));
      if (!this.placed || this.reduced) {
        this.lookAt.copy(focus);
        this.cameraFrom.copy(focus);
        this.cameraTo.copy(focus);
        this.placed = true;
      } else if (!this.cameraTo.equals(focus)) {
        this.cameraFrom.copy(this.lookAt);
        this.cameraTo.copy(focus);
        this.cameraStart = now;
      }
      this.aim();
    }
    this.draw();
    this.animate();
  }

  private makeWalker(person: PersonView): Walker {
    const group = new Group();
    const own = person.personId === this.selfId;
    const base = new Mesh(new CylinderGeometry(0.42, 0.42, 0.09, 28), new MeshLambertMaterial({ color: own ? COLORS.accent : COLORS.plain }));
    base.position.y = 0.04;
    const rim = new LineSegments(new EdgesGeometry(base.geometry, 40), new LineBasicMaterial({ color: INK }));
    rim.position.y = 0.04;
    const nose = new Mesh(new BoxGeometry(0.14, 0.06, 0.2), new MeshLambertMaterial({ color: INK }));
    nose.position.set(0, 0.1, 0.36);
    const figure = new Group();
    figure.position.y = 0.09;
    figure.scale.setScalar(1.45);
    group.add(base, rim, nose, figure);
    return { group, figure, from: new Vector3(), to: new Vector3(), startedAt: 0 };
  }

  /** Dresses the figure for its state: a coloured paper cut-out, a plain grey one, or only the base. */
  private dress(walker: Walker, person: PersonView): void {
    walker.figure.clear();
    walker.figure.visible = person.avatar !== "hidden";
    const base = walker.group.children[0] as Mesh;
    (base.material as MeshLambertMaterial).color.set(person.personId === this.selfId ? COLORS.accent : COLORS.plain);
    if (person.avatar === "hidden") return;
    const colour = person.avatar === "fallback" ? COLORS.plain : (FIGURES[[...person.personId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % FIGURES.length] ?? COLORS.plain);
    const body = new Mesh(this.figure, new MeshLambertMaterial({ color: new Color(colour) }));
    const outline = new LineSegments(this.figureEdges, new LineBasicMaterial({ color: INK }));
    walker.figure.add(body, outline);
    walker.figure.scale.set(1.45, person.seated ? 1.0 : 1.45, 1.45);
  }

  /** Square ring of tinted tiles around a tile, clipped by the room's edge. */
  setRipple(at: { x: number; y: number } | null, radius: number, mode: "growing" | "outline" | "none", layout: Layout): void {
    this.stage.remove(this.ripple);
    this.ripple = new Group();
    this.stage.add(this.ripple);
    if (at && mode !== "none") {
      const ring: Vector3[] = [];
      const wake: Vector3[] = [];
      for (let y = Math.max(0, at.y - radius); y <= Math.min(layout.height - 1, at.y + radius); y += 1) {
        for (let x = Math.max(0, at.x - radius); x <= Math.min(layout.width - 1, at.x + radius); x += 1) {
          const edge = Math.max(Math.abs(x - at.x), Math.abs(y - at.y)) === radius;
          const raised = layout.walls.some((wall) => wall.x === x && wall.y === y) ? 1.18 : 0.03;
          (edge ? ring : wake).push(centre(x, y, raised));
        }
      }
      const slab = new BoxGeometry(0.96, 0.05, 0.96);
      const tint = (spots: Vector3[], opacity: number): InstancedMesh => {
        const mesh = instanced(slab, COLORS.calm, spots);
        mesh.material = new MeshBasicMaterial({ color: COLORS.calm, transparent: true, opacity });
        return mesh;
      };
      this.ripple.add(tint(ring, 0.88), edgeLines(slab, ring));
      if (mode === "growing") this.ripple.add(tint(wake, 0.32));
    }
    this.draw();
  }

  resize(): void {
    const width = this.canvas.clientWidth || 640;
    const height = this.canvas.clientHeight || 400;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  private aim(): void {
    this.camera.position.copy(this.lookAt).add(CAMERA_OFFSET);
    this.camera.lookAt(this.lookAt);
  }

  draw(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Glides and the camera settle on animation frames only while something is still moving. */
  private animate(): void {
    if (this.frame || this.reduced) return;
    const step = (now: number): void => {
      this.frame = 0;
      let moving = false;
      for (const walker of this.walkers.values()) {
        const t = Math.min(1, (now - walker.startedAt) / GLIDE_MS);
        if (walker.group.position.distanceToSquared(walker.to) > 1e-6) {
          walker.group.position.lerpVectors(walker.from, walker.to, easeOut(t));
          moving = moving || t < 1;
        }
      }
      if (this.lookAt.distanceToSquared(this.cameraTo) > 1e-6) {
        const t = Math.min(1, (now - this.cameraStart) / CAMERA_MS);
        this.lookAt.lerpVectors(this.cameraFrom, this.cameraTo, easeOut(t));
        moving = moving || t < 1;
        this.aim();
      }
      this.draw();
      if (moving) this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  dispose(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.renderer.dispose();
  }
}
