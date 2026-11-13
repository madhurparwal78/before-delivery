import { FIELD_ERRORS } from "../shared/copy";
import type { Member } from "../shared/types";
import { one, pool } from "./db";
import { invalid, notFound } from "./errors";
import { hub } from "./live";
import { membersOf } from "./projects";

type Assignable = "editor" | "commenter";
const ASSIGNABLE: readonly Assignable[] = ["editor", "commenter"];

function assignableRole(raw: unknown): Assignable {
  const role = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["role"] : undefined;
  const found = ASSIGNABLE.find((candidate) => candidate === role);
  if (!found) throw invalid({ role: FIELD_ERRORS.other });
  return found;
}

async function memberOf(projectId: string, personId: string): Promise<Member> {
  const member = (await membersOf(pool, projectId)).find((candidate) => candidate.person.id === personId);
  if (!member) throw notFound();
  return member;
}

export async function addMember(projectId: string, raw: unknown): Promise<Member> {
  const email = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["email"] : undefined;
  const role = assignableRole(raw);
  const person = typeof email === "string" ? await one<{ id: string }>("SELECT id FROM people WHERE lower(email) = lower($1)", [email.trim()]) : undefined;
  if (!person) throw invalid({ email: FIELD_ERRORS.email });
  const added = await one("INSERT INTO members (project_id, person_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING person_id", [projectId, person.id, role]);
  if (!added) throw invalid({ email: FIELD_ERRORS.other });
  return memberOf(projectId, person.id);
}

export async function changeRole(projectId: string, personId: string, raw: unknown): Promise<Member> {
  const role = assignableRole(raw);
  const changed = await one("UPDATE members SET role = $3 WHERE project_id = $1 AND person_id = $2 AND role <> 'owner' RETURNING person_id", [projectId, personId, role]);
  if (!changed) throw notFound();
  hub.roleChanged(projectId, personId, role);
  return memberOf(projectId, personId);
}

export async function removeMember(projectId: string, personId: string): Promise<void> {
  const removed = await one("DELETE FROM members WHERE project_id = $1 AND person_id = $2 AND role <> 'owner' RETURNING person_id", [projectId, personId]);
  if (!removed) throw notFound();
  hub.roleChanged(projectId, personId, null);
}
