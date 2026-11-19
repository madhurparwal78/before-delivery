import { emptyDoc, newTopic } from '../shared/engine.ts';
import type { MapDoc, TaskFields } from '../shared/model.ts';
import { placeAmong } from '../shared/tree.ts';
import { randomId } from './ids.ts';

export const TEMPLATES = ['street-fair', 'exam-revision', 'house-move'] as const;
export type TemplateName = (typeof TEMPLATES)[number];

interface Sketch {
  title: string;
  task?: TaskFields;
  children?: Sketch[];
}

const OPEN_TASK: TaskFields = { percent: 0, weight: 1, state: 'open', priority: 'normal', due: null, assignee: null };

const SKETCHES: Record<TemplateName, Sketch[]> = {
  'street-fair': [
    { title: 'Stalls' },
    { title: 'Music stage' },
    { title: 'Volunteers and rotas', children: [{ title: 'Morning shift' }, { title: 'Afternoon shift' }] },
    { title: 'Budget' },
  ],
  'exam-revision': [
    { title: 'Biology', children: [{ title: 'Cells' }, { title: 'Genetics' }] },
    { title: 'History' },
    { title: 'Maths', task: OPEN_TASK },
    { title: 'Past papers' },
  ],
  'house-move': [{ title: 'Boxes' }, { title: 'Utilities' }, { title: 'Change of address' }, { title: 'Moving day' }],
};

/** A new map document: the central idea alone, or the idea with a template's branches. */
export function buildDoc(centralIdea: string, template: TemplateName | null): MapDoc {
  const doc = emptyDoc();
  const root = newTopic(doc, `t${randomId(10)}`, null, centralIdea);
  doc.topics[root.id] = root;
  const grow = (parentId: string, sketches: Sketch[]): void => {
    for (const sketch of sketches) {
      const topic = newTopic(doc, `t${randomId(10)}`, parentId, sketch.title);
      if (sketch.task) topic.task = { ...sketch.task };
      doc.topics[topic.id] = topic;
      placeAmong(doc.topics, parentId, topic, 'last');
      if (sketch.children) grow(topic.id, sketch.children);
    }
  };
  if (template) grow(root.id, SKETCHES[template]);
  return doc;
}
