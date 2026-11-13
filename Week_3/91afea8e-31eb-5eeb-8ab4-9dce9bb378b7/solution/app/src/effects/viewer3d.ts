/**
 * The 3D product viewer: a procedural model built from primitives, framed to fill its panel, turning once every 30 s,
 * orbiting on drag (also under reduced motion), tilting up to 10 degrees with device orientation on phones.
 * Under reduced motion nothing runs on its own: a frame is drawn only when something changes.
 */
import {
  AmbientLight,
  Box3,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  LatheGeometry,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const TURN_SECONDS = 30;
const MAX_TILT = MathUtils.degToRad(10);
const FOV = 32;

const COLOR = {
  steelMid: 0xaeb6c4,
  steelLight: 0xeef1f6,
  steelDark: 0x6c7589,
  black: 0x07070f,
  yellow: 0xffd60a,
  yellowDeep: 0xd9a900,
  pink: 0xff2d95,
  accent: 0x00e58a,
  accentDeep: 0x00a862,
  slate: 0x2c3170,
  slateLight: 0x4a52a3,
  slateDeep: 0x181c4d,
} as const;

function material(color: number, metalness = 0.1, roughness = 0.6): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: new Color(color), metalness, roughness, flatShading: true, side: DoubleSide });
}

function part(geometry: BufferGeometry, color: number, at: [number, number, number] = [0, 0, 0], metal = 0.1, rough = 0.6): Mesh {
  const mesh = new Mesh(geometry, material(color, metal, rough));
  mesh.position.set(...at);
  return mesh;
}

const steel = (geometry: BufferGeometry, at: [number, number, number], tone: number = COLOR.steelMid): Mesh => part(geometry, tone, at, 0.55, 0.35);
const cylinder = (top: number, bottom: number, height: number, sides = 40): CylinderGeometry => new CylinderGeometry(top, bottom, height, sides);
const box = (x: number, y: number, z: number): BoxGeometry => new BoxGeometry(x, y, z);
const rounded = (x: number, y: number, z: number, radius: number): RoundedBoxGeometry => new RoundedBoxGeometry(x, y, z, 4, radius);

function build(...children: Object3D[]): Group {
  const group = new Group();
  group.add(...children);
  return group;
}

function tiffin(): Group {
  const tiers = [0.3, 0.92, 1.54].flatMap((y) => [
    steel(cylinder(0.8, 0.8, 0.56), [0, y, 0]),
    steel(cylinder(0.86, 0.86, 0.08), [0, y + 0.2, 0], COLOR.steelLight),
    steel(cylinder(0.86, 0.86, 0.06), [0, y - 0.04, 0], COLOR.steelDark),
  ]);
  const lid = steel(new SphereGeometry(0.82, 36, 12, 0, Math.PI * 2, 0, Math.PI / 2), [0, 1.84, 0], COLOR.steelLight);
  const rodLeft = steel(cylinder(0.04, 0.04, 2.5), [-0.9, 1.2, 0], COLOR.steelDark);
  const rodRight = steel(cylinder(0.04, 0.04, 2.5), [0.9, 1.2, 0], COLOR.steelDark);
  return build(
    ...tiers,
    lid,
    part(new SphereGeometry(0.1, 16, 12), COLOR.yellow, [0, 2.7, 0]),
    rodLeft,
    rodRight,
    part(rounded(1.9, 0.14, 0.2, 0.06), COLOR.yellow, [0, 2.46, 0]),
    steel(cylinder(0.95, 0.95, 0.07), [0, -0.1, 0], COLOR.steelDark),
  );
}

function cooker(): Group {
  const handle = part(rounded(1, 0.16, 0.22, 0.07), COLOR.black, [-1.5, 0.55, 0]);
  const helper = part(rounded(0.55, 0.14, 0.2, 0.06), COLOR.black, [1.3, 0.55, 0]);
  return build(
    steel(cylinder(1, 1, 1.3), [0, 0.65, 0]),
    steel(cylinder(1.06, 1.06, 0.12), [0, 1.34, 0], COLOR.steelDark),
    steel(new SphereGeometry(1.04, 40, 12, 0, Math.PI * 2, 0, Math.PI / 3.2), [0, 1.36, 0], COLOR.steelLight),
    handle,
    helper,
    part(cylinder(0.14, 0.14, 0.4), COLOR.slate, [0, 2.0, 0]),
    part(cylinder(0.22, 0.22, 0.12), COLOR.yellow, [0, 2.26, 0]),
    part(new SphereGeometry(0.1, 16, 12), COLOR.pink, [0.55, 1.78, 0.5]),
    part(rounded(1.3, 0.1, 0.16, 0.05), COLOR.black, [0, 1.74, 0]),
  );
}

