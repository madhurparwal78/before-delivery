// The procedural world of Bramble: planet, homes, couriers, sky and the route ribbon.
// Everything is drawn from code — shaders, generated geometry and canvas textures.

import * as THREE from "three";
import { PLANET_RADIUS_M, toVec3, normalizeLatLon, arcM as arcMeters, bearingDeg, stepToward as pathStep, type LatLon } from "../../shared/geometry.js";
import { RESIDENTS, SATCHEL_COLOURS } from "../../shared/seed.js";

export const ROUTE_TEAL = 0x1f7f7a;
export const INK = 0x3b2a5c;
export const RISO_PINK = 0xff5ca8;
export const SUN = 0xffc95c;
export const PAPER = 0xfbf4e4;

export type WorldObjects = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  planet: THREE.Mesh;
  courierGroup: THREE.Group;
  sky: THREE.Group;
  scraps: THREE.Mesh[];
  cloudRing: THREE.Group;
  homes: Map<string, { group: THREE.Group; door: THREE.Object3D; doorPos: LatLon }>;
  depot: THREE.Group;
  ribbon: THREE.Mesh;
  ribbonGeometry: THREE.BufferGeometry;
  courier: THREE.Group;
  courierSatchel: THREE.Mesh;
  courierParcel: THREE.Group;
  otherFigures: Map<string, THREE.Group>;
};

function surfacePos(p: LatLon, height = 0): THREE.Vector3 {
  const [x, y, z] = toVec3(p, PLANET_RADIUS_M + height);
  return new THREE.Vector3(x, y, z);
}

export function latLonToVec(p: LatLon, height = 0): THREE.Vector3 {
  return surfacePos(p, height);
}

export function vecToLatLon(v: THREE.Vector3): LatLon {
  const r = v.length();
  return { lat: (Math.asin(v.z / r) * 180) / Math.PI, lon: (Math.atan2(v.y, v.x) * 180) / Math.PI };
}

/** Local surface frame at a position: up is the outward normal, north the local pole direction. */
export function poseFor(p: LatLon, headingDeg: number, height = 0): { pos: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 } {
  const pos = surfacePos(p, height);
  const up = pos.clone().normalize();
  const northDir = new THREE.Vector3(0, 0, 1).sub(up.clone().multiplyScalar(up.z));
  if (northDir.lengthSq() < 1e-9) northDir.set(1, 0, 0).sub(up.clone().multiplyScalar(up.x));
  northDir.normalize();
  const east = new THREE.Vector3().crossVectors(northDir, up).normalize();
  const heading = (headingDeg * Math.PI) / 180;
  const forward = northDir
    .multiplyScalar(Math.cos(heading))
    .add(east.multiplyScalar(Math.sin(heading)))
    .normalize();
  return { pos, up, forward };
}

/** Steps a walking move over the sphere: returns the new lat/lon. */
export function walkStep(from: LatLon, headingDeg: number, metres: number): LatLon {
  if (metres === 0) return from;
  const delta = metres / PLANET_RADIUS_M; // angular distance in radians
  const φ1 = from.lat * (Math.PI / 180);
  const λ1 = from.lon * (Math.PI / 180);
  const θ = (headingDeg * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(delta) + Math.cos(φ1) * Math.sin(delta) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(delta) * Math.cos(φ1), Math.cos(delta) - Math.sin(φ1) * Math.sin(φ2));
  return normalizeLatLon({ lat: (φ2 * 180) / Math.PI, lon: ((((λ2 * 180) / Math.PI + 540) % 360) - 180) });
}

// ---------------------------------------------------------------------------
// Procedural textures

