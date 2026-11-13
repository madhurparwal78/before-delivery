/** The orthographic lunar disc, the ground track and the Track loupe. */

import { pickNearestVisible, project, type Projection } from "../shared/geometry.js";
import { snapIndex } from "../shared/frames.js";
import type { Landmark, MissionEvent, Perilune, Sample, TranscriptLine } from "../shared/model.js";
import { el, forcedColours, prefersReducedMotion } from "./dom.js";

const LENS_SIZE_CSS_PX = 160;
const LENS_MAGNIFICATION = 4;

type DiscScene = {
  samples: readonly Sample[];
  landmarks: readonly Landmark[];
  lines: readonly TranscriptLine[];
  events: readonly MissionEvent[];
  perilune: Perilune | null;
  showPins: boolean;
  showTicks: boolean;
};

type Palette = {
  disc: string;
  maria: string;
  graticule: string;
  track: string;
  hidden: string;
  mark: string;
  lensRim: string;
  crosshair: string;
  pin: string;
};

const INSTRUMENT_PALETTE: Palette = {
  disc: "#cfc9ba",
  maria: "#b9b2a2",
  graticule: "#8d8678",
  track: "#a7471b",
  hidden: "#a7471b",
  mark: "#a7471b",
  lensRim: "#a7471b",
  crosshair: "#a7471b",
  pin: "#a7471b",
};

function systemColour(name: string, fallback: string): string {
  const probe = el("span", { style: `color: ${name}; display: none` });
  document.body.append(probe);
  const colour = getComputedStyle(probe).color || fallback;
  probe.remove();
  return colour;
}

function palette(): Palette {
  if (!forcedColours()) {
    return INSTRUMENT_PALETTE;
  }
  const canvas = systemColour("Canvas", "#ffffff");
  const canvasText = systemColour("CanvasText", "#000000");
  const highlight = systemColour("Highlight", "#0000ff");
  const linkText = systemColour("LinkText", "#0000ee");
  const grayText = systemColour("GrayText", "#808080");
  return {
    disc: canvas,
    maria: canvas,
    graticule: grayText,
    track: canvasText,
    hidden: canvasText,
    mark: canvasText,
    lensRim: highlight,
    crosshair: canvasText,
    pin: linkText,
  };
}

const MARIA: readonly { lat: number; lon: number; rx: number; ry: number }[] = [
  { lat: 22, lon: -18, rx: 0.3, ry: 0.22 },
  { lat: -8, lon: 34, rx: 0.24, ry: 0.18 },
  { lat: 40, lon: 58, rx: 0.18, ry: 0.14 },
  { lat: -32, lon: -46, rx: 0.26, ry: 0.2 },
  { lat: 4, lon: 150, rx: 0.3, ry: 0.24 },
  { lat: -54, lon: 96, rx: 0.2, ry: 0.16 },
];

