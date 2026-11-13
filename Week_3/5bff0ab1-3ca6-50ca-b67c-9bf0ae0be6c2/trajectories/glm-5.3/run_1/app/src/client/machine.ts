// The motorcycle, built procedurally in three.js: no glTF or other model asset.
// Published proportions: rake 26 degrees, front rim 19", rear rim 17", side stand and
// chain on the rider's left (-Z), exhaust on the right (+Z), lean 8 degrees to -Z.
import * as THREE from "three";

export interface MachineSpec {
  wheelbaseMm: number;
  cylinders: number;
  silencers: number;
  rakeDeg: number;
  frontRimIn: number;
  rearRimIn: number;
  sideStandSide: "left";
  chainSide: "left";
  exhaustSide: "right";
  leanDeg: number;
  leanSide: "left";
}

export const MEGH_SPEC: MachineSpec = {
  wheelbaseMm: 1440,
  cylinders: 1,
  silencers: 1,
  rakeDeg: 26,
  frontRimIn: 19,
  rearRimIn: 17,
  sideStandSide: "left",
  chainSide: "left",
  exhaustSide: "right",
  leanDeg: 8,
  leanSide: "left",
};

export const DESH_SPEC: MachineSpec = {
  wheelbaseMm: 1465,
  cylinders: 2,
  silencers: 2,
  rakeDeg: 26,
  frontRimIn: 19,
  rearRimIn: 17,
  sideStandSide: "left",
  chainSide: "left",
  exhaustSide: "right",
  leanDeg: 8,
  leanSide: "left",
};

const INK = new THREE.Color(239 / 255, 240 / 255, 241 / 255);
const DARK = new THREE.Color(0.08, 0.08, 0.09);

export type GroupKey = "frame" | "engine" | "tank" | "wheels" | "exhaust" | "seat" | "cluster";

export const GROUP_ORDER: GroupKey[] = ["frame", "engine", "tank", "wheels", "exhaust", "seat", "cluster"];

// The seven part groups seat in the published order; each group starts travelling at
// the previous group's seat point.
export const SEAT_POINTS: Record<GroupKey, number> = {
  frame: 0.14,
  engine: 0.28,
  tank: 0.42,
  wheels: 0.56,
  exhaust: 0.7,
  seat: 0.84,
  cluster: 0.86,
};

export const TRAVEL_STARTS: Record<GroupKey, number> = {
  frame: 0.0,
  engine: 0.14,
  tank: 0.28,
  wheels: 0.42,
  exhaust: 0.56,
  seat: 0.7,
  cluster: 0.78,
};

export interface PartPlacement {
  id: string;
  chapter: string;
  // where the part sits at rest, in metres
  position: THREE.Vector3;
  // where the part parks before seating, from above
  offset: THREE.Vector3;
  lift: THREE.Vector3;
}

export interface BuiltMachine {
  root: THREE.Group;
  groups: Record<GroupKey, THREE.Group>;
  parts: Record<string, { mesh: THREE.Object3D; placement: PartPlacement }>;
  tank: THREE.Mesh;
  lamp: THREE.Mesh;
  needle: THREE.Group;
  needleTip: THREE.Object3D;
  display: THREE.Mesh;
  displayCanvas: HTMLCanvasElement;
  displayTexture: THREE.CanvasTexture;
  spec: MachineSpec;
  dispose(): void;
}

const RAKE = 26;
const FRONT_RIM_M = 19 * 0.0254;
const REAR_RIM_M = 17 * 0.0254;
const TANK_CAP_HEIGHT = 0.16;