function bottle(): Group {
  const profile = [
    new Vector2(0, 0), new Vector2(0.5, 0), new Vector2(0.58, 0.08), new Vector2(0.58, 1.5),
    new Vector2(0.5, 1.85), new Vector2(0.24, 2.15), new Vector2(0.24, 2.7), new Vector2(0.28, 2.74), new Vector2(0, 2.74),
  ];
  const body = steel(new LatheGeometry(profile, 40), [0, 0, 0]);
  const dimples = Array.from({ length: 12 }, (_, index) => {
    const angle = (index / 12) * Math.PI * 2;
    const dimple = part(new SphereGeometry(0.07, 8, 6), COLOR.steelDark, [Math.cos(angle) * 0.58, 0.5 + (index % 4) * 0.28, Math.sin(angle) * 0.58]);
    dimple.scale.set(1, 0.7, 0.4);
    dimple.rotation.y = -angle;
    return dimple;
  });
  return build(
    body,
    ...dimples,
    part(new TorusGeometry(0.585, 0.045, 8, 40), COLOR.pink, [0, 1.0, 0]).rotateX(Math.PI / 2),
    part(cylinder(0.32, 0.3, 0.34), COLOR.yellow, [0, 2.86, 0]),
  );
}

function cloth(width: number, height: number, color: number, wave: number, at: [number, number, number]): Mesh {
  const geometry = new PlaneGeometry(width, height, 28, 36);
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    position.setZ(index, Math.sin(x * 4.2 + y * 0.8) * wave + Math.cos(y * 2.4) * wave * 0.4);
  }
  geometry.computeVertexNormals();
  return part(geometry, color, at, 0.02, 0.9);
}

function saree(): Group {
  const border = cloth(2.2, 0.34, COLOR.black, 0.16, [0, -1.18, 0.03]);
  const stripe = cloth(2.2, 0.1, COLOR.yellow, 0.16, [0, -0.9, 0.03]);
  const pallu = cloth(1.5, 1.2, COLOR.accentDeep, 0.16, [0.35, 0.65, 0.04]);
  pallu.rotation.z = -0.5;
  const edge = cloth(0.14, 2.7, COLOR.yellow, 0.16, [-1.1, 0, 0.03]);
  return build(cloth(2.2, 2.7, COLOR.accent, 0.16, [0, 0, 0]), pallu, border, stripe, edge);
}

function kurta(): Group {
  const sleeves = [-1, 1].map((side) => {
    const sleeve = part(rounded(0.9, 0.55, 0.46, 0.1), COLOR.yellow, [side * 1.12, 0.78, 0]);
    sleeve.rotation.z = -side * 0.55;
    return sleeve;
  });
  const buttons = [0.7, 0.35, 0].map((y) => part(new SphereGeometry(0.04, 10, 8), COLOR.black, [0, y, 0.25]));
  const print = [-0.5, -0.25, 0, 0.25, 0.5].map((x) => part(new ConeGeometry(0.07, 0.12, 4), x === 0 ? COLOR.pink : COLOR.black, [x, 0.5, 0.245]));
  return build(
    part(rounded(1.6, 2.1, 0.46, 0.1), COLOR.yellow, [0, 0, 0]),
    ...sleeves,
    part(new TorusGeometry(0.2, 0.05, 8, 24), COLOR.black, [0, 1.02, 0]).rotateX(Math.PI / 2),
    part(box(0.14, 1.0, 0.03), COLOR.yellowDeep, [0, 0.45, 0.24]),
    ...buttons,
    ...print,
    part(box(1.62, 0.22, 0.48), COLOR.black, [0, -0.9, 0]),
  );
}

function speaker(): Group {
  const dots = [-0.45, 0, 0.45].map((x, index) => part(cylinder(0.08, 0.08, 0.06, 20), [COLOR.pink, COLOR.yellow, COLOR.accent][index] as number, [x, -0.85, 0.52]).rotateX(Math.PI / 2));
  return build(
    part(rounded(1.7, 2.3, 1.05, 0.25), COLOR.slate, [0, 0, 0]),
    part(new TorusGeometry(0.62, 0.07, 10, 40), COLOR.yellow, [0, -0.2, 0.52]),
    part(cylinder(0.56, 0.2, 0.34, 40), COLOR.slateDeep, [0, -0.2, 0.42]).rotateX(Math.PI / 2),
    part(new SphereGeometry(0.16, 20, 12), COLOR.yellow, [0, -0.2, 0.5]),
    part(new TorusGeometry(0.26, 0.04, 8, 28), COLOR.slateLight, [0, 0.72, 0.52]),
    part(cylinder(0.2, 0.2, 0.08, 28), COLOR.slateDeep, [0, 0.72, 0.52]).rotateX(Math.PI / 2),
    ...dots,
    part(new TorusGeometry(0.4, 0.045, 8, 30, Math.PI), COLOR.yellow, [0, 1.15, 0]),
  );
}

