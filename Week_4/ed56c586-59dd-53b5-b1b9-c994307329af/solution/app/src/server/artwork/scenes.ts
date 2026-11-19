import { circle, lerp, line, path, rect, tag, type Box } from "./svg.js";

/** The product-screen components the case-study frames are drawn from. Each one is a feature of a case study in the
 * state a frame shows: `progress` runs from 0 (before the callout's frame range) to 1 (its last frame). */

export interface Palette {
  readonly paper: string;
  readonly surface: string;
  readonly ink: string;
  readonly soft: string;
  readonly accent: string;
  readonly warm: string;
}

export type SceneKind =
  | "wipe" | "rail" | "swatches" | "scrubber" | "morph" | "teamGrid" | "calendar" | "invoice" | "usageChart"
  | "shiftBoard" | "signIn" | "swapFlow" | "tideChart" | "stationPicker" | "alertTimeline" | "recipe" | "moodboard" | "slides";

type Painter = (box: Box, progress: number, palette: Palette, id: string) => string;

function panel(box: Box, palette: Palette, fill = palette.surface): string {
  return rect(box.x, box.y, box.w, box.h, fill, { rx: 10, stroke: palette.soft, "stroke-width": 2 });
}

function skeletonLines(x: number, y: number, widths: readonly number[], gap: number, thickness: number, fill: string): string {
  return widths.map((width, index) => rect(x, y + index * gap, width, thickness, fill, { rx: thickness / 2 })).join("");
}

