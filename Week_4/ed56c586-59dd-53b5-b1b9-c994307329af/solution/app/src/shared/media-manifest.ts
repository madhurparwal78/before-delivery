import { FRAMES_PER_PROJECT, PROJECTS, type Project } from "./catalog.js";

/** The media manifest: the 42 published objects, in manifest order. Browser code names media only by their keys. */

export const FRAME_SIZE = { width: 1600, height: 1000 } as const;
export const COVER_SIZE = { width: 1200, height: 900 } as const;

export interface MediaObject {
  readonly key: string;
  readonly project: Project;
  /** The frame number from 1 to 6, or undefined for the project's cover. */
  readonly frame: number | undefined;
}

export function coverKey(slug: string): string {
  return `work/${slug}/cover`;
}

export function frameKey(slug: string, frame: number): string {
  return `work/${slug}/frame-${frame}`;
}

export const MEDIA_OBJECTS: readonly MediaObject[] = PROJECTS.flatMap((project) => [
  { key: coverKey(project.slug), project, frame: undefined },
  ...Array.from({ length: FRAMES_PER_PROJECT }, (_, index) => ({ key: frameKey(project.slug, index + 1), project, frame: index + 1 })),
]);

export const MEDIA_KEYS: readonly string[] = MEDIA_OBJECTS.map((object) => object.key);

const PUBLISHED = new Map(MEDIA_OBJECTS.map((object) => [object.key, object]));

export function mediaObjectByKey(key: string): MediaObject | undefined {
  return PUBLISHED.get(key);
}

/** The accessible name of a preview frame, and the text of the quick look's frame status. */
export function frameLabel(title: string, frame: number): string {
  return `${title}, frame ${frame} of ${FRAMES_PER_PROJECT}`;
}

export function frameStatus(frame: number): string {
  return `Frame ${frame} of ${FRAMES_PER_PROJECT}`;
}

export function mediaPath(key: string): string {
  return `/media/${key}`;
}

type MediaStatus = "available" | "unavailable";

interface MediaObjectReport {
  readonly key: string;
  readonly available: boolean;
}

export interface MediaReport {
  readonly status: MediaStatus;
  readonly objects: readonly MediaObjectReport[];
}

export const MEDIA_RECHECK_MS = 5000;
