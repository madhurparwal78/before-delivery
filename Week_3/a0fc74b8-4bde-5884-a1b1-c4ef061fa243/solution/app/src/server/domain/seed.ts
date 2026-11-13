import { pool, tx } from "../db.js";
import { ApiError, validation } from "../errors.js";
import { buildSample, isSampleName } from "../pdf/samples.js";
import { inspectPdf } from "../pdf/inspect.js";
import { putObject } from "../storage.js";
import { hashPassword, newId, sha256Hex } from "../util.js";
import type { Role } from "../../shared/types.js";
import { type Actor } from "./permissions.js";
import { addField, addRecipient, createDraft } from "./drafts.js";
import { type FieldRow, type UserRow, fieldsOf, lockDocument, recipientsOf } from "./rows.js";
import { asBody, timeZoneProblem, type Body } from "./validate.js";
import { declineDocument, runEffects, sendDocument, signRecipient, voidDocument } from "./workflow.js";

const ROLES: Role[] = ["owner", "member", "viewer"];

interface MemberSpec {
  email: string;
  name: string;
  password: string;
  role: Role;
}

interface TeamSpec {
  name: string;
  members: MemberSpec[];
}

function invalid(): ApiError {
  return validation({ body: "The setup request is not valid." });
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw invalid();
  return value;
}

function member(value: unknown): MemberSpec {
  const body = asBody(value);
  const role = body["role"];
  if (typeof role !== "string" || !ROLES.includes(role as Role)) throw invalid();
  return { email: text(body["email"]).trim().toLowerCase(), name: text(body["name"]), password: text(body["password"]), role: role as Role };
}

function team(value: unknown): TeamSpec {
  const body = asBody(value);
  const members = body["members"];
  if (!Array.isArray(members)) throw invalid();
  return { name: text(body["name"]), members: members.map(member) };
}

async function createTeams(specs: TeamSpec[]): Promise<{ teams: { name: string; id: string }[]; users: UserRow[] }> {
  const emails = specs.flatMap((t) => t.members.map((m) => m.email));
  if (new Set(emails).size !== emails.length) throw new ApiError(409, { error: "email_taken" });
  const { rows: taken } = await pool.query("SELECT 1 FROM users WHERE email = ANY($1::text[]) LIMIT 1", [emails]);
  if (taken.length > 0) throw new ApiError(409, { error: "email_taken" });
  const hashes = await Promise.all(specs.flatMap((t) => t.members).map((m) => hashPassword(m.password)));
  const created = await tx(async (client) => {
    const teams: { name: string; id: string }[] = [];
    const users: UserRow[] = [];
    let index = 0;
    for (const spec of specs) {
      const teamId = newId();
      await client.query("INSERT INTO teams (id, name) VALUES ($1, $2)", [teamId, spec.name]);
      teams.push({ name: spec.name, id: teamId });
      for (const m of spec.members) {
        const user: UserRow = { id: newId(), team_id: teamId, email: m.email, name: m.name, password_hash: hashes[index] ?? "", role: m.role };
        index += 1;
        await client.query("INSERT INTO users (id, team_id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)", [
          user.id,
          user.team_id,
          user.email,
          user.name,
          user.password_hash,
          user.role,
        ]);
        users.push(user);
      }
    }
    return { teams, users };
  });
  return created;
}

function actorOf(user: UserRow): Actor {
  return { id: user.id, teamId: user.team_id, email: user.email, name: user.name, role: user.role };
}

function sampleValue(field: FieldRow, name: string): string | null {
  if (field.kind === "signature" || field.kind === "initials") return `typed:${name}`;
  if (field.kind === "text" && field.required) return name;
  return null;
}

async function signNext(documentId: string, teamId: string): Promise<void> {
  const effects = await tx(async (client) => {
    const document = await lockDocument(client, documentId, teamId);
    const recipients = await recipientsOf(client, documentId);
    const current = recipients.find((r) => r.signing_order === document.current_order);
    if (!current) throw invalid();
    for (const field of await fieldsOf(client, documentId)) {
      const value = field.recipient_id === current.id ? sampleValue(field, current.name) : null;
      if (value !== null) await client.query("UPDATE fields SET value = $2 WHERE id = $1", [field.id, value]);
    }
    return signRecipient(client, document, current);
  });
  await runEffects(effects);
}

