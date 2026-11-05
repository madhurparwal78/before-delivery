// The turnable 3D instrument model, drawn in ink lines and flat tints with a
// brass band at the equity fraction (DP-73, DP-74). Falls back to a flat ink
// drawing without WebGL.
import * as THREE from "three";
import { h } from "../ui/dom.js";
import { prefersReducedMotion } from "../ui/motion.js";

export interface ModelColors {
  paper: string;
  ink: string;
  brass: string;
}

const COLORS: ModelColors = { paper: "#f7f2e7", ink: "#1c2430", brass: "#b8912f" };

export type ModelSize = "1/4" | "1/2" | "3/4" | "4/4" | "full";

export interface DrawingGroup {
  group: HTMLElement;
  setEquityFraction(fraction: number): void;
  dispose(): void;
}

// Builds the drawing group: the model (or the flat fallback) plus the gauge.
// showBrass false means the tech's view: no brass band, no gauge.
export function createDrawing(
  instrumentType: string,
  size: string,
  showBrass: boolean
): DrawingGroup {
  const group = h("div", { class: "drawing-group", role: "group", "aria-label": `${labelFor(instrumentType, size)} drawing` });
  const canvasHolder = h("div", { class: "drawing-canvas-holder" });
  group.appendChild(canvasHolder);
  let gauge: HTMLElement | null = null;
  if (showBrass) {
    gauge = h("div", {
      class: "equity-gauge",
      role: "img",
      "aria-label": "Equity fill, 0% owned",
    });
    const gaugeWrap = h("div", { class: "gauge-wrap" }, gauge);
    group.appendChild(gaugeWrap);
  }
  const scale = stringScale(instrumentType, size);
  const label = labelFor(instrumentType, size);

  let webgl: WebGLDrawing | null = null;
  let flat: { root: HTMLElement; setFraction(fraction: number): void } | null = null;
  try {
    webgl = new WebGLDrawing(canvasHolder, instrumentType, scale, showBrass, label);
  } catch {
    webgl = null;
  }
  if (!webgl) {
    flat = flatDrawing(instrumentType, scale, showBrass);
    canvasHolder.appendChild(flat.root);
  }

  return {
    group,
    setEquityFraction(fraction: number) {
      const pct = Math.max(0, Math.min(100, Math.floor(fraction * 100 + 1e-9)));
      if (gauge) {
        gauge.setAttribute("aria-label", `Equity fill, ${pct}% owned`);
        gauge.style.height = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
      }
      webgl?.setEquityFraction(fraction);
      flat?.setFraction(fraction);
    },
    dispose() {
      webgl?.dispose();
    },
  };
}

function labelFor(instrumentType: string, size: string): string {
  if (instrumentType === "violin" || instrumentType === "cello") return `${size} ${capitalize(instrumentType)}`;
  return capitalize(instrumentType);
}

function capitalize(word: string): string {
  return word[0].toUpperCase() + word.slice(1);
}

// String models scale with fractional size.
function stringScale(instrumentType: string, size: string): number {
  if (instrumentType !== "violin" && instrumentType !== "cello") return 1;
  const table: Record<string, number> = { "1/4": 0.78, "1/2": 0.88, "3/4": 0.95, "4/4": 1 };
  return table[size] ?? 1;
}

interface WebGLDrawing {
  setEquityFraction(fraction: number): void;
  dispose(): void;
}

class WebGLDrawing implements WebGLDrawing {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private modelGroup: THREE.Group;
  private bandGroup: THREE.Group;
  private clipPlane: THREE.Plane;
  private angle = 0;
  private renderedAngle = 0;
  private description: HTMLElement;
  private readonly baseY: number;
  private readonly modelHeight: number;
  private animFrame = 0;

