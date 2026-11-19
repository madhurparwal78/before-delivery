// The grading seed's ready-made sources. Both load through the upload path, exactly like a person's files.
import { SAMPLE_DIMENSIONS, SAMPLE_HIERARCHY, SAMPLE_RELATION, SAMPLE_TABLES } from '../../shared/sample.ts';
import type { App } from '../http/app.ts';
import { addTable, createSource } from '../sources/ingest.ts';
import { findField, patchField, setHierarchy, setRelation } from '../sources/edits.ts';
import { getFields } from '../sources/repo.ts';

/** The Fernhollow Tea sample: orders left joined to stockists on `Stockist ID`, hierarchy `Geography`. */
export async function loadSample(app: App, projectId: string, name: string): Promise<string> {
  const [first, ...rest] = SAMPLE_TABLES;
  const id = await createSource(app, projectId, name, first.name, Buffer.from(first.csv));
  for (const table of rest) await addTable(app, id, table.name, Buffer.from(table.csv));
  await setRelation(app, id, { ...SAMPLE_RELATION });
  await setHierarchy(app, id, { name: SAMPLE_HIERARCHY.name, fields: [...SAMPLE_HIERARCHY.fields] });
  for (const field of SAMPLE_DIMENSIONS) {
    await patchField(app, id, findField(await getFields(app.db, id), field).id, { kind: 'dimension' });
  }
  return id;
}

/** One table `data`: `Id` 1 to n, `Group` `G{Id mod 10}`, `Value` `Id mod 100`. */
export function generatedCsv(rows: number): string {
  const lines = ['Id,Group,Value'];
  for (let id = 1; id <= rows; id++) lines.push(`${id},G${id % 10},${id % 100}`);
  return `${lines.join('\n')}\n`;
}
