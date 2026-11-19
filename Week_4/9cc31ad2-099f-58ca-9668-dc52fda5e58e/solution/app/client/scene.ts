import * as THREE from "three";

// Cars built in code from simple solids (body, cabin, four wheels) in the cream, ink and accent palette.
export const PALETTE = { paper: 0xf3ead3, surface: 0xfaf5e6, ink: 0x1c1a16, accent: 0xb93e0b, kerb: 0xd9cdb0 } as const;

interface Proportions {
  readonly length: number;
  readonly width: number;
  readonly body: number;
  readonly cabin: number;
  readonly cabinLength: number;
  readonly cabinBack: number;
}

const SHAPES: Readonly<Record<string, Proportions>> = {
  "kestrel-hatch": { length: 3.9, width: 1.75, body: 0.75, cabin: 0.72, cabinLength: 2.3, cabinBack: -0.55 },
  "wren-coupe": { length: 4.3, width: 1.8, body: 0.68, cabin: 0.55, cabinLength: 1.9, cabinBack: -0.35 },
  "moth-roadster": { length: 3.9, width: 1.72, body: 0.62, cabin: 0.32, cabinLength: 1.1, cabinBack: -0.4 },
  "halcyon-rs": { length: 4.4, width: 1.85, body: 0.66, cabin: 0.56, cabinLength: 2.0, cabinBack: -0.3 },
  "ferrule-sport": { length: 4.5, width: 1.9, body: 0.6, cabin: 0.5, cabinLength: 1.8, cabinBack: -0.2 },
  "vantor-8": { length: 4.7, width: 1.95, body: 0.55, cabin: 0.46, cabinLength: 1.7, cabinBack: 0 },
};

export function buildCar(carId: string, bodyColour: number, ghost = false): THREE.Group {
  const shape = SHAPES[carId] ?? SHAPES["kestrel-hatch"];
  const group = new THREE.Group();
  const material = (colour: number) => ghost
    ? new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.28, wireframe: true })
    : new THREE.MeshLambertMaterial({ color: colour });
  const wheelRadius = 0.4;
  const wheelWidth = 0.34;
  const body = new THREE.Mesh(new THREE.BoxGeometry(shape.length, shape.body, shape.width), material(bodyColour));
  body.position.y = wheelRadius + shape.body / 2;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(shape.cabinLength, shape.cabin, shape.width * 0.86), material(PALETTE.surface));
  cabin.position.set(shape.cabinBack, wheelRadius + shape.body + shape.cabin / 2, 0);
  group.add(cabin);
  const wheelGeometry = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 18);
  wheelGeometry.rotateX(Math.PI / 2);
  for (const x of [shape.length * 0.32, -shape.length * 0.32]) {
    // The track is wider than the body, so all four wheels show from a raised three-quarter view.
    for (const z of [shape.width / 2 + wheelWidth / 2 + 0.1, -shape.width / 2 - wheelWidth / 2 - 0.1]) {
      const wheel = new THREE.Mesh(wheelGeometry, material(PALETTE.ink));
      wheel.position.set(x, wheelRadius, z);
      group.add(wheel);
    }
  }
  return group;
}

export function lights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xfff8ea, 0x8a7d66, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(6, 10, 4);
  scene.add(sun);
}

// A WebGL 2 renderer on the canvas, or null when WebGL 2 is missing.
export function webgl2Renderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer | null {
  const context = canvas.getContext("webgl2", { antialias: true, alpha: false });
  if (!context) return null;
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(PALETTE.paper, 1);
  return renderer;
}
