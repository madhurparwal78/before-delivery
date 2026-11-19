import { randomUUID } from 'node:crypto';
import { emptyDoc, newTopic, DEFAULT_TASK } from '../shared/ops.js';
import type { MapDoc, Task } from '../shared/types.js';

export type TemplateKey = 'street-fair' | 'exam-revision' | 'house-move';

interface TemplateTopic {
  title: string;
  task?: Partial<Task>;
  children?: TemplateTopic[];
}

const TEMPLATES: Record<TemplateKey, TemplateTopic[]> = {
  'street-fair': [
    { title: 'Stalls' },
    { title: 'Music stage' },
    {
      title: 'Volunteers and rotas',
      children: [{ title: 'Morning shift' }, { title: 'Afternoon shift' }],
    },
    { title: 'Budget' },
  ],
  'exam-revision': [
    { title: 'Biology', children: [{ title: 'Cells' }, { title: 'Genetics' }] },
    { title: 'History' },
    { title: 'Maths', task: { percent: 0 } },
    { title: 'Past papers' },
  ],
  'house-move': [
    { title: 'Boxes' },
    { title: 'Utilities' },
    { title: 'Change of address' },
    { title: 'Moving day' },
  ],
};

function shortId(): string {
  return `t-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function buildMapDoc(centralIdea: string, template: TemplateKey | null): MapDoc {
  const doc = emptyDoc(shortId(), centralIdea);
  if (template === null) return doc;
  const add = (parentId: string, node: TemplateTopic): void => {
    const id = shortId();
    const topic = newTopic(id, parentId, node.title);
    if (node.task) topic.task = { ...DEFAULT_TASK, ...node.task };
    doc.topics[id] = topic;
    doc.topics[parentId].children.push(id);
    for (const child of node.children ?? []) add(id, child);
  };
  for (const node of TEMPLATES[template]) add(doc.root, node);
  return doc;
}

export function isTemplateKey(value: unknown): value is TemplateKey {
  return value === 'street-fair' || value === 'exam-revision' || value === 'house-move';
}

/** The generated map used by the grading seed route. */
export function buildGeneratedDoc(topics: number, fanout: number): MapDoc {
  const doc = emptyDoc('g0', 'Generated map');
  for (let i = 1; i < topics; i += 1) {
    const parentIndex = Math.floor((i - 1) / fanout);
    const parentId = `g${parentIndex}`;
    const id = `g${i}`;
    doc.topics[id] = newTopic(id, parentId, `Topic ${i}`);
    doc.topics[parentId].children.push(id);
  }
  return doc;
}
