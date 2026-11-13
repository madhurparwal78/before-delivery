import type { Chapter } from '../../shared/copy.js';
import { chapterAt, chapterRanges, strikeChapters } from './chapters.js';
import type { SceneHandle, SceneReadout } from './scene.js';

const poses: Record<Chapter, { x: number; y: number; z: number }> = {
  alley: { x: 0, y: 1.7, z: 16 },
  stove: { x: -1.6, y: 1.7, z: 9 },
  goose: { x: 1.6, y: 1.7, z: 3 },
  tree: { x: -1.6, y: 1.8, z: -3 },
  star: { x: 0.4, y: 2.6, z: -9 },
  grandmother: { x: 0, y: 1.9, z: -15 },
  shelf: { x: 0, y: 1.7, z: -21.5 },
};

const unlitArt = `
  <rect width="320" height="240" fill="#070b14"/>
  <rect x="0" y="170" width="320" height="70" fill="#1b2434"/>
  <rect x="14" y="30" width="70" height="140" fill="#131a28"/>
  <rect x="236" y="20" width="70" height="150" fill="#131a28"/>
  <rect x="30" y="60" width="18" height="24" fill="#2a3348"/>
  <rect x="258" y="54" width="18" height="24" fill="#2a3348"/>
  <circle cx="160" cy="196" r="10" fill="#2b3348"/>
  <g fill="#dfe8f5" opacity="0.8">
    <circle cx="40" cy="40" r="1.6"/><circle cx="120" cy="22" r="1.4"/><circle cx="200" cy="60" r="1.5"/>
    <circle cx="270" cy="110" r="1.3"/><circle cx="90" cy="130" r="1.5"/><circle cx="180" cy="150" r="1.2"/>
  </g>`;

const litArt: Record<Chapter, string> = {
  alley: unlitArt,
  stove: `
    <rect width="320" height="240" fill="#141a26"/>
    <rect x="120" y="90" width="80" height="100" fill="#2b2f38"/>
    <rect x="152" y="30" width="16" height="60" fill="#2b2f38"/>
    <circle cx="160" cy="140" r="16" fill="#f4c63c"/>
    <rect x="124" y="188" width="12" height="14" fill="#b98a3a"/>
    <rect x="184" y="188" width="12" height="14" fill="#b98a3a"/>`,
  goose: `
    <rect width="320" height="240" fill="#141a26"/>
    <rect x="60" y="130" width="200" height="12" fill="#dfe6ef"/>
    <rect x="70" y="142" width="180" height="26" fill="#cdd7e4"/>
    <ellipse cx="160" cy="116" rx="44" ry="22" fill="#a5672c"/>
    <rect x="156" y="84" width="3" height="26" fill="#b98a3a"/>
    <rect x="166" y="84" width="3" height="26" fill="#b98a3a"/>`,
  tree: `
    <rect width="320" height="240" fill="#141a26"/>
    <polygon points="160,30 210,110 110,110" fill="#24402f"/>
    <polygon points="160,80 225,160 95,160" fill="#24402f"/>
    <rect x="152" y="160" width="16" height="30" fill="#a5672c"/>
    <g fill="#f4c63c">
      <circle cx="140" cy="100" r="4"/><circle cx="180" cy="100" r="4"/>
      <circle cx="125" cy="148" r="4"/><circle cx="160" cy="140" r="4"/><circle cx="196" cy="148" r="4"/>
    </g>`,
  star: `
    <rect width="320" height="240" fill="#0b1220"/>
    <circle cx="210" cy="60" r="8" fill="#fff1c0"/>
    <path d="M216 54 L270 14" stroke="#f4c63c" stroke-width="4" stroke-linecap="round"/>
    <g fill="#dfe8f5"><circle cx="60" cy="40" r="2"/><circle cx="110" cy="80" r="1.6"/><circle cx="150" cy="30" r="1.8"/></g>`,
  grandmother: `
    <rect width="320" height="240" fill="#1b2130"/>
    <polygon points="160,70 210,200 110,200" fill="#4a5160"/>
    <circle cx="160" cy="56" r="18" fill="#d8c3ad"/>
    <ellipse cx="160" cy="80" rx="30" ry="10" fill="#dfe6ef"/>
    <circle cx="160" cy="120" r="56" fill="#f4c63c" opacity="0.18"/>`,
  shelf: `
    <rect width="320" height="240" fill="#0a0f1a"/>
    <g fill="#39404e">
      ${Array.from({ length: 48 }, (unused, index) => {
        const column = index % 8;
        const row = Math.floor(index / 8);
        return `<rect x="${24 + column * 34}" y="${30 + row * 34}" width="26" height="26"/>`;
      }).join('')}
    </g>`,
};

