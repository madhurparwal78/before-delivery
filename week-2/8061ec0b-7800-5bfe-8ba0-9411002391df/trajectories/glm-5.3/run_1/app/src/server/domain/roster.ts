// Roster rows and counts (DP-28, DP-29). The current contract is the
// student's most recently created contract that is not expired, judged at
// request time with the hold rule.
import type { PoolClient } from "pg";
import type { DeliveryStatus } from "../../shared/domain.js";
import type { SchoolRow } from "./delivery.js";

export interface RosterRowData {
  student_id: string;
  student_name: string;
  grade: number;
  instrument_type: string | null;
  size: string | null;
  serial: string | null;
  delivery_date: string | null;
  delivery_status: DeliveryStatus;
}

export interface RosterData {
  school: { id: string; name: string; delivery_weekday: string };
  next_delivery_date: string | null;
  counts: Record<DeliveryStatus, number>;
  students: RosterRowData[];
}

export function statusForCurrentContract(status: string | null): DeliveryStatus {
  switch (status) {
    case null:
    case "returned":
    case "written_off":
    case "expired":
      return "no_instrument";
    case "reserved":
    case "agreement_sent":
      return "awaiting_agreement";
    case "signed":
      return "scheduled";
    case "active":
      return "delivered";
    case "paid_off":
      return "owned";
    default:
      return "no_instrument";
  }
}

export async function rosterForSchool(
  client: PoolClient,
  school: SchoolRow,
  nextDeliveryDate: string | null
): Promise<RosterData> {
  const rows = await client.query<Record<string, unknown>>(
    `SELECT s.id AS student_id, s.name AS student_name, s.grade,
            (SELECT c.status FROM contracts c
              WHERE c.student_id = s.id AND c.status <> 'expired'
              ORDER BY c.created_seq DESC, c.created_at DESC LIMIT 1) AS current_status,
            (SELECT c.instrument_id FROM contracts c
              WHERE c.student_id = s.id AND c.status <> 'expired'
              ORDER BY c.created_seq DESC, c.created_at DESC LIMIT 1) AS instrument_id
       FROM students s
       WHERE s.school_id = $1
       ORDER BY s.name ASC`,
    [school.id]
  );
  const students: RosterRowData[] = [];
  for (const r of rows.rows) {
    const status = (r.current_status as string | null) ?? null;
    const deliveryStatus = statusForCurrentContract(status);
    let instrument_type: string | null = null;
    let size: string | null = null;
    let serial: string | null = null;
    let delivery_date: string | null = null;
    if (r.instrument_id) {
      const instr = await client.query<Record<string, unknown>>(
        "SELECT i.instrument_type, i.size, i.serial, c.delivery_date FROM instruments i JOIN contracts c ON c.id = i.current_contract_id WHERE i.id = $1",
        [r.instrument_id]
      );
      if (instr.rows.length > 0) {
        instrument_type = instr.rows[0].instrument_type as string;
        size = instr.rows[0].size as string;
        serial = instr.rows[0].serial as string;
        delivery_date = instr.rows[0].delivery_date as string;
      }
    }
    students.push({
      student_id: r.student_id as string,
      student_name: r.student_name as string,
      grade: Number(r.grade),
      instrument_type,
      size,
      serial,
      delivery_date,
      delivery_status: deliveryStatus,
    });
  }
  const counts: Record<DeliveryStatus, number> = {
    no_instrument: 0,
    awaiting_agreement: 0,
    scheduled: 0,
    delivered: 0,
    owned: 0,
  };
  for (const s of students) counts[s.delivery_status] += 1;
  return {
    school: { id: school.id, name: school.name, delivery_weekday: school.delivery_weekday },
    next_delivery_date: nextDeliveryDate,
    counts,
    students,
  };
}