function drawScene(
  context: CanvasRenderingContext2D,
  projection: Projection,
  scene: DiscScene,
  colours: Palette,
  scale: number,
): void {
  const { cx, cy, radius } = projection;
  context.save();
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.fillStyle = colours.disc;
  context.fill();
  context.clip();

  if (!forcedColours()) {
    for (const patch of MARIA) {
      const point = project(patch.lat, patch.lon, projection);
      if (!point.visible) {
        continue;
      }
      context.beginPath();
      const phase = (patch.lat + patch.lon) * Math.PI / 180;
      for (let step = 0; step < 80; step += 1) {
        const angle = step * Math.PI * 2 / 80;
        const contour = 1 + 0.12 * Math.sin(3 * angle + phase)
          + 0.06 * Math.sin(5 * angle - phase) + 0.035 * Math.sin(9 * angle + phase);
        const x = point.x + patch.rx * radius * Math.cos(angle) * contour;
        const y = point.y + patch.ry * radius * Math.sin(angle) * contour;
        if (step === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.fillStyle = colours.maria;
      context.globalAlpha = 0.55;
      context.fill();
      context.globalAlpha = 1;
    }
  }

  context.strokeStyle = colours.graticule;
  context.lineWidth = 1 / scale;
  for (let lat = -60; lat <= 60; lat += 30) {
    context.beginPath();
    let started = false;
    for (let lon = -180; lon <= 180; lon += 2) {
      const point = project(lat, lon, projection);
      if (!point.visible) {
        started = false;
        continue;
      }
      if (started) {
        context.lineTo(point.x, point.y);
      } else {
        context.moveTo(point.x, point.y);
        started = true;
      }
    }
    context.stroke();
  }
  for (let lon = -180; lon < 180; lon += 30) {
    context.beginPath();
    let started = false;
    for (let lat = -90; lat <= 90; lat += 2) {
      const point = project(lat, lon, projection);
      if (!point.visible) {
        started = false;
        continue;
      }
      if (started) {
        context.lineTo(point.x, point.y);
      } else {
        context.moveTo(point.x, point.y);
        started = true;
      }
    }
    context.stroke();
  }
  context.beginPath();
  context.arc(cx, cy, radius - 0.5 / scale, 0, Math.PI * 2);
  context.stroke();

  context.lineWidth = 2 / scale;
  context.strokeStyle = colours.track;
  for (let index = 1; index < scene.samples.length; index += 1) {
    const previous = scene.samples[index - 1];
    const current = scene.samples[index];
    const a = project(previous.lat_deg, previous.lon_deg, projection);
    const b = project(current.lat_deg, current.lon_deg, projection);
    const hidden = !a.visible || !b.visible;
    context.beginPath();
    context.setLineDash(hidden ? [2 / scale, 3 / scale] : []);
    context.globalAlpha = hidden && !forcedColours() ? 0.4 : 1;
    context.strokeStyle = hidden ? colours.hidden : colours.track;
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  }
  context.setLineDash([]);
  context.globalAlpha = 1;

  if (scene.showTicks) {
    context.strokeStyle = colours.graticule;
    context.lineWidth = 1.5 / scale;
    for (const line of scene.lines) {
      const sample = sampleAtMet(scene.samples, line.met);
      if (!sample) {
        continue;
      }
      const point = project(sample.lat_deg, sample.lon_deg, projection);
      if (!point.visible) {
        continue;
      }
      context.beginPath();
      context.moveTo(point.x - 3 / scale, point.y);
      context.lineTo(point.x + 3 / scale, point.y);
      context.stroke();
    }
  }

  if (scene.showPins) {
    context.fillStyle = colours.pin;
    for (const event of scene.events) {
      const sample = sampleAtMet(scene.samples, event.met);
      if (!sample) {
        continue;
      }
      const point = project(sample.lat_deg, sample.lon_deg, projection);
      if (!point.visible) {
        continue;
      }
      context.beginPath();
      context.moveTo(point.x, point.y);
      context.lineTo(point.x, point.y - 9 / scale);
      context.lineWidth = 2 / scale;
      context.strokeStyle = colours.pin;
      context.stroke();
      context.beginPath();
      context.arc(point.x, point.y - 10 / scale, 3 / scale, 0, Math.PI * 2);
      context.fill();
    }
  }

  context.fillStyle = colours.mark;
  for (const landmark of scene.landmarks) {
    const point = project(landmark.lat_deg, landmark.lon_deg, projection);
    if (!point.visible) {
      continue;
    }
    context.fillRect(point.x - 4 / scale, point.y - 4 / scale, 8 / scale, 8 / scale);
  }

  if (scene.perilune) {
    const point = project(scene.perilune.lat_deg, scene.perilune.lon_deg, projection);
    if (point.visible) {
      context.beginPath();
      context.moveTo(point.x, point.y - 6 / scale);
      context.lineTo(point.x + 5 / scale, point.y + 4 / scale);
      context.lineTo(point.x - 5 / scale, point.y + 4 / scale);
      context.closePath();
      context.fill();
    }
  }
  context.restore();
}

function sampleAtMet(samples: readonly Sample[], met: number): Sample | null {
  return samples.length === 0 ? null : samples[snapIndex(samples, met)];
}

type DiscCallbacks = {
  onLensSample: (index: number, options: { writeAddress: boolean }) => void;
  onPinRequest: () => void;
  beforeInteraction: () => void;
  onLensPosition: () => void;
};

/** The disc canvas, the lens and every pointer, touch and key gesture on them. */
export class DiscView {
  readonly canvas: HTMLCanvasElement;
  readonly lens: HTMLElement;
  private readonly lensCanvas: HTMLCanvasElement;
  private scene: DiscScene = {
    samples: [],
    landmarks: [],
    lines: [],
    events: [],
    perilune: null,
    showPins: true,
    showTicks: true,
  };
  private lensIndex = 0;
  private lensVisible = false;
  private lensExit: Animation | null = null;
  private lensPoint: { x: number; y: number } | null = null;

  constructor(private readonly callbacks: DiscCallbacks) {
    this.canvas = el("canvas", {
      class: "disc",
      role: "slider",
      "aria-label": "Track loupe",
      tabindex: "0",
      "aria-valuemin": "0",
      "aria-valuemax": "0",
      "aria-valuenow": "0",
      "aria-orientation": "horizontal",
    });
    this.lensCanvas = el("canvas", { class: "lens-canvas" });
    this.lens = el("div", { role: "img", "aria-label": "Loupe", class: "lens", hidden: true }, [
      this.lensCanvas,
    ]);
    this.bind();
  }

  setScene(scene: DiscScene): void {
    this.scene = scene;
    this.canvas.setAttribute(
      "aria-valuemax",
      String(Math.max(0, scene.samples.length - 1)),
    );
    this.draw();
  }

  setLensIndex(index: number): void {
    this.lensIndex = index;
    const sample = this.scene.samples[index];
    if (sample) {
      this.canvas.setAttribute("aria-valuenow", String(index));
    }
    this.draw();
  }

  setValueText(text: string): void {
    this.canvas.setAttribute("aria-valuetext", text);
  }

  openLens(): void {
    this.lensExit?.cancel();
    this.lens.style.transition = "none";
    this.lensVisible = true;
    this.lens.hidden = false;
    this.lens.classList.toggle("instant", prefersReducedMotion());
    this.draw();
    this.lens.getBoundingClientRect();
    this.lens.style.removeProperty("transition");
  }

  closeLens(): void {
    if (!this.lensVisible) return;
    this.lensVisible = false;
    this.callbacks.onLensPosition();
    if (prefersReducedMotion()) {
      this.lens.hidden = true;
      return;
    }
    const style = getComputedStyle(this.lens);
    this.lensExit = this.lens.animate(
      [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(0)", opacity: 0 }],
      { duration: Number.parseFloat(style.getPropertyValue("--motion-lens")), easing: style.getPropertyValue("--ease-settle").trim() },
    );
    void this.lensExit.finished.then(() => {
      if (!this.lensVisible) this.lens.hidden = true;
    }).catch(() => undefined);
  }

  get isLensOpen(): boolean {
    return this.lensVisible;
  }

  private projection(): Projection {
    const rect = this.canvas.getBoundingClientRect();
    const size = rect.width;
    return {
      cx: size / 2,
      cy: size / 2,
      radius: size / 2,
      lambda0: this.scene.perilune ? this.scene.perilune.lon_deg : 0,
    };
  }

  /** Redraws the disc and, while it is open, the magnified lens. */
  draw(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0) {
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(rect.width * ratio);
    this.canvas.height = Math.round(rect.width * ratio);
    const context = this.canvas.getContext("2d");
    if (!context) {
      return;
    }
    const colours = palette();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.width);
    const projection = this.projection();
    drawScene(context, projection, this.scene, colours, 1);
    this.drawLens(projection, colours, ratio);
    this.callbacks.onLensPosition();
  }

  private drawLens(projection: Projection, colours: Palette, ratio: number): void {
    const sample = this.scene.samples[this.lensIndex];
    if (!this.lensVisible || !sample) {
      return;
    }
    const point = this.lensPoint ?? project(sample.lat_deg, sample.lon_deg, projection);
    this.lens.style.left = `${point.x - LENS_SIZE_CSS_PX / 2}px`;
    this.lens.style.top = `${point.y - LENS_SIZE_CSS_PX / 2}px`;
    this.lensCanvas.width = Math.round(LENS_SIZE_CSS_PX * ratio);
    this.lensCanvas.height = Math.round(LENS_SIZE_CSS_PX * ratio);
    const context = this.lensCanvas.getContext("2d");
    if (!context) {
      return;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, LENS_SIZE_CSS_PX, LENS_SIZE_CSS_PX);
    context.save();
    context.beginPath();
    context.arc(
      LENS_SIZE_CSS_PX / 2,
      LENS_SIZE_CSS_PX / 2,
      LENS_SIZE_CSS_PX / 2 - 2,
      0,
      Math.PI * 2,
    );
    context.clip();
    context.translate(LENS_SIZE_CSS_PX / 2, LENS_SIZE_CSS_PX / 2);
    context.scale(LENS_MAGNIFICATION, LENS_MAGNIFICATION);
    context.translate(-point.x, -point.y);
    drawScene(context, projection, this.scene, colours, LENS_MAGNIFICATION);
    context.restore();
    context.strokeStyle = colours.crosshair;
    context.lineWidth = 1;
    const centre = LENS_SIZE_CSS_PX / 2;
    context.beginPath();
    context.moveTo(centre - 12, centre);
    context.lineTo(centre + 12, centre);
    context.moveTo(centre, centre - 12);
    context.lineTo(centre, centre + 12);
    context.stroke();
    context.strokeStyle = colours.lensRim;
    context.lineWidth = 3;
    context.beginPath();
    context.arc(centre, centre, centre - 2, 0, Math.PI * 2);
    context.stroke();
  }

  private pointerPosition(event: { clientX: number; clientY: number }): {
    x: number;
    y: number;
  } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private pick(position: { x: number; y: number }): number | null {
    const projection = this.projection();
    return pickNearestVisible(
      this.scene.samples.map((sample) => ({
        index: sample.index,
        lat_deg: sample.lat_deg,
        lon_deg: sample.lon_deg,
      })),
      position.x,
      position.y,
      projection,
    );
  }

  private moveTo(index: number, writeAddress: boolean): void {
    const sample = this.scene.samples[index];
    if (!sample) {
      return;
    }
    const projection = this.projection();
    const point = project(sample.lat_deg, sample.lon_deg, projection);
    this.lensPoint = { x: point.x, y: point.y };
    this.callbacks.onLensSample(index, { writeAddress });
  }

  /** Centres the lens on a frame's own position during playback. */
  setFramePoint(latDeg: number, lonDeg: number): void {
    this.lens.classList.add("playing");
    const projection = this.projection();
    const point = project(latDeg, lonDeg, projection);
    this.lensPoint = { x: point.x, y: point.y };
    this.draw();
  }

  clearFramePoint(): void {
    this.lens.classList.remove("playing");
    this.lensPoint = null;
  }

  private bind(): void {
    const openAt = (position: { x: number; y: number }): boolean => {
      const picked = this.pick(position);
      if (picked === null) {
        return false;
      }
      this.callbacks.beforeInteraction();
      this.moveTo(picked, false);
      this.openLens();
      return true;
    };

    this.canvas.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "touch") {
        return;
      }
      openAt(this.pointerPosition(event));
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") {
        return;
      }
      const position = this.pointerPosition(event);
      if (!this.lensVisible) {
        openAt(position);
        return;
      }
      const picked = this.pick(position);
      if (picked !== null) {
        this.callbacks.beforeInteraction();
        this.moveTo(picked, false);
      }
    });
    this.canvas.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "touch") {
        return;
      }
      if (document.activeElement !== this.canvas) {
        this.closeLens();
      }
    });
    this.canvas.addEventListener("pointerup", (event) => {
      if (event.pointerType === "touch") {
        return;
      }
      this.moveTo(this.lensIndex, true);
    });

    this.canvas.addEventListener(
      "touchstart",
      (event) => {
        const touch = event.touches[0];
        if (!touch) {
          return;
        }
        if (openAt(this.pointerPosition(touch))) {
          event.preventDefault();
        }
      },
      { passive: false },
    );
    this.canvas.addEventListener(
      "touchmove",
      (event) => {
        const touch = event.touches[0];
        if (!touch || !this.lensVisible) {
          return;
        }
        event.preventDefault();
        const picked = this.pick(this.pointerPosition(touch));
        if (picked !== null) {
          this.callbacks.beforeInteraction();
          this.moveTo(picked, false);
        }
      },
      { passive: false },
    );
    this.canvas.addEventListener("touchend", () => {
      if (this.lensVisible) {
        this.moveTo(this.lensIndex, true);
      }
    });

    this.canvas.addEventListener("focus", () => {
      this.openLens();
      this.moveTo(this.lensIndex, false);
    });
    this.canvas.addEventListener("blur", () => this.closeLens());

    this.canvas.addEventListener("keydown", (event) => {
      const last = this.scene.samples.length - 1;
      if (last < 0) {
        return;
      }
      let next: number | null = null;
      const step = event.shiftKey ? 60 : 1;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowUp":
          next = Math.min(last, this.lensIndex + step);
          break;
        case "ArrowLeft":
        case "ArrowDown":
          next = Math.max(0, this.lensIndex - step);
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = last;
          break;
        case "Enter":
          event.preventDefault();
          this.callbacks.onPinRequest();
          return;
        default:
          return;
      }
      event.preventDefault();
      this.callbacks.beforeInteraction();
      this.moveTo(next, false);
      this.pendingKeyStep = true;
    });
    this.canvas.addEventListener("keyup", () => {
      if (this.pendingKeyStep) {
        this.pendingKeyStep = false;
        this.moveTo(this.lensIndex, true);
      }
    });
  }

  private pendingKeyStep = false;
}