export interface StillHandle extends SceneHandle {
  readonly element: HTMLElement;
  stepChapter(direction: 1 | -1): void;
  currentChapter(): Chapter;
}

export interface StillOptions {
  onChange: () => void;
}

/** The still substitute keeps every story, hold and checkout function working. */
export function createStill(options: StillOptions): StillHandle {
  const element = document.createElement('div');
  element.className = 'still';
  element.setAttribute('aria-hidden', 'true');
  const frame = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  frame.setAttribute('viewBox', '0 0 320 240');
  frame.setAttribute('role', 'presentation');
  element.append(frame);

  let index = 0;
  let lit: Chapter | null = null;
  let holdRemainingMs: number | null = null;
  let holdFullMs = 1;

  const readout: SceneReadout = {
    progress: 0,
    chapter: 'alley',
    cameraPosition: poses.alley,
    lightIntensity: 0,
    litMatches: 0,
    holdRemainingMs: null,
    matchLength: null,
  };

  function paint(): void {
    const chapter = chapterRanges[index]?.chapter ?? 'alley';
    frame.innerHTML = lit === chapter ? (litArt[chapter] ?? unlitArt) : unlitArt;
    readout.progress = chapterRanges[index]?.from ?? 0;
    readout.chapter = chapter;
    readout.cameraPosition = poses[chapter];
    readout.lightIntensity = lit === null ? 0 : lit === 'grandmother' ? 2 : 1;
    readout.litMatches = lit === null ? 0 : lit === 'grandmother' ? 12 : 1;
    readout.holdRemainingMs = holdRemainingMs;
    readout.matchLength =
      holdRemainingMs === null ? null : Math.max(0, Math.min(1, holdRemainingMs / holdFullMs));
    options.onChange();
  }

  paint();

  return {
    element,
    readout,
    setProgress(progress) {
      const chapter = chapterAt(progress);
      const next = chapterRanges.findIndex((range) => range.chapter === chapter);
      if (next >= 0 && next !== index) {
        index = next;
        lit = null;
      }
      paint();
    },
    strike() {
      const chapter = chapterRanges[index]?.chapter ?? 'alley';
      if (!strikeChapters.includes(chapter)) return false;
      if (lit !== null) return false;
      lit = chapter;
      paint();
      return true;
    },
    burning() {
      return lit !== null;
    },
    setShelfStates() {
      /* the still substitute shows state through the DOM shelf */
    },
    setShelfCells() {
      /* the still substitute has no projected boxes to place */
    },
    focusBox() {
      /* there is no camera to turn in the still substitute */
    },
    setHold(remainingMs, holdMs) {
      holdRemainingMs = remainingMs;
      holdFullMs = holdMs > 0 ? holdMs : 1;
      paint();
    },
    stepChapter(direction) {
      const next = Math.min(chapterRanges.length - 1, Math.max(0, index + direction));
      if (next === index) return;
      index = next;
      lit = null;
      paint();
    },
    currentChapter() {
      return chapterRanges[index]?.chapter ?? 'alley';
    },
  };
}