const painters: Readonly<Record<SceneKind, Painter>> = {
  wipe: (box, progress, palette, id) => {
    const divider = box.x + box.w * progress;
    const plan = [0.2, 0.4, 0.6, 0.8].map((at) => line(box.x, box.y + box.h * at, box.x + box.w, box.y + box.h * at, palette.ink, 2)).join("")
      + [0.25, 0.5, 0.75].map((at) => line(box.x + box.w * at, box.y, box.x + box.w * at, box.y + box.h, palette.ink, 2)).join("")
      + rect(box.x + box.w * 0.18, box.y + box.h * 0.28, box.w * 0.36, box.h * 0.4, "none", { stroke: palette.ink, "stroke-width": 4 });
    const photo = rect(box.x, box.y, box.w, box.h, palette.ink)
      + rect(box.x + box.w * 0.1, box.y + box.h * 0.2, box.w * 0.34, box.h * 0.8, palette.accent)
      + rect(box.x + box.w * 0.5, box.y + box.h * 0.38, box.w * 0.4, box.h * 0.62, palette.warm)
      + circle(box.x + box.w * 0.78, box.y + box.h * 0.2, box.h * 0.1, palette.paper);
    const planClip = `${id}-plan`;
    const photoClip = `${id}-photo`;
    return tag("defs", {},
      tag("clipPath", { id: planClip }, rect(divider, box.y, box.x + box.w - divider, box.h, "#000")),
      tag("clipPath", { id: photoClip }, rect(box.x, box.y, divider - box.x, box.h, "#000")))
      + rect(box.x, box.y, box.w, box.h, palette.surface, { rx: 6 })
      + tag("g", { "clip-path": `url(#${planClip})` }, plan)
      + tag("g", { "clip-path": `url(#${photoClip})` }, photo)
      + line(divider, box.y, divider, box.y + box.h, palette.accent, 6);
  },
  rail: (box, progress, palette) => {
    const rows = 6;
    const active = Math.round(progress * (rows - 1));
    const rowHeight = box.h / rows;
    return panel(box, palette)
      + Array.from({ length: rows }, (_, index) => {
        const y = box.y + index * rowHeight;
        const on = index === active;
        return rect(box.x + 10, y + 10, box.w - 20, rowHeight - 20, on ? palette.accent : "none", { rx: 8, stroke: palette.soft, "stroke-width": on ? 0 : 2 })
          + rect(box.x + 24, y + rowHeight / 2 - 6, (box.w - 48) * (on ? 0.8 : 0.5), 12, on ? palette.paper : palette.soft, { rx: 6 });
      }).join("");
  },
  swatches: (box, progress, palette) => {
    const shown = 1 + Math.floor(progress * 4);
    const colours = [palette.accent, palette.warm, palette.ink, palette.soft, palette.paper];
    const size = box.w / 5;
    return panel(box, palette)
      + colours.map((colour, index) => rect(box.x + index * size + 12, box.y + 12, size - 24, box.h - 24, index < shown ? colour : "none",
        { rx: 8, stroke: index < shown ? "none" : palette.soft, "stroke-width": 2 })).join("");
  },
  scrubber: (box, progress, palette) => {
    const head = box.x + 24 + (box.w - 48) * progress;
    return panel(box, palette)
      + Array.from({ length: 12 }, (_, index) => rect(box.x + 24 + index * ((box.w - 48) / 12), box.y + 18, (box.w - 48) / 12 - 6, box.h - 54,
        index % 3 === 0 ? palette.warm : palette.soft, { rx: 4 })).join("")
      + rect(box.x + 24, box.y + box.h - 24, box.w - 48, 6, palette.soft, { rx: 3 })
      + rect(box.x + 24, box.y + box.h - 24, head - box.x - 24, 6, palette.accent, { rx: 3 })
      + circle(head, box.y + box.h - 21, 11, palette.accent);
  },
  morph: (box, progress, palette) => {
    const side = Math.min(box.w, box.h) * 0.78;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    return panel(box, palette, palette.ink)
      + rect(cx - side / 2, cy - side / 2, side, side, palette.accent, { rx: lerp(side / 2, 14, progress), transform: `rotate(${lerp(0, 45, progress)} ${cx} ${cy})` })
      + circle(cx, cy, lerp(side * 0.32, side * 0.1, progress), palette.paper)
      + line(box.x + 24, box.y + box.h - 26, box.x + 24 + (box.w - 48) * progress, box.y + box.h - 26, palette.warm, 6);
  },
  teamGrid: (box, progress, palette) => {
    const hovered = Math.round(progress * 5);
    const cellW = box.w / 3;
    const cellH = box.h / 2;
    return panel(box, palette)
      + Array.from({ length: 6 }, (_, index) => {
        const x = box.x + (index % 3) * cellW;
        const y = box.y + Math.floor(index / 3) * cellH;
        const on = index === hovered;
        return rect(x + 8, y + 8, cellW - 16, cellH - 16, on ? palette.accent : palette.soft, { rx: 8 })
          + circle(x + cellW / 2, y + cellH * 0.38, cellH * 0.16, on ? palette.paper : palette.surface)
          + rect(x + cellW * 0.22, y + cellH * 0.66, cellW * 0.56, 10, on ? palette.paper : palette.surface, { rx: 5 });
      }).join("");
  },
  calendar: (box, progress, palette) => {
    const booked = Math.floor(progress * 10);
    const cellW = box.w / 7;
    const cellH = box.h / 5;
    return panel(box, palette)
      + Array.from({ length: 35 }, (_, index) => {
        const x = box.x + (index % 7) * cellW;
        const y = box.y + Math.floor(index / 7) * cellH;
        const on = index % 3 === 1 && Math.floor(index / 3) < booked;
        return rect(x + 6, y + 6, cellW - 12, cellH - 12, on ? palette.accent : "none", { rx: 6, stroke: palette.soft, "stroke-width": on ? 0 : 2 });
      }).join("");
  },
  invoice: (box, progress, palette) => panel(box, palette)
    + skeletonLines(box.x + 24, box.y + 28, [0.6, 0.8, 0.5, 0.7, 0.4].map((share) => (box.w - 48) * share), 44, 14, palette.soft)
    + rect(box.x + 24, box.y + box.h - 66, box.w - 48, 30, palette.soft, { rx: 8 })
    + rect(box.x + 24, box.y + box.h - 66, (box.w - 48) * progress, 30, palette.accent, { rx: 8 }),
  usageChart: (box, progress, palette) => {
    const bars = 14;
    const width = box.w / bars;
    return panel(box, palette)
      + Array.from({ length: bars }, (_, index) => {
        const height = (box.h - 24) * (0.25 + 0.7 * Math.abs(Math.sin(index * 1.3 + 0.5))) * lerp(0.35, 1, progress);
        return rect(box.x + index * width + 8, box.y + box.h - 12 - height, width - 16, height, index % 4 === 0 ? palette.accent : palette.warm, { rx: 4 });
      }).join("");
  },
  shiftBoard: (box, progress, palette) => {
    const rows = 5;
    const rowHeight = box.h / rows;
    return panel(box, palette)
      + Array.from({ length: rows }, (_, row) => {
        const y = box.y + row * rowHeight + 10;
        const filled = Math.min(6, 2 + Math.floor(progress * 4) + (row % 2));
        return Array.from({ length: 6 }, (_, cell) => rect(box.x + 16 + cell * ((box.w - 32) / 6), y, (box.w - 32) / 6 - 10, rowHeight - 20,
          cell < filled ? (cell % 2 ? palette.accent : palette.warm) : "none", { rx: 6, stroke: palette.soft, "stroke-width": cell < filled ? 0 : 2 })).join("");
      }).join("");
  },
  signIn: (box, progress, palette) => panel(box, palette)
    + circle(box.x + box.w / 2, box.y + box.h * 0.2, box.h * 0.09, palette.accent)
    + rect(box.x + box.w * 0.14, box.y + box.h * 0.38, box.w * 0.72, box.h * 0.12, "none", { rx: 8, stroke: palette.soft, "stroke-width": 3 })
    + rect(box.x + box.w * 0.14, box.y + box.h * 0.56, box.w * 0.72, box.h * 0.12, "none", { rx: 8, stroke: palette.soft, "stroke-width": 3 })
    + rect(box.x + box.w * 0.18, box.y + box.h * 0.42, box.w * 0.72 * 0.7 * progress, box.h * 0.04, palette.ink, { rx: 4 })
    + rect(box.x + box.w * 0.14, box.y + box.h * 0.76, box.w * 0.72, box.h * 0.13, signInButtonFill(progress, palette), { rx: 8 }),
  swapFlow: (box, progress, palette) => {
    const cardW = box.w * 0.38;
    const leftX = lerp(box.x + 16, box.x + box.w - cardW - 16, progress);
    const rightX = lerp(box.x + box.w - cardW - 16, box.x + 16, progress);
    return panel(box, palette)
      + rect(leftX, box.y + box.h * 0.2, cardW, box.h * 0.6, palette.accent, { rx: 10 })
      + rect(rightX, box.y + box.h * 0.2, cardW, box.h * 0.6, palette.warm, { rx: 10 })
      + path(`M ${box.x + box.w * 0.42} ${box.y + box.h * 0.5} L ${box.x + box.w * 0.58} ${box.y + box.h * 0.5}`, { stroke: palette.ink, "stroke-width": 6, "stroke-linecap": "round", fill: "none" });
  },
  tideChart: (box, progress, palette) => {
    const steps = 60;
    const visible = Math.max(2, Math.floor(steps * lerp(0.35, 1, progress)));
    const points = Array.from({ length: visible }, (_, index) => {
      const x = box.x + 16 + (index / (steps - 1)) * (box.w - 32);
      const y = box.y + box.h / 2 - Math.sin(index / 5) * box.h * 0.28 - Math.sin(index / 2.3) * box.h * 0.05;
      return `${index === 0 ? "M" : "L"} ${Math.round(x)} ${Math.round(y)}`;
    }).join(" ");
    return panel(box, palette)
      + [0.25, 0.5, 0.75].map((at) => line(box.x + 16, box.y + box.h * at, box.x + box.w - 16, box.y + box.h * at, palette.soft, 2)).join("")
      + path(points, { stroke: palette.accent, "stroke-width": 6, fill: "none", "stroke-linejoin": "round" });
  },
  stationPicker: (box, progress, palette) => {
    const chosen = 1 + Math.floor(progress * 3);
    const rowHeight = box.h / 5;
    return panel(box, palette)
      + Array.from({ length: 5 }, (_, index) => {
        const y = box.y + index * rowHeight + 10;
        const on = index < chosen;
        return rect(box.x + 12, y, box.w - 24, rowHeight - 20, on ? palette.accent : "none", { rx: 8, stroke: palette.soft, "stroke-width": on ? 0 : 2 })
          + circle(box.x + 34, y + (rowHeight - 20) / 2, 9, on ? palette.paper : palette.soft);
      }).join("");
  },
  alertTimeline: (box, progress, palette) => {
    const shown = 2 + Math.floor(progress * 5);
    const middle = box.y + box.h / 2;
    return panel(box, palette)
      + line(box.x + 20, middle, box.x + box.w - 20, middle, palette.soft, 4)
      + Array.from({ length: 7 }, (_, index) => circle(box.x + 40 + index * ((box.w - 80) / 6), middle, index < shown ? 11 : 6,
        index < shown ? (index % 3 === 0 ? palette.warm : palette.accent) : palette.soft)).join("");
  },
  recipe: (box, progress, palette) => {
    const rows = 1 + Math.floor(progress * 4);
    return panel(box, palette)
      + Array.from({ length: 5 }, (_, index) => rect(box.x + 18, box.y + 22 + index * ((box.h - 44) / 5), (box.w - 36) * (index < rows ? 0.9 - index * 0.1 : 0.3), (box.h - 44) / 5 - 14,
        index < rows ? (index === rows - 1 ? palette.accent : palette.soft) : "none", { rx: 8, stroke: palette.soft, "stroke-width": index < rows ? 0 : 2 })).join("");
  },
  moodboard: (box, progress, palette) => {
    const tiles = 2 + Math.floor(progress * 4);
    const layout: readonly (readonly [number, number, number, number])[] = [[0.05, 0.06, 0.5, 0.5], [0.58, 0.06, 0.37, 0.3], [0.58, 0.4, 0.37, 0.5], [0.05, 0.6, 0.25, 0.32], [0.33, 0.6, 0.22, 0.32], [0.05, 0.06, 0.2, 0.2]];
    const fills = [palette.accent, palette.warm, palette.ink, palette.soft, palette.warm, palette.paper];
    return panel(box, palette)
      + layout.slice(0, tiles).map(([lx, ly, lw, lh], index) => rect(box.x + lx * box.w, box.y + ly * box.h, lw * box.w, lh * box.h, fills[index] ?? palette.soft, { rx: 8 })).join("");
  },
  slides: (box, progress, palette) => {
    const slides = 1 + Math.floor(progress * 3);
    const width = box.w / 4;
    return panel(box, palette)
      + Array.from({ length: 4 }, (_, index) => rect(box.x + index * width + 12, box.y + 12, width - 24, box.h - 24, index < slides ? palette.accent : "none",
        { rx: 6, stroke: palette.soft, "stroke-width": index < slides ? 0 : 2 })).join("");
  },
};

function signInButtonFill(progress: number, palette: Palette): string {
  return progress > 0.5 ? palette.accent : palette.ink;
}

export function paintScene(kind: SceneKind, box: Box, progress: number, palette: Palette, id: string): string {
  return painters[kind](box, progress, palette, id);
}