function watch(): Group {
  const ticks = Array.from({ length: 12 }, (_, index) => {
    const angle = (index / 12) * Math.PI * 2;
    return part(box(0.04, index % 3 === 0 ? 0.14 : 0.07, 0.02), index % 3 === 0 ? COLOR.yellow : COLOR.steelMid, [Math.sin(angle) * 0.46, Math.cos(angle) * 0.46, 0.2]).rotateZ(-angle);
  });
  const minute = part(box(0.045, 0.4, 0.02), COLOR.steelLight, [0, 0.2, 0.21]);
  const hour = part(box(0.05, 0.28, 0.02), COLOR.pink, [0.12, -0.06, 0.215]);
  hour.rotation.z = 1.1;
  return build(
    part(rounded(1.3, 1.5, 0.36, 0.34), COLOR.slateDeep, [0, 0, 0]),
    part(rounded(1.1, 1.3, 0.1, 0.28), COLOR.black, [0, 0, 0.16]),
    ...ticks,
    minute,
    hour,
    part(new SphereGeometry(0.05, 12, 8), COLOR.accent, [0, 0, 0.22]),
    part(rounded(0.2, 0.36, 0.2, 0.06), COLOR.yellow, [0.74, 0.1, 0]),
    part(rounded(0.76, 1.1, 0.14, 0.1), COLOR.slate, [0, 1.25, -0.05]),
    part(rounded(0.76, 1.1, 0.14, 0.1), COLOR.slate, [0, -1.25, -0.05]),
  );
}

function earbuds(): Group {
  const bud = (side: number): Group => {
    const group = build(
      part(new SphereGeometry(0.3, 24, 16), COLOR.steelLight, [0, 0, 0], 0.1, 0.4),
      part(new CapsuleGeometry(0.09, 0.5, 6, 12), COLOR.steelMid, [side * 0.1, -0.5, 0]),
      part(new SphereGeometry(0.1, 12, 8), COLOR.slateDeep, [-side * 0.1, 0.08, 0.26]),
      part(new SphereGeometry(0.04, 10, 8), COLOR.pink, [side * 0.18, -0.14, 0.26]),
    );
    group.position.set(side * 0.55, 0.95, 0);
    group.rotation.z = side * 0.25;
    return group;
  };
  return build(
    part(rounded(2.1, 1.0, 1.0, 0.4), COLOR.slate, [0, 0, 0]),
    part(rounded(2.1, 0.3, 1.0, 0.14), COLOR.yellow, [0, 0.62, 0]),
    part(new SphereGeometry(0.07, 12, 8), COLOR.accent, [0, -0.1, 0.5]),
    bud(-1),
    bud(1),
  );
}

function powerbank(): Group {
  const bars = [0, 1, 2, 3, 4].map((index) => part(rounded(0.2, 0.34, 0.05, 0.02), index < 4 ? COLOR.accent : COLOR.slateLight, [-0.6 + index * 0.3, -0.02, 0.29]));
  const ports = [
    part(box(0.34, 0.07, 0.2), COLOR.black, [-0.55, 0.66, 0]),
    part(box(0.34, 0.07, 0.2), COLOR.black, [-0.05, 0.66, 0]),
    part(rounded(0.46, 0.07, 0.2, 0.03), COLOR.black, [0.55, 0.66, 0]),
  ];
  return build(
    part(rounded(2.4, 1.3, 0.56, 0.18), COLOR.slate, [0, 0, 0]),
    part(rounded(1.9, 0.7, 0.04, 0.1), COLOR.black, [0, 0, 0.28]),
    ...bars,
    ...ports,
    part(new SphereGeometry(0.05, 10, 8), COLOR.yellow, [-0.9, -0.45, 0.29]),
    part(new SphereGeometry(0.05, 10, 8), COLOR.yellow, [-0.75, -0.45, 0.29]),
    part(new ConeGeometry(0.1, 0.2, 3), COLOR.pink, [0.8, -0.45, 0.29]),
  );
}

