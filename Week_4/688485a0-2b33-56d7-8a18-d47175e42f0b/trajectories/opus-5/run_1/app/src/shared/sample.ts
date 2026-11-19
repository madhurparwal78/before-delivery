import { DocObject } from './values';

const FAMILIES = ['Araceae', 'Cactaceae', 'Marantaceae', 'Moraceae', 'Asparagaceae'];
const LIGHTS = ['low', 'medium', 'bright'];
const POTS = [12, 15, 18];

export const SAMPLE_PIPELINE_TEXT = [
  '{"$match":{"light":"bright"}}',
  '{"$unwind":"$pots"}',
  '{"$group":{"_id":"$family","pots":{"$count":{}}}}',
  '{"$sort":{"pots":-1,"_id":1}}',
];

/** The built-in houseplant collection, generated identically on every start. */
export function houseplantDocuments(): DocObject[] {
  const docs: DocObject[] = [];
  for (let i = 1; i <= 1240; i += 1) {
    docs.push({
      _id: i.toString(16).padStart(24, '0'),
      name: `Plant ${i}`,
      family: FAMILIES[i % 5],
      light: LIGHTS[i % 3],
      water_days: 3 + (i % 12),
      pots: POTS.slice(0, i % 4),
    });
  }
  return docs;
}
