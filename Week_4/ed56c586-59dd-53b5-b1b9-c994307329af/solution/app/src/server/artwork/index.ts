import { FRAMES_PER_PROJECT, PROJECTS, type Callout, type Project } from "../../shared/catalog.js";
import { COVER_SIZE, FRAME_SIZE, type MediaObject } from "../../shared/media-manifest.js";
import { circle, line, rect, scaledSvgDocument, svgDocument, tag } from "./svg.js";
import { paintScene, type Palette, type SceneKind } from "./scenes.js";

/** The 42 published media objects, drawn from the seed data: one cover and six preview frames for each project. */

/** The width a cover file is sized to: a card shows it at about 350 px at most, so 800 px is sharp at 2x. */
const COVER_FILE_WIDTH = 800;

interface MediaArtwork {
  readonly bytes: Buffer;
  readonly contentType: string;
}

const INK = "#0a0f2c";
const ULTRAMARINE = "#2233cc";

interface ProjectArt {
  readonly palette: Palette;
  readonly scenes: readonly [SceneKind, SceneKind, SceneKind];
}

const ART: Readonly<Record<string, ProjectArt>> = {
  "hollis-atelier": {
    palette: { paper: "#e8e4d8", surface: "#f7f4ec", ink: INK, soft: "#c9c3b2", accent: ULTRAMARINE, warm: "#b7a58c" },
    scenes: ["wipe", "rail", "swatches"],
  },
  "foundry-loop": {
    palette: { paper: "#e0e5ec", surface: "#f3f5f8", ink: INK, soft: "#bfc8d6", accent: ULTRAMARINE, warm: "#d9a066" },
    scenes: ["scrubber", "morph", "teamGrid"],
  },
  tallyhouse: {
    palette: { paper: "#e3e9dd", surface: "#f4f7f0", ink: INK, soft: "#b9c5ae", accent: ULTRAMARINE, warm: "#8fa286" },
    scenes: ["calendar", "invoice", "usageChart"],
  },
  "pulse-roster": {
    palette: { paper: "#e9dfd6", surface: "#f8f2ec", ink: INK, soft: "#d3c3b5", accent: ULTRAMARINE, warm: "#c27a57" },
    scenes: ["shiftBoard", "signIn", "swapFlow"],
  },
  tidegauge: {
    palette: { paper: "#d9e4e6", surface: "#eef4f5", ink: INK, soft: "#b3c6ca", accent: ULTRAMARINE, warm: "#5e8a94" },
    scenes: ["tideChart", "stationPicker", "alertTimeline"],
  },
  promptloom: {
    palette: { paper: "#e4ddeb", surface: "#f5f1f8", ink: INK, soft: "#cdc2d8", accent: ULTRAMARINE, warm: "#9a83b5" },
    scenes: ["recipe", "moodboard", "slides"],
  },
};

/** How far a frame is through a callout's frame range: 0 before it, 1 from its last frame on. */
function progressAt(callout: Callout, frame: number): number {
  if (frame <= callout.firstFrame) return 0;
  if (frame >= callout.lastFrame) return 1;
  return (frame - callout.firstFrame) / (callout.lastFrame - callout.firstFrame);
}

function windowChrome(palette: Palette, frame: number): string {
  const ticks = Array.from({ length: FRAMES_PER_PROJECT }, (_, index) =>
    rect(1380 + index * 34, 24, 22, 22, index + 1 === frame ? palette.accent : "none", { rx: 4, stroke: palette.ink, "stroke-width": 2 })).join("");
  return rect(0, 0, FRAME_SIZE.width, 70, palette.surface)
    + line(0, 70, FRAME_SIZE.width, 70, palette.soft, 2)
    + [0, 1, 2].map((index) => circle(36 + index * 30, 35, 8, index === 0 ? palette.warm : palette.soft)).join("")
    + rect(180, 20, 520, 30, palette.paper, { rx: 15, stroke: palette.soft, "stroke-width": 2 })
    + ticks;
}

function pageSkeleton(palette: Palette, seed: number): string {
  const rows = Array.from({ length: 9 }, (_, index) =>
    rect(60, 110 + index * 100, 300 + ((index * 97 + seed * 53) % 500), 16, palette.soft, { rx: 8, opacity: 0.55 })).join("");
  return rect(0, 70, FRAME_SIZE.width, FRAME_SIZE.height - 70, palette.paper) + rows
    + circle(1500 - seed * 20, 960 - seed * 18, 150 + seed * 16, palette.soft, { opacity: 0.35 });
}

function frameSvg(project: Project, frame: number): string {
  const art = ART[project.slug];
  const seed = PROJECTS.indexOf(project);
  const scenes = project.callouts.map((callout, index) => {
    const [left, top, width, height] = callout.region;
    const box = { x: left * 16, y: top * 10, w: width * 16, h: height * 10 };
    return paintScene(art.scenes[index], box, progressAt(callout, frame), art.palette, `${project.slug}-${frame}-${index}`);
  });
  return svgDocument(FRAME_SIZE.width, FRAME_SIZE.height, pageSkeleton(art.palette, seed), windowChrome(art.palette, frame), ...scenes);
}

function coverSvg(project: Project): string {
  const art = ART[project.slug];
  const seed = PROJECTS.indexOf(project);
  const { palette } = art;
  const stage = { x: 150, y: 170, w: 900, h: 560 };
  const hero = paintScene(art.scenes[1], stage, 1, palette, `${project.slug}-cover`);
  const accentBlock = tag("g", {},
    rect(60 + seed * 12, 60, 220, 44, palette.accent, { rx: 22 }),
    circle(1080 - seed * 30, 790, 70 + seed * 6, palette.warm),
    line(150, 800, 1050, 800, palette.ink, 3),
    ...Array.from({ length: 6 }, (_, index) => rect(150 + index * 150, 790, 100, 20, index === seed ? palette.accent : palette.ink, { rx: 3 })));
  return scaledSvgDocument(COVER_FILE_WIDTH, COVER_SIZE.width, COVER_SIZE.height, rect(0, 0, COVER_SIZE.width, COVER_SIZE.height, palette.paper),
    circle(1000, 120, 260 - seed * 12, palette.soft, { opacity: 0.7 }), hero, accentBlock);
}

/** The artwork of a published media object. */
export function renderMediaObject(object: MediaObject): MediaArtwork {
  const svg = object.frame === undefined ? coverSvg(object.project) : frameSvg(object.project, object.frame);
  return { bytes: Buffer.from(svg, "utf8"), contentType: "image/svg+xml" };
}