function fan(): Group {
  const blades = [0, 1, 2, 3].map((index) => {
    const blade = part(box(0.38, 0.95, 0.03), COLOR.yellow, [0, 0.5, 0]);
    const holder = new Group();
    holder.add(blade);
    holder.rotation.z = (index * Math.PI) / 2 + 0.3;
    blade.rotation.y = 0.5;
    return holder;
  });
  const spokes = [0, 1, 2, 3, 4, 5].map((index) => {
    const spoke = part(box(0.025, 2.4, 0.025), COLOR.slateLight, [0, 0, 0.1]);
    spoke.rotation.z = (index * Math.PI) / 6;
    return spoke;
  });
  const head = build(
    part(new TorusGeometry(1.2, 0.06, 10, 48), COLOR.steelMid, [0, 0, 0.12], 0.5, 0.4),
    part(new TorusGeometry(0.8, 0.03, 8, 40), COLOR.slateLight, [0, 0, 0.12]),
    part(new TorusGeometry(0.4, 0.03, 8, 32), COLOR.slateLight, [0, 0, 0.12]),
    part(cylinder(1.2, 1.2, 0.1, 48), COLOR.slateDeep, [0, 0, -0.1]).rotateX(Math.PI / 2),
    ...blades,
    ...spokes,
    part(new SphereGeometry(0.17, 20, 14), COLOR.pink, [0, 0, 0.1]),
  );
  head.position.set(0, 1.5, 0);
  head.rotation.x = -0.15;
  return build(
    head,
    part(cylinder(0.12, 0.16, 1.0), COLOR.slate, [0, 0.3, 0]),
    part(rounded(1.6, 0.2, 1.0, 0.09), COLOR.slate, [0, -0.2, 0]),
  );
}

function crate(): Group {
  const cans = Array.from({ length: 12 }, (_, index) => {
    const column = index % 6;
    const row = Math.floor(index / 6);
    const x = -1.05 + column * 0.42;
    const z = -0.3 + row * 0.6;
    return build(
      part(cylinder(0.19, 0.19, 0.8), COLOR.accent, [x, 0.9, z]),
      part(cylinder(0.195, 0.195, 0.22), index % 2 === 0 ? COLOR.pink : COLOR.yellow, [x, 0.84, z]),
      steel(cylinder(0.17, 0.19, 0.04), [x, 1.32, z], COLOR.steelLight),
    );
  });
  const slots = [0, 1, 2, 3, 4, 5].map((index) => part(box(0.3, 0.38, 0.03), COLOR.black, [-1.05 + index * 0.42, 0.0, 0.81]));
  return build(
    part(rounded(2.7, 1.0, 1.7, 0.08), COLOR.yellow, [0, 0, 0]),
    part(box(2.74, 0.1, 1.74), COLOR.yellowDeep, [0, 0.46, 0]),
    ...slots,
    ...cans,
  );
}

function can(): Group {
  return build(
    part(cylinder(0.6, 0.6, 2.0), COLOR.accent, [0, 0, 0]),
    part(cylinder(0.605, 0.605, 0.6), COLOR.pink, [0, 0.1, 0]),
    steel(cylinder(0.56, 0.6, 0.1), [0, 1.04, 0], COLOR.steelLight),
    steel(new TorusGeometry(0.16, 0.025, 6, 16), [0.1, 1.1, 0.0], COLOR.steelDark).rotateX(Math.PI / 2),
  );
}

const BY_PRODUCT: Record<string, () => Group> = {
  "steel-tiffin-3": tiffin,
  "pressure-cooker-5l": cooker,
  "copper-bottle-1l": bottle,
  "ilkal-saree": saree,
  "cotton-kurta": kurta,
  "dhwani-speaker": speaker,
  "tara-smartwatch": watch,
  "lehar-earbuds": earbuds,
  "jugnu-powerbank": powerbank,
  "pankha-desk-fan": fan,
  "jaljeera-fizz-24": crate,
};

const BY_CATEGORY: Record<string, () => Group> = { kitchen: cooker, fashion: kurta, electronics: powerbank, beverages: can };

function model(productId: string, category: string): Group {
  return (BY_PRODUCT[productId] ?? BY_CATEGORY[category] ?? powerbank)();
}

interface ViewerOptions {
  productId: string;
  category: string;
  reduced: boolean;
}

interface Viewer {
  dispose: () => void;
}

interface OrientationEventWithPermission {
  requestPermission?: () => Promise<"granted" | "denied">;
}

