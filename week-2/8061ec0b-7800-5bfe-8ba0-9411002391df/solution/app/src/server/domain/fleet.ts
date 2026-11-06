// The fleet: each instrument's status follows its contract; availability and the unit a reservation takes.

import type { AvailabilityItem, Instrument } from "../../shared/api.js";
import { AVAILABILITY_ORDER, instrumentLabel, isStringInstrument, sizesFor, type ContractStatus, type InstrumentStatus,
  type InstrumentType, type Size } from "../../shared/vocabulary.js";
import { query, type Queryable } from "../db/pool.js";
import { ApiError } from "../http/errors.js";

interface FleetRow {
  serial: string; instrument_type: InstrumentType; size: Size; model: string; retired: boolean;
  contract_id: string | null; contract_status: ContractStatus | null; school_name: string | null;
}

/** An instrument's status, from its seeded retirement and the contract that holds it. */
function instrumentStatus(retired: boolean, contractStatus: ContractStatus | null): InstrumentStatus {
  if (retired || contractStatus === "written_off") return "retired";
  if (contractStatus === "paid_off") return "sold";
  return contractStatus === null ? "available" : "on_contract";
}

/** Every instrument with the contract that holds it (open, paid off or written off), sorted by serial. */
async function fleetRows(db: Queryable, where = "TRUE", values: unknown[] = []): Promise<FleetRow[]> {
  return query<FleetRow>(db, `
    SELECT i.serial, i.instrument_type, i.size, i.model, i.retired, c.id AS contract_id, c.status AS contract_status,
      sc.name AS school_name
    FROM instruments i
    LEFT JOIN LATERAL (
      SELECT id, status, student_id FROM contracts
      WHERE instrument_serial = i.serial
        AND status IN ('reserved', 'agreement_sent', 'signed', 'active', 'paid_off', 'written_off')
      ORDER BY created_order DESC LIMIT 1) c ON TRUE
    LEFT JOIN students st ON st.id = c.student_id
    LEFT JOIN schools sc ON sc.id = st.school_id
    WHERE ${where}
    ORDER BY i.serial COLLATE "C"`, values);
}

export async function listInstruments(db: Queryable): Promise<Instrument[]> {
  return (await fleetRows(db)).map((row, i) => ({
    index: i + 1, serial: row.serial, instrument_type: row.instrument_type, size: row.size, model: row.model,
    label: instrumentLabel(row.instrument_type, row.size), status: instrumentStatus(row.retired, row.contract_status),
    contract_id: row.contract_id, school_name: row.school_name,
  }));
}

export async function availability(db: Queryable): Promise<AvailabilityItem[]> {
  const rows = await fleetRows(db);
  return AVAILABILITY_ORDER.map(({ instrument_type, size }) => ({
    instrument_type, size,
    available: rows.filter((r) => r.instrument_type === instrument_type && r.size === size
      && instrumentStatus(r.retired, r.contract_status) === "available").length,
  }));
}

/**
 * The available unit of a type and size whose serial sorts first, or the 409 unavailable answer listing every size
 * of the same instrument that still has a unit. Callers hold the fleet lock.
 */
export async function takeFirstAvailable(db: Queryable, type: InstrumentType, size: Size): Promise<string> {
  const rows = await fleetRows(db, "i.instrument_type = $1", [type]);
  const free = rows.filter((r) => instrumentStatus(r.retired, r.contract_status) === "available");
  const unit = free.find((r) => r.size === size);
  if (unit) return unit.serial;
  const alternatives = sizesFor(type).map((s) => ({ instrument_type: type, size: s,
    available: free.filter((r) => r.size === s).length })).filter((a) => a.available > 0);
  throw new ApiError(409, "unavailable", "No longer available", { alternatives });
}

/** Strings only move up: a size is larger when it comes later in the size order. */
export function isLargerSize(type: InstrumentType, from: Size, to: Size): boolean {
  const order = sizesFor(type);
  return isStringInstrument(type) && order.indexOf(to) > order.indexOf(from);
}