function paperTexture(base: string, spots: string[], seed: number): THREE.Texture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = spots[Math.floor(rand() * spots.length)];
    ctx.globalAlpha = 0.05 + rand() * 0.12;
    const r = 2 + rand() * 14;
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function nameTagTexture(name: string): THREE.Texture {
  const canvas = document.createElement("canvas");
  const pad = 12;
  const font = "20px 'Atkinson Hyperlegible', sans-serif";
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const w = Math.ceil(measure.measureText(name).width) + pad * 2;
  const hgt = 34;
  canvas.width = Math.max(64, w);
  canvas.height = hgt;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fbf4e4";
  ctx.fillRect(0, 0, canvas.width, hgt);
  ctx.strokeStyle = "#3b2a5c";
  ctx.lineWidth = 2;
  ctx.strokeRect(1.5, 1.5, canvas.width - 3, hgt - 3);
  ctx.fillStyle = "#3b2a5c";
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, canvas.width / 2, hgt / 2 + 1);
  return new THREE.CanvasTexture(canvas);
}

// ---------------------------------------------------------------------------
// World construction

export function buildWorld(canvas: HTMLCanvasElement): WorldObjects | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xfdf3e0);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 3000);
  scene.add(camera);

  // Sunlight plus a soft fill for a hand-printed feel.
  const sun = new THREE.DirectionalLight(0xfff2d0, 2.4);
  sun.position.set(300, 200, 260);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xd8e8ff, 0.7);
  fill.position.set(-260, -120, -180);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0xfff8ec, 0.85));

  // The planet: a green-ochre paper sphere with an ink outline.
  const planetGeo = new THREE.SphereGeometry(PLANET_RADIUS_M, 96, 96);
  const planetMat = new THREE.MeshStandardMaterial({
    map: paperTexture("#8fb573", ["#a8c98a", "#7ba05e", "#c9b46a", "#e3d09a"], 7),
    roughness: 0.95,
    metalness: 0,
  });
  const planet = new THREE.Mesh(planetGeo, planetMat);
  scene.add(planet);

  const outline = new THREE.Mesh(
    new THREE.SphereGeometry(PLANET_RADIUS_M + 0.35, 96, 96),
    new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }),
  );
  scene.add(outline);

  // Warm band of sky near the horizon.
  const band = new THREE.Mesh(
    new THREE.RingGeometry(PLANET_RADIUS_M * 6, PLANET_RADIUS_M * 20, 64),
    new THREE.MeshBasicMaterial({ color: SUN, transparent: true, opacity: 0.18, side: THREE.DoubleSide }),
  );
  band.lookAt(0, 0, 1);
  scene.add(band);

  // Homes for the residents. The door faces the depot, and the pink stamp plate sits
  // exactly at the resident's door lat/lon, so the route ribbon reaches it visibly.
  const homes = new Map<string, { group: THREE.Group; door: THREE.Object3D; doorPos: LatLon }>();
  for (const resident of RESIDENTS) {
    const group = new THREE.Group();
    const bearingToDepot = bearingDeg(resident.door, { lat: 0, lon: 0 });
    const frame = poseFor(resident.door, bearingToDepot, 0);
    const right = new THREE.Vector3().crossVectors(frame.up, frame.forward).normalize();
    const basis = new THREE.Matrix4().makeBasis(right, frame.up, frame.forward);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis);

    // The body and roof stand 3 m behind the plate; the plate marks the door lat/lon.
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 2.9, 5, 8),
      new THREE.MeshStandardMaterial({ color: 0xe8d9b5, roughness: 0.9 }),
    );
    body.position.set(0, 2.5, -3.2);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(3.1, 2.4, 8),
      new THREE.MeshStandardMaterial({ color: 0xc96f4a, roughness: 0.9 }),
    );
    roof.position.set(0, 6.2, -3.2);
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 2, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x9a6b3f, roughness: 0.9 }),
    );
    door.position.set(0, 1, -0.3);
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.12),
      new THREE.MeshStandardMaterial({ color: RISO_PINK, roughness: 0.6 }),
    );
    plate.position.set(0, 2.35, -0.2);
    group.add(body, roof, door, plate);
    group.position.copy(frame.pos);
    group.quaternion.copy(quaternion);
    scene.add(group);
    homes.set(resident.resident_id, { group, door: door, doorPos: resident.door });
  }

  // Bramble Depot: an open-air stand, nothing taller than the courier.
  const depot = new THREE.Group();
  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 1.1, 1.4),
    new THREE.MeshStandardMaterial({ color: 0xb98d5b, roughness: 0.9 }),
  );
  counter.position.y = 0.55;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.9, 6), new THREE.MeshStandardMaterial({ color: INK }));
  post.position.set(-1.6, 0.45, -0.4);
  const post2 = post.clone();
  post2.position.x = 1.6;
  depot.add(counter, post, post2);
  const depotPose = poseFor({ lat: 0, lon: 0 }, 0, 0);
  depot.position.copy(depotPose.pos);
  depot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), depotPose.up);
  scene.add(depot);

  // The player's courier.
  const { courier, satchel, parcel } = buildFigure("#c8b499", null, true);
  scene.add(courier);

  const otherFigures = new Map<string, THREE.Group>();

  // Paper scraps drifting in the sky.
  const sky = new THREE.Group();
  const scraps: THREE.Mesh[] = [];
  for (let i = 0; i < 40; i++) {
    const scrap = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4 + (i % 3) * 0.7, 1.1 + (i % 2) * 0.5),
      new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? SUN : 0xfdf6e8, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    );
    const ang = (i / 40) * Math.PI * 2;
    const r = PLANET_RADIUS_M * (1.6 + (i % 5) * 0.28);
    scrap.position.set(Math.cos(ang) * r, Math.sin(ang) * r, (((i * 37) % 100) / 100) * r * 0.5);
    scrap.rotation.set(i, i * 2, i * 3);
    sky.add(scrap);
    scraps.push(scrap);
  }

  // A loose ring of flat printed clouds.
  const cloudRing = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Group();
    for (let p = 0; p < 3; p++) {
      const puff = new THREE.Mesh(
        new THREE.CircleGeometry(4 + ((p * 3) % 5), 24),
        new THREE.MeshBasicMaterial({ color: 0xfefaf0, side: THREE.DoubleSide }),
      );
      puff.position.set(p * 3.5 - 3.5, (p % 2) * 1.2, 0);
      cloud.add(puff);
    }
    const ang = (i / 14) * Math.PI * 2;
    const r = PLANET_RADIUS_M * 1.35;
    cloud.position.set(Math.cos(ang) * r, Math.sin(ang) * r, 0);
    cloud.lookAt(0, 0, 0);
    cloudRing.add(cloud);
  }
  sky.add(cloudRing);
  scene.add(sky);

  // The route ribbon: a flat triangle strip over the surface in exactly the route teal,
  // wide enough to read on screen, hidden wherever the planet stands in front of it.
  const ribbonGeometry = new THREE.BufferGeometry();
  ribbonGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 128 * 2), 3));
  ribbonGeometry.setIndex([]);
  const ribbon = new THREE.Mesh(ribbonGeometry, new THREE.MeshBasicMaterial({ color: ROUTE_TEAL, side: THREE.DoubleSide }));
  ribbon.visible = false;
  ribbon.frustumCulled = false;
  scene.add(ribbon);


  return {
    scene, camera, renderer, planet, courierGroup: courier, sky, scraps, cloudRing,
    homes, depot, ribbon, ribbonGeometry, courier, courierSatchel: satchel,
    courierParcel: parcel, otherFigures,
  };
}