/** Builds the viewer inside `host`. Returns null when WebGL is not available. */
export function createViewer(host: HTMLElement, options: ViewerOptions): Viewer | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = "viewer__canvas";
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 0.9));
  scene.add(new HemisphereLight(0xdfe4ff, 0x20246b, 1.2));
  const key = new DirectionalLight(0xffffff, 2.6);
  key.position.set(3, 4, 5);
  scene.add(key);
  const rim = new DirectionalLight(0xaab4ff, 1.1);
  rim.position.set(-4, 1, -3);
  scene.add(rim);

  const subject = model(options.productId, options.category);
  const bounds = new Box3().setFromObject(subject);
  const centre = bounds.getCenter(new Vector3());
  subject.position.sub(centre);
  const radius = bounds.getSize(new Vector3()).length() / 2;
  const orbit = new Group();
  orbit.add(subject);
  const tilt = new Group();
  tilt.add(orbit);
  scene.add(tilt);

  const camera = new PerspectiveCamera(FOV, 1, 0.1, 100);
  let yaw = 0.6;
  let pitch = 0.18;
  let wait = 0;
  let frame = 0;
  let last = 0;
  let visible = true;
  let disposed = false;

  const render = (): void => {
    orbit.rotation.set(pitch, yaw, 0);
    renderer.render(scene, camera);
  };

  const fit = (): void => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const half = MathUtils.degToRad(FOV / 2);
    const reach = Math.atan(Math.tan(half) * Math.min(1, camera.aspect));
    const distance = (radius * 0.98) / Math.sin(reach);
    camera.position.set(0, distance * 0.12, distance);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  };

  const draw = (now: number): void => {
    frame = 0;
    if (disposed) return;
    const seconds = last === 0 ? 0 : Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!dragging) yaw += (seconds * Math.PI * 2) / TURN_SECONDS;
    render();
    if (!options.reduced && visible) frame = requestAnimationFrame(draw);
  };

  const run = (): void => {
    if (frame === 0 && !disposed && !options.reduced && visible) {
      last = 0;
      frame = requestAnimationFrame(draw);
    }
  };

  const once = (): void => {
    if (wait === 0 && frame === 0 && !disposed) {
      wait = requestAnimationFrame(() => {
        wait = 0;
        render();
      });
    }
  };

  let dragging = false;
  let from = { x: 0, y: 0 };
  const down = (event: PointerEvent): void => {
    dragging = true;
    from = { x: event.clientX, y: event.clientY };
    host.setPointerCapture(event.pointerId);
    askOrientation();
  };
  const move = (event: PointerEvent): void => {
    if (!dragging) return;
    yaw += (event.clientX - from.x) * 0.012;
    pitch = MathUtils.clamp(pitch + (event.clientY - from.y) * 0.008, -0.7, 0.7);
    from = { x: event.clientX, y: event.clientY };
    if (options.reduced) render();
    else once();
  };
  const up = (event: PointerEvent): void => {
    dragging = false;
    if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
  };

  const orient = (event: DeviceOrientationEvent): void => {
    tilt.rotation.x = MathUtils.clamp(((event.beta ?? 45) - 45) / 45, -1, 1) * MAX_TILT;
    tilt.rotation.z = -MathUtils.clamp((event.gamma ?? 0) / 45, -1, 1) * MAX_TILT;
    once();
  };
  const phone = window.matchMedia("(pointer: coarse)").matches && !options.reduced;
  let listening = false;
  function listen(): void {
    if (listening) return;
    listening = true;
    window.addEventListener("deviceorientation", orient);
  }
  function askOrientation(): void {
    if (!phone || listening) return;
    const ask = (DeviceOrientationEvent as unknown as OrientationEventWithPermission).requestPermission;
    if (typeof ask === "function") void ask().then((answer) => answer === "granted" && listen());
  }
  if (phone && typeof (DeviceOrientationEvent as unknown as OrientationEventWithPermission).requestPermission !== "function") listen();

  const resize = new ResizeObserver(() => {
    fit();
    if (options.reduced) render();
  });
  resize.observe(host);
  const watch = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    if (visible) run();
  });
  watch.observe(host);

  host.addEventListener("pointerdown", down);
  host.addEventListener("pointermove", move);
  host.addEventListener("pointerup", up);
  host.addEventListener("pointercancel", up);

  fit();
  render();
  run();

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(wait);
      resize.disconnect();
      watch.disconnect();
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", up);
      window.removeEventListener("deviceorientation", orient);
      scene.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry.dispose();
          (object.material as MeshStandardMaterial).dispose();
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
