// Fleet and student intake by the owner, and the families listing behind Add student.

import type { Family, Instrument } from "../../shared/api.js";
import { instrumentLabel, instrumentName, isInstrumentType, isSizeFor, sizesFor, sizeWord } from "../../shared/vocabulary.js";
import { pool, query } from "../db/pool.js";
import { ApiError, validationFailed } from "../http/errors.js";
import { fieldOf, trimmedText, wholeNumber } from "../http/fields.js";

export async function addInstrument(body: unknown): Promise<{ instrument: Instrument }> {
  const fields: Record<string, string> = {};
  const serial = fieldOf(body, "serial");
  if (typeof serial !== "string" || !/^[A-Z0-9-]{3,20}$/.test(serial)) {
    fields.serial = "Use 3 to 20 capital letters, digits and hyphens.";
  }
  const type = fieldOf(body, "instrument_type");
  if (!isInstrumentType(type)) fields.instrument_type = "Choose flute, clarinet, trumpet, violin or cello.";
  const size = fieldOf(body, "size");
  if (!isInstrumentType(type) || !isSizeFor(type, size)) {
    fields.size = isInstrumentType(type)
      ? `A ${instrumentName(type).toLowerCase()} comes in ${sizesFor(type).map(sizeWord).join(", ")}.`
      : "Choose a size that fits the instrument.";
  }
  const model = trimmedText(fieldOf(body, "model"), 1, 80);
  if (model === null) fields.model = "Enter the model, 1 to 80 characters.";
  if (typeof serial !== "string" || !isInstrumentType(type) || !isSizeFor(type, size) || model === null
    || Object.keys(fields).length > 0) throw validationFailed(fields);
  const inserted = await pool.query(`INSERT INTO instruments (serial, instrument_type, size, model) VALUES ($1, $2, $3, $4)
    ON CONFLICT (serial) DO NOTHING`, [serial, type, size, model]);
  if (inserted.rowCount === 0) throw new ApiError(409, "serial_taken", `Serial ${serial} is already in the fleet.`);
  return { instrument: { index: (await query<{ n: number }>(pool,
    `SELECT count(*)::int AS n FROM instruments WHERE serial COLLATE "C" <= $1 COLLATE "C"`, [serial]))[0].n,
  serial, instrument_type: type, size, model, label: instrumentLabel(type, size), status: "available", contract_id: null,
  school_name: null } };
}

export async function listFamilies(): Promise<{ families: Family[] }> {
  const families = await query<Omit<Family, "students">>(pool,
    "SELECT id, parent_name, email, phone, address FROM families ORDER BY id");
  const students = await query<Family["students"][number] & { family_id: string }>(pool,
    "SELECT id, name, grade, school_id, family_id FROM students ORDER BY created_order");
  return { families: families.map((f) => ({ ...f, students: students.filter((s) => s.family_id === f.id)
    .map(({ id, name, grade, school_id }) => ({ id, name, grade, school_id })) })) };
}

export async function addStudent(body: unknown): Promise<unknown> {
  const fields: Record<string, string> = {};
  const familyId = fieldOf(body, "family_id");
  const schoolId = fieldOf(body, "school_id");
  const [family] = typeof familyId === "string" ? await query(pool, "SELECT 1 FROM families WHERE id = $1", [familyId]) : [];
  if (family === undefined) fields.family_id = "Choose one of the store's families.";
  const [school] = typeof schoolId === "string" ? await query(pool, "SELECT 1 FROM schools WHERE id = $1", [schoolId]) : [];
  if (school === undefined) fields.school_id = "Choose a partner school.";
  const name = trimmedText(fieldOf(body, "name"), 1, 80);
  if (name === null) fields.name = "Enter the student's name, 1 to 80 characters.";
  const grade = wholeNumber(fieldOf(body, "grade"), 0, 12);
  if (grade === null) fields.grade = "Enter a grade from 0 (kindergarten) to 12.";
  if (name === null || grade === null || Object.keys(fields).length > 0) throw validationFailed(fields);
  const [student] = await query<{ id: string }>(pool, `INSERT INTO students (id, name, grade, school_id, family_id)
    SELECT 'S-' || lpad(n::text, greatest(2, length(n::text)), '0'), $1, $2::integer, $3, $4 FROM nextval('student_number') AS n
    RETURNING id`,
  [name, grade, schoolId, familyId]);
  return { student: { id: student.id, name, grade, school_id: schoolId, family_id: familyId } };
}
