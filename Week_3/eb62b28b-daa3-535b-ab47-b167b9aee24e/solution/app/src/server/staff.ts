// Staff records, managed by the owner.

import { randomUUID } from "node:crypto";
import type { Role, StaffView } from "../shared/api";
import { isUniqueViolation, one, pool, rows } from "./db";
import { conflict, invalid, notFound } from "./errors";
import { isOneOf, text, type JsonBody } from "./fields";

import { EMAIL_COPY, emailTaken, isLongEnoughPassword, isValidEmail, NAME_COPY, OPTIONS_COPY, PASSWORD_COPY } from "./members";
import { hashPassword } from "./sessions";

const ASSIGNABLE = ["specialist", "coordinator", "billingLead"] as const;

interface StaffRow {
  id: string;
  name: string;
  email: string;
  role: Role;
}

const STAFF_ROLES = "role <> 'member'";

export async function staffList(): Promise<StaffView[]> {
  return rows<StaffRow>(pool, `SELECT id, name, email, role FROM people WHERE ${STAFF_ROLES} ORDER BY name`);
}

export async function staffById(id: string): Promise<StaffView> {
  const row = await one<StaffRow>(pool, `SELECT id, name, email, role FROM people WHERE id = $1 AND ${STAFF_ROLES}`, [id]);
  if (!row) throw notFound();
  return row;
}

export async function addStaff(body: JsonBody): Promise<StaffView> {
  const fields: Record<string, string> = {};
  const name = text(body, "name").trim();
  const email = text(body, "email").trim();
  const password = text(body, "password");
  const role = body["role"];
  if (!name) fields["name"] = NAME_COPY;
  if (!isValidEmail(email)) fields["email"] = EMAIL_COPY;
  if (!isLongEnoughPassword(password)) fields["password"] = PASSWORD_COPY;
  if (!isOneOf(ASSIGNABLE, role)) throw invalid({ ...fields, role: OPTIONS_COPY });
  if (Object.keys(fields).length > 0) throw invalid(fields);
  const id = randomUUID();
  try {
    await pool.query("INSERT INTO people (id, role, name, email, password_hash) VALUES ($1, $2, $3, $4, $5)", [
      id, role, name, email, await hashPassword(password),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) throw emailTaken();
    throw error;
  }
  return { id, name, email, role };
}

const ownerStays = (): Error => conflict("owner_stays", "The practice owner stays the owner.");

export async function changeStaffRole(staff: StaffView, body: JsonBody): Promise<StaffView> {
  const role = body["role"];
  if (!isOneOf(ASSIGNABLE, role)) throw invalid({ role: OPTIONS_COPY });
  if (staff.role === "owner") throw ownerStays();
  await pool.query("UPDATE people SET role = $2 WHERE id = $1", [staff.id, role]);
  return { ...staff, role };
}

// Removing a staff member's row ends their sessions with it.
export async function removeStaff(staff: StaffView): Promise<void> {
  if (staff.role === "owner") throw ownerStays();
  await pool.query("DELETE FROM people WHERE id = $1", [staff.id]);
}
