import { query } from './db/pool';
import { lapseAnswersEverywhere } from './store/caseengine';
import { deleteObject } from './services/s3';

/** Timed work: answer windows, data request page ends and retention erasure. */

interface DueCaseRow {
  id: string;
}

interface ObjectRow {
  table_name: string;
  id: string;
  object_key: string;
}

async function eraseCase(caseId: string, now: Date): Promise<void> {
  await query(
    `UPDATE cases SET erasure_status = 'pending', originator_name = NULL,
       originator_identity_number = NULL, originator_date_of_birth = NULL,
       beneficiary_name = NULL WHERE id = $1`,
    [caseId],
  );
  await query(
    `UPDATE messages SET working = jsonb_strip_nulls(
        working
          || CASE WHEN working ? 'originator' THEN jsonb_build_object('originator', (working -> 'originator') || '{"name": null}'::jsonb) ELSE '{}'::jsonb END
          || CASE WHEN working ? 'beneficiary' THEN jsonb_build_object('beneficiary', (working -> 'beneficiary') || '{"name": null}'::jsonb) ELSE '{}'::jsonb END
      ) WHERE case_id = $1`,
    [caseId],
  );
  const objects = await query<ObjectRow>(
    `SELECT 'messages' AS table_name, id, object_key FROM messages
       WHERE case_id = $1 AND object_deleted = false
     UNION ALL
     SELECT 'certificates' AS table_name, id, object_key FROM certificates
       WHERE case_id = $1 AND object_deleted = false`,
    [caseId],
  );
  let allGone = true;
  for (const object of objects) {
    try {
      await deleteObject(object.object_key);
      await query(
        object.table_name === 'messages'
          ? 'UPDATE messages SET object_deleted = true WHERE id = $1'
          : 'UPDATE certificates SET object_deleted = true WHERE id = $1',
        [object.id],
      );
    } catch {
      allGone = false;
    }
  }
  if (allGone) {
    await query("UPDATE cases SET erasure_status = 'erased', erased_at = $2 WHERE id = $1", [
      caseId,
      now,
    ]);
  }
}

async function runOnce(): Promise<void> {
  const now = new Date();
  await lapseAnswersEverywhere(now);
  const due = await query<DueCaseRow>(
    `SELECT id FROM cases
     WHERE erasure_status IN ('scheduled','pending') AND erasure_due_at <= $1
     ORDER BY erasure_due_at LIMIT 50`,
    [now],
  );
  for (const row of due) {
    await eraseCase(row.id, now);
  }
}

export function startWorker(): NodeJS.Timeout {
  const timer = setInterval(() => {
    runOnce().catch(() => undefined);
  }, 5000);
  timer.unref();
  runOnce().catch(() => undefined);
  return timer;
}