  constructor(
    holder: HTMLElement,
    instrumentType: string,
    scale: number,
    showBrass: boolean,
    instrumentLabel: string
  ) {
    const canvas = document.createElement("canvas");
    canvas.className = "model-canvas";
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${instrumentLabel} model`);
    const description = document.createElement("span");
    description.className = "visually-hidden";
    description.id = `model-desc-${Math.random().toString(36).slice(2, 8)}`;
    description.textContent = "Turned 0 degrees. Left and Right arrow keys turn it.";
    this.description = description;
    canvas.setAttribute("aria-describedby", description.id);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      preserveDrawingBuffer: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(360, 360, false);
    this.renderer.setClearColor(new THREE.Color(COLORS.paper), 1);
    this.renderer.localClippingEnabled = true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.camera.position.set(0, 1.4, 11);
    this.camera.lookAt(0, 0.6, 0);

    const [bottom, top] = [-1.2, 2.4];
    this.baseY = bottom;
    this.modelHeight = top - bottom;

    const inkMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.ink) });
    const tintMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(COLORS.ink),
      transparent: true,
      opacity: 0.2,
    });
    const brassMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.brass) });

    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), bottom);
    brassMaterial.clippingPlanes = [this.clipPlane];

    this.modelGroup = new THREE.Group();
    this.bandGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
    if (showBrass) this.scene.add(this.bandGroup);

    buildInstrument(this.modelGroup, instrumentType, scale, inkMaterial, tintMaterial, bottom, top);
    if (showBrass) {
      buildInstrument(this.bandGroup, instrumentType, scale, brassMaterial, brassMaterial, bottom, top);
    }

    holder.append(canvas, description);
    this.draw();

    // Drag: a mostly horizontal drag turns it in proportion; the angle in
    // the description is rounded to the nearest multiple of 15 after release.
    canvas.addEventListener("pointerdown", (event) => {
      let lastX = event.clientX;
      let totalDx = 0;
      const move = (moveEvent: PointerEvent): void => {
        const dx = moveEvent.clientX - lastX;
        lastX = moveEvent.clientX;
        totalDx += dx;
        // Every 100 pixels of horizontal drag turn the model by 90 degrees.
        this.setLogicalAngle(this.angle + (dx / 100) * 90, false);
      };
      const up = (): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        this.setLogicalAngle(nearest15(this.angle + (totalDx / 100) * 90), true);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });

    canvas.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        this.setLogicalAngle(this.angle + 15, true);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        this.setLogicalAngle(this.angle - 15, true);
      }
    });
  }

  private draw(): void {
    this.renderer.render(this.scene, this.camera);
  }

  // The logical angle is always held from 0 up to but not including 360.
  private setLogicalAngle(value: number, animate: boolean): void {
    this.angle = ((value % 360) + 360) % 360;
    this.updateDescription();
    if (!animate || prefersReducedMotion()) {
      this.renderedAngle = this.angle;
      this.applyRotation();
      this.draw();
      return;
    }
    // The model eases to its new angle and stops moving 350-500ms later.
    cancelAnimationFrame(this.animFrame);
    const start = performance.now();
    const from = this.renderedAngle;
    const to = this.angle;
    const frame = (now: number): void => {
      const t = Math.min((now - start) / 400, 1);
      const eased = 1 - Math.pow(1 - t, 2);
      this.renderedAngle = from + (to - from) * eased;
      this.applyRotation();
      this.draw();
      if (t < 1) {
        this.animFrame = requestAnimationFrame(frame);
      } else {
        this.renderedAngle = to;
        this.applyRotation();
        this.draw();
      }
    };
    this.animFrame = requestAnimationFrame(frame);
  }

  private applyRotation(): void {
    const radians = (this.renderedAngle * Math.PI) / 180;
    this.modelGroup.rotation.y = radians;
    this.bandGroup.rotation.y = radians;
  }

  private updateDescription(): void {
    const shown = Math.round(this.angle / 15) * 15 % 360;
    this.description.textContent = `Turned ${shown} degrees. Left and Right arrow keys turn it.`;
  }

  setEquityFraction(fraction: number): void {
    // The band rises from the base: its top sits exactly at the fraction of
    // the model's height.
    this.clipPlane.constant = this.baseY + Math.max(0, Math.min(1, fraction)) * this.modelHeight;
    this.draw();
  }

  dispose(): void {
    cancelAnimationFrame(this.animFrame);
    this.renderer.dispose();
  }
}

function nearest15(angle: number): number {
  const base = Math.round(angle / 15) * 15;
  return ((base % 360) + 360) % 360;
}

// One distinct model per instrument, from simple 3D shapes.
function buildInstrument(
  group: THREE.Group,
  instrumentType: string,
  scale: number,
  ink: THREE.Material,
  tint: THREE.Material,
  bottom: number,
  top: number
): void {
  const height = (top - bottom) * scale;
  const mid = bottom + height / 2 + (top - bottom) * (1 - scale) / 2;
  const inkLine = (geometry: THREE.BufferGeometry): THREE.Mesh => new THREE.Mesh(geometry, ink);
  const tintMesh = (geometry: THREE.BufferGeometry): THREE.Mesh => new THREE.Mesh(geometry, tint);
  const parts: THREE.Mesh[] = [];

  if (instrumentType === "flute") {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(height * 0.045, height * 0.045, height, 24), ink);
    body.rotation.z = Math.PI / 2;
    body.position.set(0, mid, 0);
    parts.push(body);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(height * 0.05, height * 0.05, height * 0.22, 24), tint);
    head.rotation.z = Math.PI / 2;
    head.position.set(-height * 0.39, mid + height * 0.012, 0);
    parts.push(head);
    for (let i = 0; i < 6; i++) {
      const key = new THREE.Mesh(new THREE.SphereGeometry(height * 0.03, 12, 12), ink);
      key.position.set(-height * 0.2 + i * height * 0.09, mid - height * 0.05, 0);
      parts.push(key);
    }
  } else if (instrumentType === "clarinet") {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(height * 0.05, height * 0.04, height * 0.8, 24), ink);
    body.position.set(0, mid - height * 0.05, 0);
    parts.push(body);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(height * 0.11, height * 0.05, height * 0.18, 24), tint);
    bell.position.set(0, mid - height * 0.47, 0);
    parts.push(bell);
    const mouth = new THREE.Mesh(new THREE.ConeGeometry(height * 0.05, height * 0.16, 16), ink);
    mouth.position.set(0, mid + height * 0.42, 0);
    parts.push(mouth);
  } else if (instrumentType === "trumpet") {
    const bell = new THREE.Mesh(new THREE.ConeGeometry(height * 0.2, height * 0.34, 24, 1, true), tint);
    bell.rotation.z = Math.PI;
    bell.position.set(0, mid + height * 0.18, 0);
    parts.push(bell);
    for (const offset of [-1, 0, 1]) {
      const tube = new THREE.Mesh(new THREE.TorusGeometry(height * 0.22, height * 0.02, 10, 40), ink);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, mid - height * 0.12, offset * height * 0.01);
      parts.push(tube);
    }
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(height * 0.02, height * 0.02, height * 0.7, 12), ink);
    stem.position.set(0, mid, 0);
    parts.push(stem);
  } else if (instrumentType === "violin") {
    const upper = new THREE.Mesh(new THREE.SphereGeometry(height * 0.16, 20, 16), tint);
    upper.scale.set(1, 1.15, 0.45);
    upper.position.set(0, mid + height * 0.22, 0);
    parts.push(upper);
    const lower = new THREE.Mesh(new THREE.SphereGeometry(height * 0.18, 20, 16), tint);
    lower.scale.set(1, 1.3, 0.45);
    lower.position.set(0, mid - height * 0.18, 0);
    parts.push(lower);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(height * 0.04, height * 0.34, height * 0.03), ink);
    neck.position.set(0, mid + height * 0.47, 0);
    parts.push(neck);
    const scroll = new THREE.Mesh(new THREE.SphereGeometry(height * 0.045, 12, 12), ink);
    scroll.position.set(0, mid + height * 0.65, 0);
    parts.push(scroll);
    const stringsBar = new THREE.Mesh(new THREE.BoxGeometry(height * 0.02, height * 0.78, height * 0.012), ink);
    stringsBar.position.set(0, mid + height * 0.05, height * 0.08);
    parts.push(stringsBar);
  } else {
    // Cello: an outline of a tall body with a long neck.
    const upper = new THREE.Mesh(new THREE.SphereGeometry(height * 0.15, 20, 16), tint);
    upper.scale.set(1, 1.15, 0.5);
    upper.position.set(0, mid + height * 0.22, 0);
    parts.push(upper);
    const lower = new THREE.Mesh(new THREE.SphereGeometry(height * 0.19, 20, 16), tint);
    lower.scale.set(1, 1.35, 0.5);
    lower.position.set(0, mid - height * 0.2, 0);
    parts.push(lower);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(height * 0.05, height * 0.4, height * 0.04), ink);
    neck.position.set(0, mid + height * 0.5, 0);
    parts.push(neck);
    const scroll = new THREE.Mesh(new THREE.SphereGeometry(height * 0.05, 12, 12), ink);
    scroll.position.set(0, mid + height * 0.72, 0);
    parts.push(scroll);
    const stringsBar = new THREE.Mesh(new THREE.BoxGeometry(height * 0.022, height * 0.85, height * 0.014), ink);
    stringsBar.position.set(0, mid + height * 0.04, height * 0.09);
    parts.push(stringsBar);
    const endpin = new THREE.Mesh(new THREE.CylinderGeometry(height * 0.008, height * 0.008, height * 0.16, 8), ink);
    endpin.position.set(0, mid - height * 0.56, 0);
    parts.push(endpin);
  }

  for (const part of parts) {
    group.add(part);
  }
  void inkLine;
  void tintMesh;
}

// The flat ink line drawing shown without WebGL, with the same brass fill
// rule and the same names.
function flatDrawing(
  instrumentType: string,
  scale: number,
  showBrass: boolean
): { root: HTMLElement; setFraction(fraction: number): void } {
  const holder = document.createElement("div");
  holder.className = "flat-drawing";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 240");
  svg.setAttribute("class", "flat-drawing-svg");
  svg.setAttribute("aria-hidden", "true");
  holder.appendChild(svg);
  const clipPath = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
  clipPath.setAttribute("id", `flat-clip-${Math.random().toString(36).slice(2, 8)}`);
  const clipRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  clipRect.setAttribute("x", "0");
  clipRect.setAttribute("y", "240");
  clipRect.setAttribute("width", "120");
  clipRect.setAttribute("height", "0");
  clipPath.appendChild(clipRect);
  svg.appendChild(clipPath);

  const outline = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  const fill = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  const points = silhouettePoints(instrumentType, scale);
  outline.setAttribute("points", points);
  outline.setAttribute("fill", "none");
  outline.setAttribute("stroke", COLORS.ink);
  outline.setAttribute("stroke-width", "2.5");
  fill.setAttribute("points", points);
  fill.setAttribute("fill", showBrass ? COLORS.brass : COLORS.ink);
  fill.setAttribute("opacity", showBrass ? "1" : "0.15");
  fill.setAttribute("clip-path", `url(#${clipPath.getAttribute("id")})`);
  svg.append(fill, outline);
  return {
    root: holder,
    setFraction(fraction: number) {
      const height = 240 * Math.max(0, Math.min(1, fraction));
      clipRect.setAttribute("y", String(240 - height));
      clipRect.setAttribute("height", String(height));
    },
  };
}

function silhouettePoints(instrumentType: string, scale: number): string {
  const s = 0.75 + 0.25 * scale;
  const y = (value: number): string => (value * s).toFixed(1);
  if (instrumentType === "flute" || instrumentType === "clarinet") {
    return `14,${y(120)} 106,${y(120)} 106,${y(124)} 14,${y(124)}`;
  }
  if (instrumentType === "trumpet") {
    return `40,${y(50)} 96,${y(165)} 82,${y(180)} 30,${y(62)}`;
  }
  // Violin and cello: a waisted body with a long neck.
  return `38,${y(28)} 88,${y(80)} 84,${y(120)} 92,${y(150)} 86,${y(200)} 40,${y(205)} 34,${y(150)} 42,${y(120)} 30,${y(80)}`;
}
