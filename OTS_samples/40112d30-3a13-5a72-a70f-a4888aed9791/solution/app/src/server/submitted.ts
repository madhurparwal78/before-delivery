import type { Answers, FormDefinition } from '../shared/types.ts';
import type { Db } from './db.ts';
import { resolve, type Resolved } from './engine/index.ts';
import { engineEnv, loadEdition } from './forms.ts';
import { referenceOf } from './ids.ts';
import { isoWithOffset } from './time.ts';

// The submitted responses of a form with their edition's resolved walk: the one source for the owner's response
// view, the summary and the CSV export.

export interface Submitted {
  id: string;
  reference: string;
  edition: number;
  submittedAt: Date;
  answers: Answers;
  def: FormDefinition;
  res: Resolved;
}

export const submittedAtText = (row: Submitted): string => isoWithOffset(row.submittedAt);

interface Row { id: string; edition: number; answers: Answers; submitted_at: Date }

/** Oldest first. Calculated values are computed on the day of the submission, so they never drift. */
export async function loadSubmitted(db: Db, formId: string, only?: string): Promise<Submitted[]> {
  const { rows } = await db.query<Row>(
    `SELECT id, edition, answers, submitted_at FROM responses
     WHERE form_id = $1 AND status = 'submitted' AND ($2::uuid IS NULL OR id = $2)
     ORDER BY submitted_at, id`,
    [formId, only ?? null],
  );
  const result: Submitted[] = [];
  for (const row of rows) {
    const def = await loadEdition(db, formId, row.edition);
    result.push({
      id: row.id, reference: referenceOf(row.id), edition: row.edition, submittedAt: row.submitted_at, answers: row.answers, def,
      res: resolve(def, row.answers, engineEnv(row.submitted_at)),
    });
  }
  return result;
}