async function seedDocument(spec: Body, teams: Map<string, string>, users: Map<string, UserRow>): Promise<{ title: string; id: string }> {
  const title = text(spec["title"]);
  const teamId = teams.get(text(spec["team"]));
  const owner = users.get(text(spec["owner"]).trim().toLowerCase());
  const sample = spec["sample"];
  if (!teamId || !owner || owner.team_id !== teamId || typeof sample !== "string" || !isSampleName(sample)) throw invalid();
  const timeZone = spec["timeZone"] ?? "UTC";
  if (timeZoneProblem(timeZone)) throw invalid();
  const state = spec["state"] ?? "draft";
  const signedCount = typeof spec["signed"] === "number" ? spec["signed"] : 0;
  const people = Array.isArray(spec["recipients"]) ? (spec["recipients"] as unknown[]) : [];
  const fieldSpecs = Array.isArray(spec["fields"]) ? (spec["fields"] as unknown[]) : [];
  const bytes = buildSample(sample);
  const inspected = inspectPdf(bytes);
  const actor = actorOf(owner);
  const document = await tx(async (client) => {
    const draft = await createDraft(client, {
      teamId,
      owner,
      title,
      originalSha256: sha256Hex(bytes),
      pageCount: inspected.pageCount,
      pageSizes: inspected.pageSizes,
      timeZone: String(timeZone),
      storeOriginal: (key) => putObject(key, bytes),
    });
    const recipientIds: string[] = [];
    for (const person of people) recipientIds.push((await addRecipient(client, draft, asBody(person))).id);
    for (const entry of fieldSpecs) {
      const field = asBody(entry);
      const recipientId = typeof field["recipient"] === "number" ? recipientIds[field["recipient"] - 1] : undefined;
      if (!recipientId) throw invalid();
      await addField(client, draft, { ...field, recipientId });
    }
    return draft;
  });
  if (state === "draft") return { title, id: document.id };
  const sent = await tx(async (client) => sendDocument(client, await lockDocument(client, document.id, teamId), actor));
  await runEffects(sent);
  const total = people.length;
  const toSign = state === "completed" ? total : Math.min(signedCount, total);
  for (let k = 0; k < toSign; k += 1) await signNext(document.id, teamId);
  if (state === "declined") {
    const effects = await tx(async (client) => {
      const locked = await lockDocument(client, document.id, teamId);
      const current = (await recipientsOf(client, document.id)).find((r) => r.signing_order === locked.current_order);
      if (!current) throw invalid();
      return declineDocument(client, locked, current, "Seeded decline");
    });
    await runEffects(effects);
  }
  if (state === "voided") {
    const effects = await tx(async (client) => voidDocument(client, await lockDocument(client, document.id, teamId), actor, "Seeded void"));
    await runEffects(effects);
  }
  return { title, id: document.id };
}

export async function setupWorld(input: unknown): Promise<{
  teams: { name: string; id: string }[];
  users: { email: string; id: string }[];
  documents: { title: string; id: string }[];
}> {
  const body = asBody(input);
  const teamSpecs = body["teams"];
  const documentSpecs = body["documents"] ?? [];
  if (!Array.isArray(teamSpecs) || !Array.isArray(documentSpecs)) throw invalid();
  const { teams, users } = await createTeams(teamSpecs.map(team));
  const teamIds = new Map(teams.map((t) => [t.name, t.id]));
  const userByEmail = new Map(users.map((u) => [u.email, u]));
  const documents: { title: string; id: string }[] = [];
  for (const spec of documentSpecs) documents.push(await seedDocument(asBody(spec), teamIds, userByEmail));
  return { teams, users: users.map((u) => ({ email: u.email, id: u.id })), documents };
}
