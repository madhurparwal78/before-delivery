/**
 * The single place where each shared domain rule is decided: the filter and its
 * canonical address form, the neighbour rule, the counter figure, the callout
 * stepping and the scroll lines. The browser and the server both read them here.
 */

import { DISCIPLINES, PROJECTS, type DisciplineId, type Project } from './seed.js';

const DISCIPLINE_IDS: readonly string[] = DISCIPLINES.map((d) => d.id);

const isDisciplineId = (value: string): value is DisciplineId =>
  DISCIPLINE_IDS.includes(value);

/** Parses a `category` parameter into the pressed disciplines in canonical order. */
export const parseCategoryParam = (raw: string | null): DisciplineId[] => {
  if (raw === null) return [];
  const requested = new Set<DisciplineId>();
  for (const part of raw.split(',')) {
    const value = part.trim();
    if (isDisciplineId(value)) requested.add(value);
  }
  return DISCIPLINES.filter((d) => requested.has(d.id)).map((d) => d.id);
};

/** The canonical `category` value, or null when no discipline is pressed. */
export const formatCategoryParam = (pressed: readonly DisciplineId[]): string | null =>
  pressed.length === 0 ? null : pressed.join(',');

/** With none pressed every project shows; otherwise any pressed discipline matches. */
export const filterProjects = (pressed: readonly DisciplineId[]): Project[] =>
  pressed.length === 0
    ? [...PROJECTS]
    : PROJECTS.filter((project) => project.disciplines.some((d) => pressed.includes(d)));

export const resultLineText = (shownCount: number): string =>
  `Showing ${shownCount} of ${PROJECTS.length} projects.`;

export interface Neighbours {
  readonly previous: Project | null;
  readonly next: Project | null;
}

/**
 * Neighbours come from the shown projects for the address's list, and from all
 * six when there is no list or when this project is not among the shown ones.
 */
export const neighbourProjects = (
  project: Project,
  pressed: readonly DisciplineId[],
): Neighbours => {
  const shown = filterProjects(pressed);
  const list = shown.some((p) => p.slug === project.slug) ? shown : [...PROJECTS];
  const index = list.findIndex((p) => p.slug === project.slug);
  return {
    previous: list[index - 1] ?? null,
    next: list[index + 1] ?? null,
  };
};

/** The address of a project's case study, keeping the pressed disciplines. */
export const projectHref = (slug: string, pressed: readonly DisciplineId[]): string => {
  const category = formatCategoryParam(pressed);
  return category === null ? `/work/${slug}` : `/work/${slug}?category=${category}`;
};

export const backToWorkHref = (pressed: readonly DisciplineId[]): string => {
  const category = formatCategoryParam(pressed);
  return category === null ? '/#work' : `/?category=${category}#work`;
};

export const COUNTER_DURATION_MS = 1500;

/** The figure a counter shows t ms of page time after its block started. */
export const counterFigure = (target: number, elapsedMs: number): number =>
  elapsedMs >= COUNTER_DURATION_MS
    ? target
    : Math.floor((target * elapsedMs) / COUNTER_DURATION_MS);

export const CALLOUT_STEP_MS = 150;

/** The frame a callout range shows t ms of page time after its selection. */
export const calloutFrameAt = (from: number, to: number, elapsedMs: number): number =>
  Math.min(to, from + Math.floor(elapsedMs / CALLOUT_STEP_MS));

export const calloutReadout = (callout: { n: number; from: number; to: number }): string =>
  `Callout ${callout.n} of 3 \u00b7 frames ${callout.from}\u2013${callout.to}`;

export const NO_CALLOUT_READOUT = 'No callout selected';

export const INTRO_END_MS = 1800;
export const ROLE_INTERVAL_MS = 2500;
export const MEDIA_RECHECK_MS = 5000;

export const CURRENT_SECTION_LINE = 0.4;
export const MILESTONE_LINE = 0.6;
export const COUNTER_LINE = 0.75;
export const FOOTER_WAVE_LINE = 0.9;

export interface ScrollTarget {
  readonly id: string;
  /** The top edge of the element, in viewport coordinates. */
  readonly top: number;
}

/**
 * The last target, in page order, whose top edge is at or above the line a share
 * of the way down the viewport. Null when none has reached it.
 */
export const lastTargetAboveLine = (
  targets: readonly ScrollTarget[],
  viewportHeight: number,
  share: number,
): string | null => {
  const line = viewportHeight * share;
  let current: string | null = null;
  for (const target of targets) {
    if (target.top <= line) current = target.id;
  }
  return current;
};

const COPY_DRIFT_RATE = 0.3;
const COPY_DRIFT_LIMIT = 600;

/** The upward shift of the hero copy, in pixels, at window scroll position s. */
export const copyDrift = (scrollY: number): number =>
  Math.round(COPY_DRIFT_RATE * Math.min(Math.max(scrollY, 0), COPY_DRIFT_LIMIT));

const TILT_LIMIT = 12;

/** Rounds to a whole number with an exact half going away from zero. */
const roundHalfAwayFromZero = (value: number): number =>
  value < 0 ? -Math.round(-value) : Math.round(value);

const clampTilt = (value: number): number =>
  Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, value));

export interface Tilt {
  readonly x: number;
  readonly y: number;
}

/** The sculpture's tilt for a pointer at (x, y) over a section box. */
export const sculptureTilt = (
  pointerX: number,
  pointerY: number,
  box: { left: number; top: number; width: number; height: number },
): Tilt => {
  const centreX = box.left + box.width / 2;
  const centreY = box.top + box.height / 2;
  return {
    x: clampTilt(
      roundHalfAwayFromZero((-TILT_LIMIT * (pointerY - centreY)) / (box.height / 2)),
    ),
    y: clampTilt(
      roundHalfAwayFromZero((TILT_LIMIT * (pointerX - centreX)) / (box.width / 2)),
    ),
  };
};

/** Case studies whose technology stack lists a technology, in project order. */
export const projectsUsing = (technology: string): Project[] =>
  PROJECTS.filter((project) => project.stack.includes(technology));

export const NO_USAGE_TEXT = 'Used in client work not shown here.';
