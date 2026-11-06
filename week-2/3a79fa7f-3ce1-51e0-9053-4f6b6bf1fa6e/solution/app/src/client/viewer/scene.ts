// The studio-lit WebGL scene: board package in its finish, wing and mast (at its length) beneath, pod on the mast,
// battery with its charge bar through a clear deck window, controller beside the deck, spares beside the board.
// Renders only on demand.
import {
  BoxGeometry, CanvasTexture, CapsuleGeometry, CylinderGeometry, DirectionalLight, ExtrudeGeometry, Group, HemisphereLight, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Path, PerspectiveCamera, PlaneGeometry, Scene, Shape, SphereGeometry, SRGBColorSpace,
  TorusGeometry, WebGLRenderer, type BufferGeometry, type Material, type Object3D,
} from "three";
import type { Slot } from "../catalog.ts";
import { CHARGE_OFF, CHARGE_ON, hue, PACK_LENGTH, RING, shape, type Shape as PartShape } from "./parts.ts";
import { FOV, position, TARGET, up, type Pose } from "./camera.ts";
import type { SceneBuild } from "./types.ts";

const SLOTS: Slot[] = ["wing", "mast", "propulsion", "battery", "controller"];
const MAST_X = -0.12;
const DECK_Y = 0.06;
const MODEL_SCALE = 1.3;
/** The controller floats beside the board's near rail, toward the nose, at deck height. */
const CONTROLLER = { x: 0.42, y: DECK_Y, z: 0.44 };

function material(hex: string, rough = 0.45, metal = 0.08): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal });
}

function mesh(geometry: BufferGeometry, mat: Material, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(geometry, mat);
  m.position.set(x, y, z);
  return m;
}

function hull(hex: string): Group {
  const outline = new Shape();
  outline.moveTo(-0.74, -0.2);
  outline.quadraticCurveTo(-0.74, -0.26, -0.66, -0.27);
  outline.bezierCurveTo(-0.3, -0.31, 0.25, -0.31, 0.5, -0.24);
  outline.quadraticCurveTo(0.8, -0.13, 0.82, 0);
  outline.quadraticCurveTo(0.8, 0.13, 0.5, 0.24);
  outline.bezierCurveTo(0.25, 0.31, -0.3, 0.31, -0.66, 0.27);
  outline.quadraticCurveTo(-0.74, 0.26, -0.74, 0.2);
  outline.lineTo(-0.74, -0.2);
  const windowHole = new Path();
  windowHole.moveTo(-0.27, -0.12);
  windowHole.lineTo(0.37, -0.12);
  windowHole.lineTo(0.37, 0.12);
  windowHole.lineTo(-0.27, 0.12);
  windowHole.lineTo(-0.27, -0.12);
  outline.holes.push(windowHole);
  const geometry = new ExtrudeGeometry(outline, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 5, curveSegments: 32 });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -0.035, 0);
  const group = new Group();
  group.add(mesh(geometry, material(hex, 0.35, 0.05)));
  const pad = new BoxGeometry(0.52, 0.006, 0.4);
  group.add(mesh(pad, material("#3a3d40", 0.9, 0), -0.48, DECK_Y + 0.003, 0));
  const glass = new MeshStandardMaterial({ color: "#ffffff", transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0, depthWrite: false });
  const pane = mesh(new PlaneGeometry(0.64, 0.24), glass, 0.05, DECK_Y + 0.001, 0);
  pane.rotation.x = -Math.PI / 2;
  group.add(pane);
  return group;
}

function battery(sku: string, colour: string, fill: number): Group {
  const length = PACK_LENGTH[shape(sku).pack];
  const group = new Group();
  group.add(mesh(new BoxGeometry(length, 0.08, 0.19), material(hue(colour), 0.55, 0.05)));
  group.add(mesh(new BoxGeometry(0.05, 0.03, 0.08), material("#2b2d30"), length / 2 - 0.05, 0.05, 0));
  const cell = (length - 0.16) / 4;
  for (let i = 0; i < 4; i++) {
    const bar = mesh(new BoxGeometry(cell - 0.012, 0.012, 0.06), material(i < fill ? CHARGE_ON : CHARGE_OFF, 0.4), -length / 2 + 0.04 + cell * (i + 0.5), 0.041, 0);
    bar.userData.charge = i;
    group.add(bar);
  }
  return group;
}

/** Lights the pack's charge bar to `fill` quarters wherever a battery block is drawn. */
function light(object: Object3D, fill: number): void {
  object.traverse((child) => {
    if (child instanceof Mesh && typeof child.userData.charge === "number") {
      (child.material as MeshStandardMaterial).color.set(child.userData.charge < fill ? CHARGE_ON : CHARGE_OFF);
    }
  });
}

