import {
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { CanView } from "./Turntable";
import { FLAVOUR_COPY } from "./flavours";

// The 3D can, generated in code: a lathe profile with a necked shoulder, rolled rim and lid,
// brushed aluminium ends and a label texture painted on a canvas (flavour colour and band, the
// CEIBO wordmark and a ring of mate leaves). No model file is loaded.

function paintLabel(slug: string): CanvasTexture {
  const look = FLAVOUR_COPY[slug];
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2d canvas unavailable");
  g.fillStyle = look.label;
  g.fillRect(0, 0, 1024, 512);
  g.fillStyle = look.band;
  g.fillRect(0, 392, 1024, 46);
  g.fillRect(0, 40, 1024, 14);
  for (let i = 0; i < 28; i++) {
    g.save();
    g.translate(18 + i * 37, i % 2 ? 360 : 348);
    g.rotate(i % 2 ? 0.45 : -0.45);
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(9, -12, 29, -12, 38, 0);
    g.bezierCurveTo(29, 12, 9, 12, 0, 0);
    g.fill();
    g.restore();
  }
  // The front of the can faces the camera at u = 0.5. The wordmark sits on the front and the
  // back (drawn across the seam at u = 0), so the idle turn always shows it; the band on the
  // sides carries the volume line.
  g.textAlign = "center";
  for (const x of [0, 512, 1024]) {
    g.fillStyle = look.band;
    g.beginPath();
    g.arc(x, 128, 30, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = look.ink;
    g.font = "700 96px Fraunces, Georgia, serif";
    g.fillText("CEIBO", x, 252);
    g.font = "700 26px 'Atkinson Hyperlegible', sans-serif";
    g.fillText("SPARKLING YERBA MATE", x, 300);
  }
  g.font = "700 22px 'Atkinson Hyperlegible', sans-serif";
  // The bands are light, so cans with cream ink letter them in the label colour instead.
  g.fillStyle = look.ink === "#f6eedc" ? look.label : look.ink;
  for (const x of [256, 768]) g.fillText("ORGANIC · 355 ML", x, 423);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createCanView(host: HTMLElement): CanView | null {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", { antialias: true, alpha: true }) ?? canvas.getContext("webgl", { antialias: true, alpha: true });
  if (!context) return null;
  const renderer = new WebGLRenderer({ canvas, context, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(new Color(0x000000), 0);
  host.append(canvas);

  const scene = new Scene();
  const environment = new PMREMGenerator(renderer);
  scene.environment = environment.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0.35, 9.2);
  camera.lookAt(0, 0, 0);

  scene.add(new HemisphereLight(0xf6eedc, 0x0f1d14, 0.6));
  const key = new DirectionalLight(0xffffff, 1.8);
  key.position.set(3.5, 4, 5);
  scene.add(key);
  const rim = new DirectionalLight(0x8cc47a, 1.4);
  rim.position.set(-5, 1.5, -3);
  scene.add(rim);

  const metal = new MeshStandardMaterial({ color: 0xd8ddd8, metalness: 0.9, roughness: 0.35 });
  const labels = new Map<string, CanvasTexture>();
  const labelMaterial = new MeshStandardMaterial({ metalness: 0.35, roughness: 0.42 });

  const can = new Group();
  const body = new Mesh(new CylinderGeometry(1, 1, 2.9, 96, 1, true, Math.PI), labelMaterial);
  can.add(body);
  const profile = [
    [0.0, 1.72],
    [0.78, 1.72],
    [0.84, 1.69],
    [0.84, 1.62],
    [0.9, 1.6],
    [1.0, 1.45],
  ].map(([x, y]) => new Vector2(x, y));
  can.add(new Mesh(new LatheGeometry(profile, 96), metal));
  const base = [
    [1.0, -1.45],
    [0.95, -1.6],
    [0.82, -1.7],
    [0.0, -1.62],
  ].map(([x, y]) => new Vector2(x, y));
  can.add(new Mesh(new LatheGeometry(base, 96), metal));
  const tab = new Mesh(new CylinderGeometry(0.22, 0.22, 0.04, 32), new MeshStandardMaterial({ color: 0xb9c0bb, metalness: 0.95, roughness: 0.3 }));
  tab.position.set(0.18, 1.74, 0.1);
  can.add(tab);
  can.rotation.x = 0.08;
  scene.add(can);

  let last: [number, string] | null = null;
  const render = (angle: number, flavour: string) => {
    let texture = labels.get(flavour);
    if (!texture) {
      texture = paintLabel(flavour);
      labels.set(flavour, texture);
    }
    if (labelMaterial.map !== texture) {
      labelMaterial.map = texture;
      labelMaterial.needsUpdate = true;
    }
    can.rotation.y = (angle * Math.PI) / 180;
    renderer.render(scene, camera);
    last = [angle, flavour];
  };
  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (last) render(...last);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  return {
    draw: render,
    dispose() {
      observer.disconnect();
      for (const texture of labels.values()) texture.dispose();
      environment.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
