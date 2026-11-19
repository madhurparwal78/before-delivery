import type { ExportRecord, Project, SceneObject } from '../../shared/types.js';
import { UI_COPY } from '../../shared/copy.js';
import { el } from '../dom.js';
import { bytesLabel, stamp } from '../format.js';
import { emptyStateDoodle, stillSvg } from '../gl/still.js';
import { colorForIndex } from '../../shared/palette.js';

const hashOf = (value: string): number => {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.codePointAt(0)!) % 1000;
  return hash;
};

/** A procedural card render standing for a saved project. */
export const projectArt = (project: Project): string => {
  const seed = hashOf(project.id);
  const kinds: ('box' | 'cylinder' | 'sphere')[] = ['box', 'cylinder', 'sphere'];
  const objects: SceneObject[] = Array.from({ length: 3 }, (_unused, index) => ({
    id: `${project.id}-${index}`,
    kind: project.kind === 'circuit' ? 'box' : kinds[(seed + index) % 3],
    mode: index === 2 && project.kind === '3d' ? 'hole' : 'solid',
    x: ((seed % 3) - 1) * 12 + index * 6,
    y: (((seed + index) % 3) - 1) * 10,
    z: 8 + index * 6,
    w: 26 - index * 4,
    d: 26 - index * 4,
    h: 16 + ((seed + index) % 3) * 6,
    rotationZ: ((seed + index * 15) % 360),
    color: colorForIndex(seed + index),
    children: [],
  }));
  return stillSvg(objects, { width: 240, height: 150 });
};

export const projectCards = (projects: Project[], zone: string): HTMLElement => {
  const list = el('ul', { class: 'qy-card-grid', 'aria-label': 'My projects' });
  for (const project of projects) {
    list.append(
      el('li', { class: 'qy-card qy-project-card' }, [
        el('div', { class: 'qy-card-art', html: projectArt(project) }),
        el('a', { href: `/editor/${project.id}`, class: 'qy-card-label qy-link', text: project.name }),
        el('p', { class: 'qy-card-meta qy-figures', text: UI_COPY.savedAt(stamp(project.savedAt, zone)) }),
      ]),
    );
  }
  return list;
};

export const exportsList = (exports: ExportRecord[]): HTMLElement => {
  const list = el('ul', { class: 'qy-export-list', 'aria-label': 'My exports' });
  for (const record of exports) {
    list.append(
      el('li', { class: 'qy-export-item' }, [
        el('a', {
          href: record.downloadUrl,
          class: 'qy-link',
          text: `Download ${record.fileName}`,
          download: record.fileName,
        }),
        el('span', {
          class: 'qy-figures qy-muted',
          text: `${record.format.toUpperCase()} · ${record.unit} · ${bytesLabel(record.bytes)}`,
        }),
      ]),
    );
  }
  return list;
};

export const emptyState = (sentence: string, pill: HTMLElement): HTMLElement =>
  el('div', { class: 'qy-empty' }, [
    el('div', { class: 'qy-empty-art', html: emptyStateDoodle() }),
    el('p', { class: 'qy-empty-copy', text: sentence }),
    pill,
  ]);

export const sectionHeading = (text: string): HTMLElement => el('h2', { class: 'qy-section-heading', text });
