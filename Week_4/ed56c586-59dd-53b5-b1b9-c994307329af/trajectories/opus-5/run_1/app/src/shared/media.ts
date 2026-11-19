/** The published media manifest: the only keys the media library ever holds. */

import { FRAMES_PER_PROJECT, PROJECTS } from './seed.js';

export interface MediaObject {
  readonly key: string;
  readonly slug: string;
  readonly kind: 'cover' | 'frame';
  /** 1 to 6 for a frame, 0 for a cover. */
  readonly frame: number;
}

const buildManifest = (): readonly MediaObject[] => {
  const objects: MediaObject[] = [];
  for (const project of PROJECTS) {
    objects.push({ key: `work/${project.slug}/cover`, slug: project.slug, kind: 'cover', frame: 0 });
    for (let frame = 1; frame <= FRAMES_PER_PROJECT; frame += 1) {
      objects.push({
        key: `work/${project.slug}/frame-${frame}`,
        slug: project.slug,
        kind: 'frame',
        frame,
      });
    }
  }
  return objects;
};

export const MEDIA_MANIFEST: readonly MediaObject[] = buildManifest();

const BY_KEY = new Map(MEDIA_MANIFEST.map((object) => [object.key, object]));

export const mediaObjectForKey = (key: string): MediaObject | undefined => BY_KEY.get(key);

export const coverKey = (slug: string): string => `work/${slug}/cover`;

export const frameKey = (slug: string, frame: number): string => `work/${slug}/frame-${frame}`;

export const mediaHref = (key: string): string => `/media/${key}`;

export const MEDIA_CONTENT_TYPE = 'image/svg+xml';
