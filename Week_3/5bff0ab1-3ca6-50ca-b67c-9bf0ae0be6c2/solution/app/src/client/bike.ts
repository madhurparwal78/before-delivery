import * as THREE from "three";
import type { ChapterId, ModelId } from "../shared/catalogue.js";

/**
 * The machine, drawn from primitives alone. Forward is +X, up is +Y and the rider's left is -Z. Every shaded surface uses
 * one flat-shaded material that writes its colour straight to the framebuffer, so a painted pixel facing the light is
 * exactly the colour the reading asks for.
 */
THREE.ColorManagement.enabled = false;

export const GROUND_RGB = [24, 25, 27] as const;
const LIGHT = new THREE.Vector3(0.25, 1, -0.2).normalize();
const rgb = (c: readonly number[]): THREE.Color => new THREE.Color(c[0]! / 255, c[1]! / 255, c[2]! / 255);

const VERTEX = `
varying vec3 vN; varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAGMENT = `
uniform vec3 uColor; uniform vec3 uGround; uniform float uFade; uniform vec3 uLight; uniform float uSpec; uniform float uShade;
varying vec3 vN; varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float ndl = max(dot(n, uLight), 0.0);
  float s = mix(1.0 - uShade, 1.0, smoothstep(0.05, 0.7, ndl));
  vec3 v = normalize(cameraPosition - vW);
  float sp = pow(max(dot(n, normalize(uLight + v)), 0.0), 56.0) * uSpec;
  vec3 c = uColor * s + vec3(sp);
  gl_FragColor = vec4(mix(c, uGround, uFade), 1.0);
}`;

type Fade = { value: number };

class Paint {
  readonly materials: THREE.ShaderMaterial[] = [];
  constructor(readonly fade: Fade) {}
  make(color: readonly number[], opts: { spec?: number; shade?: number; side?: THREE.Side } = {}): THREE.ShaderMaterial {
    const m = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: opts.side ?? THREE.FrontSide,
      uniforms: {
        uColor: { value: rgb(color) },
        uGround: { value: rgb(GROUND_RGB) },
        uFade: this.fade,
        uLight: { value: LIGHT },
        uSpec: { value: opts.spec ?? 0 },
        uShade: { value: opts.shade ?? 0.5 },
      },
    });
    this.materials.push(m);
    return m;
  }
  /** An unlit surface that writes its colour as given, still fading into the ground while it travels in. */
  flat(color: readonly number[]): THREE.ShaderMaterial {
    return this.make(color, { shade: 0 });
  }
}

const Y = new THREE.Vector3(0, 1, 0);

function between(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, radial = 12): THREE.Mesh {
  const length = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, radial), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y, b.clone().sub(a).normalize());
  return mesh;
}

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

type ClusterHandles = {
  needle: THREE.Group;
  lamp: THREE.Mesh;
  lampMaterial: THREE.MeshBasicMaterial;
  tip: THREE.Mesh;
  display: THREE.Mesh;
  displayMaterial: THREE.MeshBasicMaterial;
  displayTexture: THREE.CanvasTexture;
  displayCanvas: HTMLCanvasElement;
  face: THREE.Group;
  pieces: THREE.MeshBasicMaterial[];
};

export type Bike = {
  root: THREE.Group;
  lean: THREE.Group;
  groups: Record<ChapterId, THREE.Group>;
  fades: Record<ChapterId, Fade>;
  parts: Record<string, THREE.Group>;
  tank: { material: THREE.ShaderMaterial; recess: THREE.ShaderMaterial; probe: THREE.Object3D };
  cluster: ClusterHandles;
  wheels: { front: THREE.Group; rear: THREE.Group; chain: THREE.Group };
  geometry: { wheelbaseMm: number; cylinders: number; silencers: number };
  dispose: () => void;
};

const STEEL = [150, 154, 160];
const DARK = [58, 61, 68];
const BLACK = [40, 42, 48];
const ALLOY = [128, 132, 141];
const RUBBER = [66, 68, 75];

export function buildBike(model: ModelId): Bike {
  const twin = model === "desh-648";
  const wheelbase = twin ? 1.465 : 1.44;
  const half = wheelbase / 2;
  const fades = {} as Record<ChapterId, Fade>;
  const groups = {} as Record<ChapterId, THREE.Group>;
  const paints = {} as Record<ChapterId, Paint>;
  const chapterIds: ChapterId[] = ["frame", "engine", "tank", "wheels", "exhaust", "seat", "cluster"];
  const root = new THREE.Group();
  const lean = new THREE.Group();
  lean.rotation.x = THREE.MathUtils.degToRad(-8);
  root.add(lean);
  for (const id of chapterIds) {
    fades[id] = { value: 0 };
    paints[id] = new Paint(fades[id]);
    groups[id] = new THREE.Group();
    groups[id].name = id;
    lean.add(groups[id]);
  }
  const parts: Record<string, THREE.Group> = {};
  const part = (chapter: ChapterId, id: string): THREE.Group => {
    const g = new THREE.Group();
    g.name = id;
    groups[chapter].add(g);
    parts[id] = g;
    return g;
  };
  const geometries: THREE.BufferGeometry[] = [];
  const keep = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };

  // --- measures
  const frontR = 0.336;
  const rearR = 0.305;
  const frontRim = 0.2413;
  const rearRim = 0.2159;
  const front = v(half, frontR, 0);
  const rear = v(-half, rearR, 0);
  const rake = THREE.MathUtils.degToRad(26);
  const forkDir = v(Math.sin(rake), -Math.cos(rake), 0);
  const headTop = front.clone().sub(forkDir.clone().multiplyScalar(0.78));
  const headBottom = front.clone().sub(forkDir.clone().multiplyScalar(0.55));
  const pivot = v(-half + 0.34, 0.42, 0);

  // ============ frame
  {
    const p = paints.frame;
    const frameMat = p.make([78, 82, 91], { spec: 0.3 });
    const steel = p.make(STEEL, { spec: 0.6, shade: 0.55 });
    const dark = p.make(DARK, { spec: 0.2 });
    const black = p.make(BLACK, { spec: 0.15 });
    const g = groups.frame;

    // main spine and cradle
    g.add(between(headBottom.clone().add(v(-0.03, 0, 0)), v(-0.38, 0.78, 0), 0.022, frameMat));
    g.add(between(headBottom.clone().add(v(-0.02, -0.05, 0)), v(-0.2, 0.52, 0.0), 0.02, frameMat));
    for (const side of [-0.085, 0.085]) {
      g.add(between(v(headBottom.x - 0.02, headBottom.y - 0.06, side * 0.3), v(-0.05, 0.28, side), 0.017, frameMat));
      g.add(between(v(-0.05, 0.28, side), pivot.clone().setZ(side), 0.017, frameMat));
      g.add(between(v(-0.38, 0.78, side * 0.5), v(-0.74, 0.86, side * 1.15), 0.015, frameMat));
      g.add(between(pivot.clone().setZ(side), v(-0.62, 0.72, side * 1.1), 0.015, frameMat));
    }
    g.add(between(v(-0.74, 0.86, -0.1), v(-0.74, 0.86, 0.1), 0.015, frameMat));

    // steering head, fork and bars
    const head = part("frame", "steering-head");
    head.add(between(headBottom, headTop.clone().add(forkDir.clone().multiplyScalar(-0.06)), 0.04, dark));
    for (const side of [-0.092, 0.092]) {
      const top = headTop.clone().setZ(side);
      const upper = between(front.clone().setZ(side).sub(forkDir.clone().multiplyScalar(0.62)), top.clone().add(forkDir.clone().multiplyScalar(-0.04)), 0.017, steel);
      head.add(upper);
      head.add(between(front.clone().setZ(side).sub(forkDir.clone().multiplyScalar(0.62)), front.clone().setZ(side), 0.023, dark));
      head.add(between(front.clone().setZ(side), front.clone().setZ(side * 1.1).add(forkDir.clone().multiplyScalar(-0.03)), 0.03, steel, 16));
    }
    head.add(between(headTop.clone().setZ(-0.1), headTop.clone().setZ(0.1), 0.017, black));
    const bars = new THREE.Group();
    const barY = headTop.y + 0.1;
    const barX = headTop.x - 0.06;
    bars.add(between(v(barX, barY, -0.34), v(barX, barY, 0.34), 0.012, steel));
    bars.add(between(v(barX, barY, -0.34), v(barX - 0.07, barY - 0.01, -0.36), 0.015, black));
    bars.add(between(v(barX, barY, 0.34), v(barX - 0.07, barY - 0.01, 0.36), 0.015, black));
    bars.add(between(headTop.clone().add(v(-0.03, 0.02, -0.06)), v(barX, barY, -0.06), 0.012, steel));
    bars.add(between(headTop.clone().add(v(-0.03, 0.02, 0.06)), v(barX, barY, 0.06), 0.012, steel));
    head.add(bars);
    const lamp = new THREE.Mesh(keep(new THREE.SphereGeometry(0.095, 28, 18)), p.make([232, 234, 238], { spec: 0.7, shade: 0.35 }));
    lamp.scale.set(0.8, 1, 1);
    lamp.position.set(headTop.x + 0.17, headTop.y - 0.02, 0);
    head.add(lamp);
    const bezel = new THREE.Mesh(keep(new THREE.TorusGeometry(0.096, 0.01, 10, 36)), steel);
    bezel.rotation.y = Math.PI / 2;
    bezel.position.set(lamp.position.x + 0.062, lamp.position.y, 0);
    head.add(bezel);

    // swingarm and shock
    const arm = part("frame", "swingarm");
    for (const side of [-0.1, 0.1]) {
      arm.add(between(pivot.clone().setZ(side), rear.clone().setZ(side * 1.0), 0.026, frameMat));
    }
    arm.add(between(v(pivot.x + 0.04, pivot.y, -0.1), v(pivot.x + 0.04, pivot.y, 0.1), 0.024, frameMat));
    arm.add(between(v(-0.55, 0.38, -0.1), v(-0.55, 0.38, 0.1), 0.018, frameMat));
    arm.add(between(v(-0.52, 0.45, 0.0), v(-0.64, 0.8, 0.0), 0.02, black));
    arm.add(between(v(-0.54, 0.51, 0.0), v(-0.62, 0.74, 0.0), 0.028, p.make([138, 142, 150], { spec: 0.3 })));

    // side stand on the rider's left
    const stand = part("frame", "side-stand");
    stand.add(between(v(-0.2, 0.4, -0.12), v(-0.16, 0.06, -0.34), 0.014, steel));
    const foot = new THREE.Mesh(keep(new THREE.BoxGeometry(0.09, 0.012, 0.06)), black);
    foot.position.set(-0.15, 0.05, -0.34);
    stand.add(foot);

    // fenders, lights
    const fender = new THREE.Mesh(keep(new THREE.BoxGeometry(0.42, 0.012, 0.12)), black);
    fender.position.set(-half - 0.06, rearR + 0.2, 0);
    fender.rotation.z = 0.12;
    g.add(fender);
  }

  // ============ engine
  {
    const p = paints.engine;
    const alloy = p.make(ALLOY, { spec: 0.45, shade: 0.55 });
    const black = p.make([46, 49, 55], { spec: 0.25 });
    const g = groups.engine;
    const crank = v(-0.02, 0.37, 0);
    const case_ = new THREE.Mesh(keep(new THREE.BoxGeometry(0.4, 0.3, 0.26)), black);
    case_.position.set(crank.x - 0.02, crank.y - 0.02, 0);
    g.add(case_);
    const gearbox = new THREE.Mesh(keep(new THREE.BoxGeometry(0.22, 0.22, 0.22)), black);
    gearbox.position.set(crank.x - 0.28, crank.y - 0.02, 0);
    g.add(gearbox);
    const cyl = part("engine", "cylinder");
    const cylinders = twin ? [-0.075, 0.075] : [0];
    for (const z of cylinders) {
      const tilt = new THREE.Group();
      tilt.position.set(crank.x + 0.1, crank.y + 0.12, z);
      tilt.rotation.z = -0.32;
      const barrel = new THREE.Mesh(keep(new THREE.CylinderGeometry(twin ? 0.066 : 0.085, twin ? 0.07 : 0.09, 0.2, 24)), alloy);
      barrel.position.y = 0.1;
      tilt.add(barrel);
      for (let i = 0; i < 6; i++) {
        const fin = new THREE.Mesh(keep(new THREE.CylinderGeometry(twin ? 0.082 : 0.104, twin ? 0.082 : 0.104, 0.008, 24)), alloy);
        fin.position.y = 0.025 + i * 0.03;
        tilt.add(fin);
      }
      const top = new THREE.Mesh(keep(new THREE.CylinderGeometry(twin ? 0.074 : 0.094, twin ? 0.078 : 0.1, 0.07, 24)), black);
      top.position.y = 0.23;
      tilt.add(top);
      const cap = new THREE.Mesh(keep(new THREE.BoxGeometry(0.07, 0.02, twin ? 0.1 : 0.14)), alloy);
      cap.position.y = 0.275;
      tilt.add(cap);
      cyl.add(tilt);
    }
    const cover = part("engine", "primary-cover");
    const disc = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.115, 0.115, 0.03, 32)), alloy);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(crank.x + 0.02, crank.y - 0.02, -0.15);
    cover.add(disc);
    const bolt = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.03, 0.03, 0.035, 18)), black);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(crank.x + 0.02, crank.y - 0.02, -0.158);
    cover.add(bolt);
    const clutch = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.085, 0.085, 0.03, 28)), alloy);
    clutch.rotation.x = Math.PI / 2;
    clutch.position.set(crank.x - 0.2, crank.y - 0.02, -0.15);
    cover.add(clutch);
  }

  // ============ tank
  let tankProbe: THREE.Object3D;
  let tankMaterial: THREE.ShaderMaterial;
  let recessMaterial: THREE.ShaderMaterial;
  {
    const p = paints.tank;
    tankMaterial = p.make([47, 63, 92], { spec: 0, shade: 0.58 });
    const g = groups.tank;
    const profile: THREE.Vector2[] = [];
    const length = 0.56;
    for (let i = 0; i <= 28; i++) {
      const t = i / 28;
      const radius = 0.012 + 0.108 * Math.sin(Math.PI * Math.pow(t, 0.8)) ** 0.65;
      profile.push(new THREE.Vector2(radius, (t - 0.5) * length));
    }
    const body = new THREE.Mesh(keep(new THREE.LatheGeometry(profile, 36)), tankMaterial);
    body.rotation.z = -Math.PI / 2;
    body.scale.set(1, 1, 1.28);
    body.position.set(0.04, 0.94, 0);
    g.add(body);
    // the point the probe reads: a flat run of paint on the crown, clear of the cap and the recesses
    tankProbe = new THREE.Object3D();
    tankProbe.position.set(-0.07, 0.94 + 0.12 * 0.99, 0);
    g.add(tankProbe);
    const cap = part("tank", "filler-cap");
    const capBase = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.036, 0.04, 0.018, 24)), p.make(STEEL, { spec: 0.6, shade: 0.55 }));
    capBase.position.set(0.17, 1.058, 0);
    cap.add(capBase);
    const capTop = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.026, 0.026, 0.012, 24)), p.make([60, 62, 68], { spec: 0.3 }));
    capTop.position.set(0.17, 1.07, 0);
    cap.add(capTop);
    const knee = part("tank", "knee-recess");
    const recessMat = p.make([30, 38, 56], { spec: 0, shade: 0.45 });
    recessMaterial = recessMat;
    for (const side of [-1, 1]) {
      const recess = new THREE.Mesh(keep(new THREE.SphereGeometry(0.08, 20, 14)), recessMat);
      recess.scale.set(1.5, 0.9, 0.22);
      recess.position.set(0.0, 0.92, side * 0.158);
      knee.add(recess);
    }
  }

  // ============ wheels
  const wheel = (radius: number, rimRadius: number, centre: THREE.Vector3, tyre: number, chainSide: boolean): THREE.Group => {
    const p = paints.wheels;
    const w = new THREE.Group();
    w.position.copy(centre);
    const tyreMesh = new THREE.Mesh(keep(new THREE.TorusGeometry(radius - tyre, tyre, 18, 56)), p.make(RUBBER, { spec: 0.05, shade: 0.4 }));
    w.add(tyreMesh);
    const rim = new THREE.Mesh(keep(new THREE.TorusGeometry(rimRadius, 0.012, 10, 56)), p.make([196, 200, 207], { spec: 0.7, shade: 0.5 }));
    w.add(rim);
    const hub = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.036, 0.036, 0.11, 20)), p.make(ALLOY, { spec: 0.5 }));
    hub.rotation.x = Math.PI / 2;
    w.add(hub);
    const spokeMat = p.make([170, 174, 181], { spec: 0.3, shade: 0.4 });
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const side = i % 2 === 0 ? 0.04 : -0.04;
      w.add(between(v(Math.cos(a) * 0.04, Math.sin(a) * 0.04, side), v(Math.cos(a + 0.2) * rimRadius, Math.sin(a + 0.2) * rimRadius, 0), 0.0035, spokeMat, 5));
    }
    const brake = new THREE.Mesh(keep(new THREE.CylinderGeometry(rimRadius * 0.62, rimRadius * 0.62, 0.006, 40)), p.make([132, 136, 142], { spec: 0.6 }));
    brake.rotation.x = Math.PI / 2;
    brake.position.z = chainSide ? 0.05 : 0.055;
    w.add(brake);
    return w;
  };
  const frontWheel = part("wheels", "front-rim");
  const rearWheel = part("wheels", "rear-rim");
  const frontW = wheel(frontR, frontRim, front, 0.095, false);
  const rearW = wheel(rearR, rearRim, rear, 0.089, true);
  frontWheel.add(frontW);
  rearWheel.add(rearW);
  const chainPart = part("wheels", "chain");
  {
    const p = paints.wheels;
    const sprocketR = 0.095;
    const frontSprocket = v(-0.2, 0.33, -0.13);
    const rearSprocket = v(rear.x, rear.y, -0.13);
    const sprocketMat = p.make([170, 173, 180], { spec: 0.5, shade: 0.5 });
    const rs = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.105, 0.105, 0.008, 36)), sprocketMat);
    rs.rotation.x = Math.PI / 2;
    rs.position.copy(rearSprocket);
    chainPart.add(rs);
    const fs = new THREE.Mesh(keep(new THREE.CylinderGeometry(sprocketR * 0.5, sprocketR * 0.5, 0.008, 24)), sprocketMat);
    fs.rotation.x = Math.PI / 2;
    fs.position.copy(frontSprocket);
    chainPart.add(fs);
    const loop = new THREE.CatmullRomCurve3(
      [
        v(frontSprocket.x, frontSprocket.y + 0.05, -0.13),
        v((frontSprocket.x + rearSprocket.x) / 2, (frontSprocket.y + rearSprocket.y) / 2 + 0.09, -0.13),
        v(rearSprocket.x, rearSprocket.y + 0.108, -0.13),
        v(rearSprocket.x - 0.108, rearSprocket.y, -0.13),
        v(rearSprocket.x, rearSprocket.y - 0.108, -0.13),
        v((frontSprocket.x + rearSprocket.x) / 2, (frontSprocket.y + rearSprocket.y) / 2 - 0.02, -0.13),
        v(frontSprocket.x, frontSprocket.y - 0.05, -0.13),
        v(frontSprocket.x + 0.05, frontSprocket.y, -0.13),
      ],
      true,
      "catmullrom",
      0.2,
    );
    const chainMesh = new THREE.Mesh(keep(new THREE.TubeGeometry(loop, 96, 0.0075, 6, true)), p.make([70, 72, 78], { spec: 0.4 }));
    chainPart.add(chainMesh);
  }

  // ============ exhaust
  const silencers = twin ? 2 : 1;
  {
    const p = paints.exhaust;
    const chrome = p.make([188, 192, 200], { spec: 0.8, shade: 0.5 });
    const header = part("exhaust", "header");
    const sil = part("exhaust", "silencer");
    const ports = twin ? [-0.075, 0.075] : [0];
    ports.forEach((z, index) => {
      const portPos = v(0.13, 0.5, z);
      const curve = new THREE.CatmullRomCurve3([portPos, v(0.2, 0.34, 0.1 + 0.05 * index), v(0.08, 0.2, 0.17 + 0.03 * index), v(-0.12, 0.2 + 0.07 * index, 0.19 + 0.03 * index), v(-0.3, 0.24 + 0.11 * index, 0.2 + 0.03 * index)]);
      header.add(new THREE.Mesh(keep(new THREE.TubeGeometry(curve, 36, 0.019, 10, false)), chrome));
    });
    for (let i = 0; i < silencers; i++) {
      const z = 0.2 + 0.03 * i;
      const rise = 0.11 * i;
      const can = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.048, 0.042, 0.5, 24)), chrome);
      can.rotation.z = Math.PI / 2 + 0.07;
      can.position.set(-0.52, 0.27 + rise, z);
      sil.add(can);
      const tip = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 24)), p.make(BLACK, { spec: 0.2 }));
      tip.rotation.z = Math.PI / 2;
      tip.position.set(-0.78, 0.285 + rise, z);
      sil.add(tip);
      const band = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.055, 0.055, 0.016, 24)), p.make(DARK, { spec: 0.2 }));
      band.rotation.z = Math.PI / 2 + 0.07;
      band.position.set(-0.4, 0.277 + rise, z);
      sil.add(band);
    }
  }

  // ============ seat
  {
    const p = paints.seat;
    const leather = p.make([66, 63, 68], { spec: 0.15, shade: 0.5 });
    const stitch = p.make([90, 86, 80], { spec: 0 });
    const riderSeat = part("seat", "rider-seat");
    const seatShape = new THREE.Shape();
    seatShape.moveTo(-0.26, 0);
    seatShape.quadraticCurveTo(-0.27, 0.05, -0.2, 0.055);
    seatShape.lineTo(0.2, 0.03);
    seatShape.quadraticCurveTo(0.27, 0.025, 0.27, -0.015);
    seatShape.lineTo(0.27, -0.03);
    seatShape.lineTo(-0.26, -0.03);
    seatShape.closePath();
    const seatGeo = keep(new THREE.ExtrudeGeometry(seatShape, { depth: 0.27, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 4, curveSegments: 16 }));
    seatGeo.translate(0, 0, -0.135);
    const rs = new THREE.Mesh(seatGeo, leather);
    rs.position.set(-0.17, 0.9, 0);
    riderSeat.add(rs);
    const seam = new THREE.Mesh(keep(new THREE.BoxGeometry(0.4, 0.004, 0.006)), stitch);
    seam.position.set(-0.17, 0.965, 0);
    riderSeat.add(seam);
    const pillion = part("seat", "pillion-seat");
    const pg = keep(new THREE.BoxGeometry(0.3, 0.05, 0.2, 6, 2, 4));
    const ps = new THREE.Mesh(pg, leather);
    ps.position.set(-0.6, 0.93, 0);
    ps.rotation.z = 0.1;
    pillion.add(ps);
    const rail = new THREE.Mesh(keep(new THREE.TorusGeometry(0.07, 0.01, 8, 24, Math.PI)), p.make(STEEL, { spec: 0.6 }));
    rail.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    rail.position.set(-0.78, 0.92, 0);
    pillion.add(rail);
    const tail = new THREE.Mesh(keep(new THREE.BoxGeometry(0.03, 0.045, 0.1)), p.make([96, 98, 106], { spec: 0.4 }));
    tail.position.set(-0.84, 0.93, 0);
    pillion.add(tail);
  }

  // ============ cluster
  const clusterPaint = paints.cluster;
  const base = new THREE.Group();
  groups.cluster.add(base);
  base.position.set(headTop.x + 0.1, headTop.y + 0.27, 0);
  // face frame: local +x is the rider's right, +y up and +z faces the rider
  base.rotation.set(0, -Math.PI / 2, 0, "YXZ");
  base.rotateX(-0.42);
  base.scale.setScalar(1.5);
  const housingMat = clusterPaint.make([26, 27, 31], { spec: 0.3, shade: 0.35 });
  const pod = new THREE.Mesh(keep(new THREE.BoxGeometry(0.2, 0.25, 0.06)), housingMat);
  pod.position.set(0, -0.015, -0.031);
  base.add(pod);
  const stalk = between(v(0, -0.14, -0.04), v(0, -0.26, -0.1), 0.018, housingMat);
  base.add(stalk);
  const face = new THREE.Group();
  face.position.z = 0.0;
  base.add(face);
  const clusterPart = (id: string): THREE.Group => {
    const g = new THREE.Group();
    g.name = id;
    face.add(g);
    parts[id] = g;
    return g;
  };
  const needlePart = clusterPart("needle");
  const lampPart = clusterPart("tell-tale");
  const displayPart = clusterPart("display");
  const pieces: THREE.MeshBasicMaterial[] = [];
  const basic = (color: readonly number[]): THREE.MeshBasicMaterial => {
    const m = new THREE.MeshBasicMaterial({ color: rgb(color) });
    m.userData.rgb = color;
    pieces.push(m);
    return m;
  };
  const dialY = 0.035;
  const dial = new THREE.Mesh(keep(new THREE.CircleGeometry(0.082, 48)), basic([10, 10, 12]));
  dial.position.set(0, dialY, 0.001);
  face.add(dial);
  for (let i = 0; i <= 18; i++) {
    const angle = THREE.MathUtils.degToRad(-135 + (270 * i) / 18);
    const major = i % 3 === 0;
    const tick = new THREE.Mesh(keep(new THREE.PlaneGeometry(major ? 0.006 : 0.0035, major ? 0.016 : 0.01)), basic(major ? [200, 202, 206] : [96, 98, 104]));
    tick.position.set(Math.sin(angle) * 0.066, dialY + Math.cos(angle) * 0.066, 0.002);
    tick.rotation.z = -angle;
    face.add(tick);
  }
  const needle = new THREE.Group();
  needle.position.set(0, dialY, 0.012);
  const blade = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.006, 0.05)), basic([239, 240, 241]));
  blade.position.y = 0.025;
  needle.add(blade);
  const tip = new THREE.Mesh(keep(new THREE.CircleGeometry(0.016, 20)), basic([239, 240, 241]));
  tip.position.set(0, 0.052, 0.0005);
  needle.add(tip);
  const hubDisc = new THREE.Mesh(keep(new THREE.CircleGeometry(0.016, 20)), basic([60, 62, 68]));
  hubDisc.position.z = 0.001;
  needle.add(hubDisc);
  needlePart.add(needle);
  const lampMaterial = basic([46, 36, 34]);
  const lamp = new THREE.Mesh(keep(new THREE.CircleGeometry(0.02, 24)), lampMaterial);
  lamp.position.set(-0.075, 0.105, 0.004);
  lampPart.add(lamp);
  const displayCanvas = document.createElement("canvas");
  displayCanvas.width = 256;
  displayCanvas.height = 96;
  const displayTexture = new THREE.CanvasTexture(displayCanvas);
  displayTexture.colorSpace = THREE.NoColorSpace;
  displayTexture.minFilter = THREE.LinearFilter;
  displayTexture.generateMipmaps = false;
  const displayMaterial = new THREE.MeshBasicMaterial({ map: displayTexture });
  const display = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.16, 0.06)), displayMaterial);
  display.position.set(0, -0.082, 0.004);
  displayPart.add(display);

  const dispose = (): void => {
    for (const g of geometries) g.dispose();
    for (const paint of Object.values(paints)) for (const m of paint.materials) m.dispose();
    for (const m of pieces) m.dispose();
    displayMaterial.dispose();
    displayTexture.dispose();
  };

  return {
    root,
    lean,
    groups,
    fades,
    parts,
    tank: { material: tankMaterial, recess: recessMaterial, probe: tankProbe },
    cluster: { needle, lamp, lampMaterial, tip, display, displayMaterial, displayTexture, displayCanvas, face, pieces },
    wheels: { front: frontW, rear: rearW, chain: chainPart },
    geometry: { wheelbaseMm: Math.round(wheelbase * 1000), cylinders: twin ? 2 : 1, silencers },
    dispose,
  };
}
