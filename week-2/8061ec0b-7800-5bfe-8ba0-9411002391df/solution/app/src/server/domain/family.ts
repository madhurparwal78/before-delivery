// My family: each child with their contracts, and totals computed at request time from this family only.

import type { FamilyOverview, User } from "../../shared/api.js";
import { OPEN_CONTRACT_STATUSES } from "../../shared/vocabulary.js";
import { pool, query } from "../db/pool.js";
import { contractSummary, loadContractRows, type ContractRow } from "./contracts.js";

/** Open contracts and their equity, and the owned count, over one family's contracts. */
function familyTotals(contracts: readonly ContractRow[]): FamilyOverview["totals"] {
  const open = contracts.filter((c) => OPEN_CONTRACT_STATUSES.includes(c.status));
  return {
    open_contracts: open.length,
    equity_cents: open.reduce((sum, c) => sum + c.equity_cents, 0),
    owned: contracts.filter((c) => c.status === "paid_off").length,
  };
}

export async function familyOverview(user: User): Promise<FamilyOverview> {
  const [family] = await query<{ id: string; parent_name: string; email: string }>(pool,
    "SELECT id, parent_name, email FROM families WHERE id = $1", [user.family_id]);
  const students = await query<{ id: string; name: string; grade: number; school_id: string; school_name: string }>(pool,
    `SELECT s.id, s.name, s.grade, sc.id AS school_id, sc.name AS school_name FROM students s
     JOIN schools sc ON sc.id = s.school_id WHERE s.family_id = $1 ORDER BY s.created_order`, [user.family_id]);
  const contracts = await loadContractRows(pool, "s.family_id = $1", [user.family_id]);
  return {
    family, totals: familyTotals(contracts),
    students: students.map((s) => ({ id: s.id, name: s.name, grade: s.grade, school: { id: s.school_id, name: s.school_name },
      contracts: contracts.filter((c) => c.student_id === s.id).map(contractSummary) })),
  };
}
