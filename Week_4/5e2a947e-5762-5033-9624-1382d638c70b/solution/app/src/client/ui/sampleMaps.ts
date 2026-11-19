import { emptyDoc, newTopic } from '../../shared/engine.ts';
import type { LayoutMode, MapDoc, Side } from '../../shared/model.ts';
import { placeAmong } from '../../shared/tree.ts';

interface Sketch {
  title: string;
  side?: Side;
  children?: Sketch[];
}

/** An invented sample map as a document, built the way the server builds a template. */
function sampleDoc(centralIdea: string, branches: Sketch[], layout: LayoutMode = 'map'): MapDoc {
  const doc = emptyDoc();
  doc.layout = layout;
  let next = 0;
  const make = (parentId: string | null, title: string): string => {
    const id = `s${next++}`;
    doc.topics[id] = newTopic(doc, id, parentId, title);
    return id;
  };
  const rootId = make(null, centralIdea);
  const grow = (parentId: string, list: Sketch[]): void => {
    for (const sketch of list) {
      const id = make(parentId, sketch.title);
      const topic = doc.topics[id];
      if (!topic) continue;
      if (sketch.side) topic.side_pin = sketch.side;
      placeAmong(doc.topics, parentId, topic, 'last');
      if (sketch.children) grow(id, sketch.children);
    }
  };
  grow(rootId, branches);
  return doc;
}

/** The home page's hero map: eight level 2 topics, the first four pinned left and the last four right, so the ribbons run in branch-colour order. */
export const HERO_DOC: MapDoc = sampleDoc('Sprigmap', [
  { title: 'Plan', side: 'left' },
  { title: 'Research', side: 'left' },
  { title: 'Draft', side: 'left' },
  { title: 'Review', side: 'left' },
  { title: 'Share', side: 'right' },
  { title: 'Present', side: 'right' },
  { title: 'Publish', side: 'right' },
  { title: 'Revisit', side: 'right' },
]);

export const SEED_SWAP: MapDoc = sampleDoc('Seed swap', [
  { title: 'Venue', children: [{ title: 'Village hall' }, { title: 'Tables' }] },
  { title: 'Seeds to bring', children: [{ title: 'Beans' }, { title: 'Sunflowers' }, { title: 'Herbs' }] },
  { title: 'Volunteers', children: [{ title: 'Set up' }, { title: 'Table duty' }] },
  { title: 'Posters' },
  { title: 'Tea and cake' },
  { title: 'Thank-you notes' },
]);

export const CHAPTER_PLAN: MapDoc = sampleDoc('Lighthouse novel', [
  { title: 'Opening', children: [{ title: 'The storm' }, { title: 'A stranger lands' }] },
  { title: 'Characters', children: [{ title: 'Maya' }, { title: 'The keeper' }, { title: 'The ferryman' }] },
  { title: 'Setting' },
  { title: 'Ending', children: [{ title: 'Lamp goes dark' }, { title: 'Morning boat' }] },
  { title: 'Themes' },
  { title: 'Research' },
]);

export const TRAIN_NOTES: MapDoc = sampleDoc('Thesis notes', [
  { title: 'Sources', children: [{ title: 'Interviews' }, { title: 'Archives' }, { title: 'Surveys' }] },
  { title: 'Method', children: [{ title: 'Coding' }, { title: 'Sampling' }] },
  { title: 'Chapters', children: [{ title: 'Introduction' }, { title: 'Findings' }] },
  { title: 'To do' },
  { title: 'Questions' },
  { title: 'Supervisor notes' },
]);

export const RUNBOOK: MapDoc = sampleDoc('Open day', [
  { title: 'Welcome talk' },
  { title: 'Tours', children: [{ title: 'Labs' }, { title: 'Library' }, { title: 'Workshop' }] },
  { title: 'Questions' },
  { title: 'Follow up', children: [{ title: 'Survey' }, { title: 'Thank you' }] },
  { title: 'Lunch' },
  { title: 'Signage', children: [{ title: 'Car park' }, { title: 'Doors' }] },
]);