export function buildFigure(satchelColour: string, name: string | null, isPlayer: boolean): { courier: THREE.Group; satchel: THREE.Mesh; parcel: THREE.Group } {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.45, 1.0, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0x4a3a6e, roughness: 0.8 }),
  );
  body.position.y = 0.95;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xf4e3c2, roughness: 0.8 }),
  );
  head.position.y = 1.95;
  const satchel = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.4, 0.22),
    new THREE.MeshStandardMaterial({ color: SATCHEL_COLOURS[satchelColour] ?? "#c8b499", roughness: 0.8 }),
  );
  satchel.position.set(0.55, 1.0, 0);
  group.add(body, head, satchel);

  // A standard parcel: a brown paper box tied with ink string; rush tape is pink.
  const parcel = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.5, 0.7),
    new THREE.MeshStandardMaterial({ color: 0xb98d5b, roughness: 0.9 }),
  );
  const tape = new THREE.Mesh(
    new THREE.BoxGeometry(0.74, 0.1, 0.74),
    new THREE.MeshStandardMaterial({ color: 0xc8b499, roughness: 0.9 }),
  );
  const string = new THREE.Mesh(
    new THREE.BoxGeometry(0.74, 0.54, 0.06),
    new THREE.MeshBasicMaterial({ color: INK }),
  );
  parcel.add(box, tape, string);
  parcel.position.set(0, 1.45, 0.35);
  parcel.visible = false;
  group.add(parcel);

  if (!isPlayer && name !== null) {
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTagTexture(name), depthTest: true }));
    tag.scale.set(1.6, 0.42, 1);
    tag.position.y = 2.75;
    tag.name = "nametag";
    group.add(tag);
  }
  return { courier: group, satchel, parcel };
}

