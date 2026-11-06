import { OPEN_STATUSES, type FamilyResponse } from '../../shared/types';
import { contractSummary, loadContractRowsByStudents } from './contracts';
import type { Db } from './pricing';

/** My family's totals, computed at request time from the parent's own children only. */
export async function familyOverview(db: Db, familyId: string): Promise<FamilyResponse> {
  const { rows: familyRows } = await db.query<{ id: string; parent_name: string; email: string }>(
    'select id, parent_name, email from families where id = $1',
    [familyId],
  );
  const family = familyRows[0];
  if (family === undefined) throw new Error(`family ${familyId} is missing`);

  const { rows: students } = await db.query<{
    id: string;
    name: string;
    grade: number;
    school_id: string;
    school_name: string;
  }>(
    `select s.id, s.name, s.grade, s.school_id, sch.name as school_name
       from students s join schools sch on sch.id = s.school_id
      where s.family_id = $1 order by s.name`,
    [familyId],
  );
  const rows = await loadContractRowsByStudents(db, students.map((student) => student.id));
  const summaries = await Promise.all(rows.map((row) => contractSummary(db, row)));

  let equityCents = 0;
  let openContracts = 0;
  let owned = 0;
  for (const summary of summaries) {
    if (OPEN_STATUSES.includes(summary.status)) {
      openContracts += 1;
      equityCents += summary.equity_cents;
    }
    if (summary.status === 'paid_off') owned += 1;
  }

  return {
    family: { id: family.id, parent_name: family.parent_name, email: family.email },
    totals: { open_contracts: openContracts, equity_cents: equityCents, owned },
    students: students.map((student) => ({
      id: student.id,
      name: student.name,
      grade: student.grade,
      school: { id: student.school_id, name: student.school_name },
      contracts: summaries.filter((_, index) => rows[index]?.student_id === student.id),
    })),
  };
}