/** Wing outlines (metres): half span, root chord and how far the tips sweep back, from Seed data's Shape column. */
const PLANFORMS: Record<PartShape["wing"], { half: number; chord: number; sweep: number }> = {
  broad: { half: 0.43, chord: 0.2, sweep: 0.03 },
  swept: { half: 0.4, chord: 0.15, sweep: 0.12 },
  wide: { half: 0.5, chord: 0.15, sweep: 0.09 },
  narrow: { half: 0.31, chord: 0.12, sweep: 0.1 },
};

/**
 * One thin lifting surface lying flat in the x–z plane, joined across the fuselage: a straight leading edge swept
 * back toward the tips and a curved trailing edge narrowing to a rounded tip.
 */
function foil(plan: { half: number; chord: number; sweep: number }, hex: string, x: number, y: number): Mesh {
  const steps = 24;
  const lead = (s: number) => plan.chord * 0.35 - (plan.sweep * Math.abs(s)) / plan.half;
  const chord = (s: number) => plan.chord * (0.16 + 0.84 * Math.sqrt(Math.max(0, 1 - (s / plan.half) ** 2)));
  const outline = new Shape();
  outline.moveTo(lead(-plan.half), -plan.half);
  outline.lineTo(lead(0), 0);
  outline.lineTo(lead(plan.half), plan.half);
  for (let i = steps; i >= -steps; i--) {
    const s = (plan.half * i) / steps;
    outline.lineTo(lead(s) - chord(s), s);
  }
  outline.lineTo(lead(-plan.half), -plan.half);
  const geometry = new ExtrudeGeometry(outline, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 8 });
  geometry.rotateX(-Math.PI / 2);
  return mesh(geometry, material(hex, 0.4), x, y, 0);
}

function wing(kind: PartShape["wing"], hex: string, y: number): Group {
  const group = new Group();
  group.add(foil(PLANFORMS[kind], hex, 0.2, y - 0.02));
  const stabiliser = PLANFORMS[kind];
  group.add(foil({ half: stabiliser.half * 0.4, chord: stabiliser.chord * 0.5, sweep: stabiliser.sweep * 0.4 }, hex, -0.5, y - 0.012));
  const fuselage = mesh(new CylinderGeometry(0.016, 0.012, 0.76, 16), material(hex, 0.4), -0.14, y - 0.015, 0);
  fuselage.rotation.z = Math.PI / 2;
  group.add(fuselage);
  return group;
}

function part(slot: Slot, sku: string, colour: string, mastM: number, fill: number): Group {
  const look = shape(sku);
  const hex = hue(colour);
  const group = new Group();
  const bottom = -0.05 - mastM;
  if (slot === "wing") {
    group.add(wing(look.wing, hex, bottom));
  } else if (slot === "mast") {
    const metal = colour === "brushed silver";
    const geometry = look.mast === "round" ? new CylinderGeometry(0.024, 0.024, mastM, 20) : new BoxGeometry(0.11, mastM, 0.024);
    group.add(mesh(geometry, material(hex, metal ? 0.3 : 0.5, metal ? 0.6 : 0.1), MAST_X, -0.05 - mastM / 2, 0));
  } else if (slot === "propulsion") {
    const y = -0.05 - mastM * 0.55;
    const pod = mesh(new CapsuleGeometry(0.048, 0.2, 8, 20), material(hex, 0.4), MAST_X, y, 0);
    pod.rotation.z = Math.PI / 2;
    group.add(pod);
    const hub = MAST_X - 0.18;
    for (let i = 0; i < look.blades; i++) {
      const blade = mesh(new BoxGeometry(0.012, 0.13, 0.034), material(hex, 0.35), hub, y, 0);
      blade.geometry.translate(0, 0.065, 0);
      blade.rotation.x = (i * 2 * Math.PI) / look.blades + 0.4;
      if (look.folding) blade.rotation.z = -0.5;
      group.add(blade);
    }
  } else if (slot === "battery") {
    group.add(battery(sku, colour, fill));
  } else {
    const handle = mesh(new CapsuleGeometry(0.028, 0.12, 6, 16), material(hex, 0.5), CONTROLLER.x, CONTROLLER.y - 0.04, CONTROLLER.z);
    handle.rotation.z = 0.35;
    const head = mesh(new SphereGeometry(0.04, 20, 12), material(hex, 0.5), CONTROLLER.x + 0.03, CONTROLLER.y + 0.04, CONTROLLER.z);
    group.add(handle, head);
    if (look.grip === "ring") {
      const ring = mesh(new TorusGeometry(0.036, 0.008, 10, 28), material(RING, 0.35), CONTROLLER.x + 0.015, CONTROLLER.y, CONTROLLER.z);
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
    } else {
      group.add(mesh(new BoxGeometry(0.02, 0.05, 0.016), material(hex, 0.5), CONTROLLER.x + 0.05, CONTROLLER.y - 0.01, CONTROLLER.z));
    }
  }
  return group;
}

function shadowTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, "rgba(17,17,17,0.28)");
  g.addColorStop(1, "rgba(17,17,17,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(canvas);
}

function fade(object: Object3D, opacity: number): void {
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const mat = child.material as MeshStandardMaterial;
    if (mat.userData.base === undefined) mat.userData.base = mat.opacity;
    mat.transparent = opacity < 1 || mat.userData.base < 1;
    mat.opacity = (mat.userData.base as number) * opacity;
    mat.depthWrite = opacity >= 1 && mat.userData.base >= 1;
  });
}

export function createScene(canvas: HTMLCanvasElement) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.05, 50);
  scene.add(new HemisphereLight("#ffffff", "#c9d1d4", 1.6));
  const key = new DirectionalLight("#ffffff", 2.4);
  key.position.set(2.2, 4, 1.6);
  const fill = new DirectionalLight("#eef4f6", 0.7);
  fill.position.set(-2, 1.5, -2);
  scene.add(key, fill);
  const shadow = mesh(new PlaneGeometry(3, 1.6), new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }), -0.05, -1.32, 0);
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  const root = new Group();
  root.scale.setScalar(MODEL_SCALE);
  root.position.y = 0.08;
  scene.add(root);
  let board = new Group();
  const slots = new Map<Slot, Group>();
  let leaving: Group | null = null;
  let spares = new Group();
  let ghost: Group | null = null;
  let mastM = 0.711;
  let charge = 1;

  function placeSpares(build: SceneBuild): void {
    root.remove(spares);
    spares = new Group();
    for (let i = 0; i < build.spares; i++) {
      const copy = battery(build.parts.battery.sku, build.parts.battery.colour, charge);
      copy.position.set(-0.42, -0.17, 0.5 + i * 0.25);
      copy.rotation.y = -0.06;
      spares.add(copy);
    }
    root.add(spares);
  }

  return {
    setBuild(build: SceneBuild, swap: { slot: Slot } | null) {
      mastM = Number(build.mastM);
      if (swap) {
        leaving = slots.get(swap.slot) ?? null;
        const incoming = part(swap.slot, build.parts[swap.slot].sku, build.parts[swap.slot].colour, mastM, charge);
        fade(incoming, 0);
        slots.set(swap.slot, incoming);
        root.add(incoming);
      } else {
        root.clear();
        slots.clear();
        board = hull(hue(build.finish));
        root.add(board);
        for (const slot of SLOTS) {
          const g = part(slot, build.parts[slot].sku, build.parts[slot].colour, mastM, charge);
          slots.set(slot, g);
          root.add(g);
        }
      }
      placeSpares(build);
    },
    /** Old part progress and new part progress, each eased from 0 to 1. */
    swapProgress(slot: Slot, oldT: number, newT: number) {
      const incoming = slots.get(slot);
      if (leaving) {
        leaving.position.y = -0.08 * oldT;
        fade(leaving, 1 - oldT);
        if (oldT >= 1) {
          root.remove(leaving);
          leaving = null;
        }
      }
      if (incoming) {
        incoming.position.y = -0.08 * (1 - newT);
        fade(incoming, newT);
      }
    },
    /** Charges the drawn packs to `bars` quarters. */
    setFill(bars: number) {
      charge = bars;
      light(root, charge);
    },
    ghost(slot: Slot | null, sku: string | null, colour: string | null) {
      if (ghost) root.remove(ghost);
      ghost = null;
      for (const [s, g] of slots) g.visible = !(sku && s === slot);
      if (sku && colour && slot) {
        ghost = part(slot, sku, colour, mastM, charge);
        fade(ghost, 0.25);
        root.add(ghost);
      }
    },
    resize(width: number, height: number) {
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },
    render(pose: Pose) {
      const p = position(pose);
      const u = up(pose);
      camera.position.set(p.x, p.y, p.z);
      camera.up.set(u.x, u.y, u.z);
      camera.lookAt(TARGET.x, TARGET.y, TARGET.z);
      renderer.render(scene, camera);
    },
  };
}