export function buildMachine(spec: MachineSpec, paintHex: string): BuiltMachine {
  const root = new THREE.Group();
  const groups = {} as Record<GroupKey, THREE.Group>;
  for (const g of GROUP_ORDER) {
    const grp = new THREE.Group();
    groups[g] = grp;
    root.add(grp);
  }

  const metal = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.55, metalness: 0.35 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.7, metalness: 0.2 });
  const rubber = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.95 });
  const paint = new THREE.MeshStandardMaterial({ color: new THREE.Color(paintHex), roughness: 0.45, metalness: 0.25 });

  const parts: Record<string, { mesh: THREE.Object3D; placement: PartPlacement }> = {};

  function tube(pts: THREE.Vector3[], radius: number, mat: THREE.Material): THREE.Mesh {
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, 24, radius, 8, false);
    return new THREE.Mesh(geo, mat);
  }

  const wheelbase = spec.wheelbaseMm / 1000;
  const frontX = wheelbase / 2;
  const rearX = -wheelbase / 2;

  // ---------- frame ----------
  const headAngle = (RAKE * Math.PI) / 180;
  const headTop = new THREE.Vector3(frontX + 0.05, 0.62, 0).sub(new THREE.Vector3(Math.cos(headAngle) * 0.18, Math.sin(headAngle) * 0.18, 0));
  const steeringHead = tube([headTop, new THREE.Vector3(frontX + 0.05, 0.62, 0)], 0.028, metal);
  groups.frame.add(steeringHead);
  parts["steering-head"] = { mesh: steeringHead, placement: { id: "steering-head", chapter: "frame", position: new THREE.Vector3(frontX + 0.05, 0.62, 0), offset: new THREE.Vector3(0, 0.5, 0), lift: new THREE.Vector3(0.1, 0.06, 0) } };

  const swingarmPivot = new THREE.Vector3(rearX + 0.28, 0.36, 0);
  const swingarm = tube([swingarmPivot, new THREE.Vector3(rearX, 0.34, 0.0), new THREE.Vector3(rearX, 0.34, -0.09), new THREE.Vector3(rearX + 0.02, 0.34, 0.09)], 0.022, metal);
  groups.frame.add(swingarm);
  parts["swingarm"] = { mesh: swingarm, placement: { id: "swingarm", chapter: "frame", position: new THREE.Vector3(rearX + 0.1, 0.34, 0), offset: new THREE.Vector3(0, 0.5, 0), lift: new THREE.Vector3(-0.08, 0.05, 0) } };

  // main frame spars
  groups.frame.add(tube([headTop, new THREE.Vector3(0.1, 0.42, 0), new THREE.Vector3(-0.35, 0.4, 0)], 0.024, metal));
  groups.frame.add(tube([new THREE.Vector3(frontX + 0.02, 0.5, 0), new THREE.Vector3(0.2, 0.44, 0)], 0.02, metal));

  // side stand on the rider's left (-Z)
  const stand = tube([new THREE.Vector3(-0.1, 0.3, -0.06), new THREE.Vector3(-0.22, 0.02, -0.3)], 0.016, darkMetal);
  groups.frame.add(stand);
  parts["side-stand"] = { mesh: stand, placement: { id: "side-stand", chapter: "frame", position: new THREE.Vector3(-0.16, 0.15, -0.18), offset: new THREE.Vector3(0, 0.5, 0), lift: new THREE.Vector3(0, 0.05, -0.08) } };

  // ---------- engine ----------
  const engineX = 0.05;
  for (let i = 0; i < spec.cylinders; i++) {
    const zOff = spec.cylinders === 2 ? (i === 0 ? -0.09 : 0.09) : 0;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.24, 20), darkMetal);
    cyl.position.set(engineX, 0.5, zOff);
    cyl.rotation.z = Math.PI / 2;
    groups.engine.add(cyl);
    if (i === 0) {
      parts["cylinder"] = { mesh: cyl, placement: { id: "cylinder", chapter: "engine", position: cyl.position.clone(), offset: new THREE.Vector3(0, 0.5, 0), lift: new THREE.Vector3(0.06, 0.06, 0) } };
    }
  }
  const crank = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.2), darkMetal);
  crank.position.set(engineX, 0.33, 0);
  groups.engine.add(crank);
  const primaryCover = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.035, 24), metal);
  primaryCover.rotation.z = Math.PI / 2;
  primaryCover.position.set(engineX - 0.12, 0.33, 0.11);
  groups.engine.add(primaryCover);
  parts["primary-cover"] = { mesh: primaryCover, placement: { id: "primary-cover", chapter: "engine", position: primaryCover.position.clone(), offset: new THREE.Vector3(0, 0.5, 0), lift: new THREE.Vector3(0, 0.05, 0.1) } };

  // ---------- tank ----------
  const tank = new THREE.Mesh(new THREE.SphereGeometry(0.19, 26, 18, 0, Math.PI * 2, 0, Math.PI / 2), paint);
  tank.scale.set(1.25, TANK_CAP_HEIGHT / 0.19 * 1.0, 0.72);
  tank.position.set(0.28, 0.52, 0);
  groups.tank.add(tank);
  const filler = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.012, 16), metal);
  filler.position.set(0.33, 0.53 + TANK_CAP_HEIGHT - 0.02, 0);
  groups.tank.add(filler);
  parts["filler-cap"] = { mesh: filler, placement: { id: "filler-cap", chapter: "tank", position: filler.position.clone(), offset: new THREE.Vector3(0, 0.5, 0), lift: new THREE.Vector3(0.05, 0.05, 0) } };
  const knee = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.016, 10, 20, Math.PI), paint);
  knee.position.set(0.18, 0.5, 0.135);
  knee.rotation.y = Math.PI / 2;
  groups.tank.add(knee);
  parts["knee-recess"] = { mesh: knee, placement: { id: "knee-recess", chapter: "tank", position: knee.position.clone(), offset: new THREE.Vector3(0, 0.5, 0), lift: new THREE.Vector3(0, 0.04, 0.08) } };

  // ---------- wheels ----------
  const frontTyre = new THREE.Mesh(new THREE.TorusGeometry(FRONT_RIM_M / 2 + 0.03, 0.032, 14, 40), rubber);
  frontTyre.rotation.y = Math.PI / 2;
  frontTyre.position.set(frontX, FRONT_RIM_M / 2 + 0.03, 0);
  groups.wheels.add(frontTyre);
  const frontRim = new THREE.Mesh(new THREE.CylinderGeometry(FRONT_RIM_M / 2, FRONT_RIM_M / 2, 0.05, 28, 1, true), metal);
  frontRim.rotation.z = Math.PI / 2;
  frontRim.position.copy(frontTyre.position);
  groups.wheels.add(frontRim);
  parts["front-rim"] = { mesh: frontRim, placement: { id: "front-rim", chapter: "wheels", position: frontRim.position.clone(), offset: new THREE.Vector3(0, 0.5, 0), lift: new THREE.Vector3(0.08, 0.05, 0) } };

  const rearTyre = new THREE.Mesh(new THREE.TorusGeometry(REAR_RIM_M / 2 + 0.045, 0.045, 14, 40), rubber);
  rearTyre.rotation.y = Math.PI / 2;
  rearTyre.position.set(rearX, REAR_RIM_M / 2 + 0.045, 0);
  groups.wheels.add(rearTyre);
  const rearRim = new THREE.Mesh(new THREE.CylinderGeometry(REAR_RIM_M / 2, REAR_RIM_M / 2, 0.07, 28, 1, true), metal);
  rearRim.rotation.z = Math.PI / 2;
  rearRim.position.copy(rearTyre.position);
  groups.wheels.add(rearRim);
  parts["rear-rim"] = { mesh: rearRim, placement: { id: "rear-rim", chapter: "wheels", position: rearRim.position.clone(), offset: new THREE.Vector3(0, 0.5, 0), lift: new THREE.Vector3(-0.08, 0.05, 0) } };

  // chain on the rider's left (-Z)
  const chain = tube([new THREE.Vector3(rearX, 0.34, -0.07), new THREE.Vector3(engineX - 0.05, 0.36, -0.06), new THREE.Vector3(engineX + 0.02, 0.28, -0.07)], 0.012, darkMetal);
  groups.wheels.add(chain);
  parts["chain"] = { mesh: chain, placement: { id: "chain", chapter: "wheels", position: new THREE.Vector3(0, 0.34, -0.07), offset: new THREE.Vector3(0, 0.5, 0), lift: new THREE.Vector3(0, 0.05, -0.1) } };

  // ---------- exhaust ----------
  const headerStart = new THREE.Vector3(engineX + 0.02, 0.3, 0.1);
  const header = tube([headerStart, new THREE.Vector3(-0.05, 0.2, 0.14), new THREE.Vector3(-0.4, 0.16, 0.15)], 0.022, metal);
  groups.exhaust.add(header);
  parts["header"] = { mesh: header, placement: { id: "header", chapter: "exhaust", position: new THREE.Vector3(-0.2, 0.2, 0.13), offset: new THREE.Vector3(0, 0.5, 0), lift: new THREE.Vector3(0, 0.06, 0.08) } };

  const silencerZ = spec.silencers === 2 ? [-0.1, 0.24] : [0.18];
  for (let i = 0; i < spec.silencers; i++) {
    const sil = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.34, 18), metal);
    sil.rotation.z = Math.PI / 2 + 0.06;
    sil.position.set(-0.55, 0.2, silencerZ[i]);
    groups.exhaust.add(sil);
    if (i === 0) {
      parts["silencer"] = { mesh: sil, placement: { id: "silencer", chapter: "exhaust", position: sil.position.clone(), offset: new THREE.Vector3(0, 0.5, 0), lift: new THREE.Vector3(-0.08, 0.05, 0.06) } };
    }
  }

  // ---------- seat ----------
  const riderSeat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.24), darkMetal);
  riderSeat.position.set(-0.12, 0.47, 0);
  groups.seat.add(riderSeat);
  parts["rider-seat"] = { mesh: riderSeat, placement: { id: "rider-seat", chapter: "seat", position: riderSeat.position.clone(), offset: new THREE.Vector3(0, 0.5, 0), lift: new THREE.Vector3(-0.05, 0.05, 0) } };
  const pillionSeat = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.045, 0.22), darkMetal);
  pillionSeat.position.set(-0.44, 0.46, 0);
  groups.seat.add(pillionSeat);
  parts["pillion-seat"] = { mesh: pillionSeat, placement: { id: "pillion-seat", chapter: "seat", position: pillionSeat.position.clone(), offset: new THREE.Vector3(0, 0.5, 0), lift: new THREE.Vector3(-0.05, 0.04, 0) } };

  // ---------- cluster ----------
  const clusterPos = new THREE.Vector3(frontX - 0.02, 0.68, 0);
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.045, 24), new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.7 }));
  housing.rotation.x = Math.PI / 2 - 0.3;
  housing.position.copy(clusterPos);
  groups.cluster.add(housing);

  const face = new THREE.Mesh(new THREE.CircleGeometry(0.088, 32), new THREE.MeshBasicMaterial({ color: 0x101012 }));
  face.position.set(clusterPos.x, clusterPos.y, clusterPos.z + 0.024);
  face.rotation.x = -0.3;
  groups.cluster.add(face);
  parts["needle"] = { mesh: face, placement: { id: "needle", chapter: "cluster", position: face.position.clone(), offset: new THREE.Vector3(0, 0.5, 0), lift: new THREE.Vector3(0, 0.04, 0.05) } };

  const needleGroup = new THREE.Group();
  needleGroup.position.copy(face.position);
  const needleMesh = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.075, 0.001), new THREE.MeshBasicMaterial({ color: INK }));
  needleMesh.position.set(0, 0.032, 0.004);
  needleGroup.add(needleMesh);
  const needleTip = new THREE.Object3D();
  needleTip.position.set(0, 0.069, 0.004);
  needleGroup.add(needleTip);
  groups.cluster.add(needleGroup);
  parts["needle"].mesh = needleGroup;

  // the tell-tale lamp
  const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.009, 16), new THREE.MeshBasicMaterial({ color: 0x181920 }));
  lamp.position.set(clusterPos.x - 0.05, clusterPos.y + 0.055, clusterPos.z + 0.024);
  lamp.rotation.x = -0.3;
  groups.cluster.add(lamp);
  parts["tell-tale"] = { mesh: lamp, placement: { id: "tell-tale", chapter: "cluster", position: lamp.position.clone(), offset: new THREE.Vector3(0, 0.5, 0), lift: new THREE.Vector3(0, 0.05, 0.04) } };

  // the display, a canvas texture with the live values
  const displayCanvas = document.createElement("canvas");
  displayCanvas.width = 256;
  displayCanvas.height = 72;
  const displayTexture = new THREE.CanvasTexture(displayCanvas);
  const display = new THREE.Mesh(
    new THREE.PlaneGeometry(0.1, 0.028),
    new THREE.MeshBasicMaterial({ map: displayTexture, transparent: true })
  );
  display.position.set(clusterPos.x + 0.03, clusterPos.y - 0.05, clusterPos.z + 0.024);
  display.rotation.x = -0.3;
  groups.cluster.add(display);
  parts["display"] = { mesh: display, placement: { id: "display", chapter: "cluster", position: display.position.clone(), offset: new THREE.Vector3(0, 0.5, 0), lift: new THREE.Vector3(0, 0.04, 0.05) } };

  // the machine leans 8 degrees to -Z on the side stand
  root.rotation.x = (-spec.leanDeg * Math.PI) / 180;

  return {
    root,
    groups,
    parts,
    tank,
    lamp,
    needle: needleGroup,
    needleTip,
    display,
    displayCanvas,
    displayTexture,
    spec,
    dispose() {
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      displayTexture.dispose();
    },
  };
}

export const NEEDLE_RANGE = 96;
export const NEEDLE_MIN_DEG = -135;
export const NEEDLE_MAX_DEG = 135;

// -135 + 270 x min(hoursLeft, 96) / 96
export function needleAngleFor(hoursLeft: number): number {
  const clamped = Math.min(Math.max(hoursLeft, 0), NEEDLE_RANGE);
  return NEEDLE_MIN_DEG + (270 * clamped) / NEEDLE_RANGE;
}

export function paintDisplay(canvas: HTMLCanvasElement, units: number, ride: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#101012";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#eff0f1";
  ctx.font = "500 34px 'Rethink Sans', monospace";
  ctx.textBaseline = "middle";
  ctx.fillText(`UNITS ${String(Math.max(0, Math.min(99, units))).padStart(2, "0")}`, 14, 26);
  ctx.fillText(`RIDE ${ride}`, 14, 56);
}