/** Rush parcels wear pink tape. */
export function styleParcel(parcel: THREE.Group, rush: boolean): void {
  const tape = parcel.children[1] as THREE.Mesh;
  (tape.material as THREE.MeshStandardMaterial).color.set(rush ? RISO_PINK : 0xc8b499);
}

/** Rewrites a figure's name tag in place, without fading. */
export function renameFigure(group: THREE.Group, name: string): void {
  const tag = group.getObjectByName("nametag") as THREE.Sprite | undefined;
  if (tag) {
    (tag.material as THREE.SpriteMaterial).map?.dispose();
    (tag.material as THREE.SpriteMaterial).map = nameTagTexture(name);
    (tag.material as THREE.SpriteMaterial).needsUpdate = true;
  } else {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTagTexture(name), depthTest: true }));
    sprite.scale.set(1.6, 0.42, 1);
    sprite.position.y = 2.75;
    sprite.name = "nametag";
    group.add(sprite);
  }
}

export function recolourFigure(satchel: THREE.Mesh, colour: string): void {
  (satchel.material as THREE.MeshStandardMaterial).color.set(SATCHEL_COLOURS[colour] ?? "#c8b499");
}

/** The ribbon runs just above the ground and rises to the door's height at its end. */
function ribbonHeightAt(t: number): number {
  return t > 0.9 ? 0.5 + ((t - 0.9) / 0.1) * 0.7 : 0.5;
}

/** Draws the ribbon from the courier's feet toward the door, over the fraction of the path shown. */
export function drawRibbon(world: WorldObjects, from: LatLon, to: LatLon, fraction: number, visible: boolean): void {
  if (!visible || fraction <= 0.001) {
    world.ribbon.visible = false;
    return;
  }
  const samples = 96;
  const count = Math.max(2, Math.round(samples * Math.min(1, fraction)));
  const positions = world.ribbonGeometry.getAttribute("position") as THREE.BufferAttribute;
  const index: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    const p = stepFraction(from, to, t);
    const height = ribbonHeightAt(t);
    const centre = latLonToVec(p, height);
    const up = centre.clone().normalize();
    const toNext = latLonToVec(stepFraction(from, to, Math.min(1, t + 0.01)), ribbonHeightAt(Math.min(1, t + 0.01))).sub(centre).normalize();
    const side = new THREE.Vector3().crossVectors(up, toNext).normalize().multiplyScalar(0.34);
    positions.setXYZ(i * 2, centre.x + side.x, centre.y + side.y, centre.z + side.z);
    positions.setXYZ(i * 2 + 1, centre.x - side.x, centre.y - side.y, centre.z - side.z);
    if (i > 0) {
      const a = (i - 1) * 2, b = (i - 1) * 2 + 1, c = i * 2, d = i * 2 + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  world.ribbonGeometry.setIndex(index);
  world.ribbonGeometry.setDrawRange(0, index.length);
  positions.needsUpdate = true;
  world.ribbon.visible = true;
}

function stepFraction(from: LatLon, to: LatLon, t: number): LatLon {
  const total = arcMeters(from, to);
  return pathStep(from, to, total * t);
}
