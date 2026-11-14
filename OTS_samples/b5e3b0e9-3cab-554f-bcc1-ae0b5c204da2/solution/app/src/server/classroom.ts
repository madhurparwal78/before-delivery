import { config } from "./config.ts";
import { newId, pool, query, tx } from "./db.ts";
import { formErrors, inviteExpired, inviteUsed, invalidCredentials, mailUnavailable, notFound } from "./errors.ts";
import { reply, route, type Ctx } from "./http.ts";
import { MailError, sendMail } from "./mail.ts";
import {
  checkPassword,
  cleanName,
  hashPassword,
  hashToken,
  MIN_PASSWORD,
  newToken,
  normaliseEmail,
  requireInstructor,
  requireUser,
  startLogin,
  validEmail,
} from "./auth.ts";

/** A class the user may open: the instructor's own, or one a student has joined. */
async function classFor(ctx: Ctx, classId: string): Promise<{ id: string; name: string; schoolId: string; instructor: boolean }> {
  const user = await requireUser(ctx);
  const rows = await query<{ id: string; name: string; school_id: string; instructor: boolean; member: boolean }>(
    pool,
    `SELECT c.id, c.name, c.school_id, s.instructor_id = $2 AS instructor,
            EXISTS (SELECT 1 FROM class_members m WHERE m.class_id = c.id AND m.user_id = $2) AS member
       FROM classes c JOIN schools s ON s.id = c.school_id WHERE c.id = $1`,
    [classId, user.id],
  );
  const found = rows[0];
  if (!found || (!found.instructor && !found.member)) throw notFound();
  return { id: found.id, name: found.name, schoolId: found.school_id, instructor: found.instructor };
}

const isoDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

export async function addMember(classId: string, userId: string): Promise<void> {
  await query(pool, "INSERT INTO class_members (class_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [classId, userId]);
}

export function registerClassroomRoutes(): void {
  route("POST", "/api/classes", async (ctx) => {
    const { schoolId } = await requireInstructor(ctx);
    const body = await ctx.json();
    const name = cleanName(body.name);
    if (name === null) throw formErrors({ name: "Class name is required." });
    const id = newId();
    await query(pool, "INSERT INTO classes (id, school_id, name) VALUES ($1, $2, $3)", [id, schoolId, name]);
    return reply(201, { id, name });
  });

  route("GET", "/api/classes/:id", async (ctx) => {
    const cls = await classFor(ctx, ctx.params[0] ?? "");
    const students = await query<{ id: string; name: string; email: string }>(
      pool,
      "SELECT u.id, u.name, u.email FROM class_members m JOIN users u ON u.id = m.user_id WHERE m.class_id = $1 ORDER BY m.joined_at, u.id",
      [cls.id],
    );
    const assignments = await query<{ id: string; scenario_id: string; scenario: string; due_on: string; session_id: string | null }>(
      pool,
      `SELECT a.id, a.scenario_id, s.name AS scenario, a.due_on,
              (SELECT x.id FROM sessions x WHERE x.assignment_id = a.id AND x.status <> 'ended' ORDER BY x.created_at DESC, x.id LIMIT 1) AS session_id
         FROM assignments a JOIN scenarios s ON s.id = a.scenario_id WHERE a.class_id = $1 ORDER BY a.created_at, a.id`,
      [cls.id],
    );
    const invitations = cls.instructor
      ? await query<{ email: string; used: boolean }>(pool, "SELECT email, used_at IS NOT NULL AS used FROM invitations WHERE class_id = $1 ORDER BY sent_at, id", [cls.id])
      : [];
    return {
      id: cls.id,
      name: cls.name,
      students: students.map((s) => (cls.instructor ? s : { id: s.id, name: s.name })),
      assignments: assignments.map((a) => ({ id: a.id, scenarioId: a.scenario_id, scenario: a.scenario, dueOn: a.due_on, sessionId: a.session_id })),
      ...(cls.instructor ? { invitations: invitations.map((i) => ({ email: i.email, status: i.used ? "used" : "pending" })) } : {}),
    };
  });

  route("POST", "/api/classes/:id/invitations", async (ctx) => {
    const cls = await classFor(ctx, ctx.params[0] ?? "");
    if (!cls.instructor) throw notFound();
    const body = await ctx.json();
    const emails = Array.isArray(body.emails) ? body.emails.map(normaliseEmail).filter((e) => e !== "") : [];
    if (emails.length === 0) throw formErrors({ emails: "Enter at least one email address." });
    const bad = emails.find((e) => !validEmail(e));
    if (bad !== undefined) throw formErrors({ emails: `${bad} is not an email address.` });
    const sent: string[] = [];
    for (const email of [...new Set(emails)]) {
      const token = newToken();
      await query(pool, "INSERT INTO invitations (id, class_id, email, token_hash, sent_at) VALUES ($1, $2, $3, $4, now())", [newId(), cls.id, email, hashToken(token)]);
      try {
        await sendMail(email, `Join ${cls.name} on Runup Bay`, `You have been invited to join ${cls.name}. Open this link to join:\n\n${config.publicUrl}/invite/${token}\n`);
      } catch (error) {
        await query(pool, "DELETE FROM invitations WHERE token_hash = $1", [hashToken(token)]);
        if (error instanceof MailError) throw mailUnavailable();
        throw error;
      }
      sent.push(email);
    }
    return reply(201, { sent });
  });

  route("POST", "/api/classes/:id/assignments", async (ctx) => {
    const cls = await classFor(ctx, ctx.params[0] ?? "");
    if (!cls.instructor) throw notFound();
    const body = await ctx.json();
    if (typeof body.scenario === "string") {
      const owned = await query(pool, "SELECT 1 FROM scenarios WHERE id = $1 AND school_id = $2", [body.scenario, cls.schoolId]);
      if (owned.length === 0) throw notFound();
    }
    const errors: Record<string, string> = {};
    if (typeof body.scenario !== "string") errors.scenario = "Choose a scenario.";
    if (!isoDate(body.dueOn)) errors.dueOn = "Enter a date as YYYY-MM-DD.";
    if (Object.keys(errors).length > 0) throw formErrors(errors);
    const id = newId();
    await query(pool, "INSERT INTO assignments (id, class_id, scenario_id, due_on) VALUES ($1, $2, $3, $4)", [id, cls.id, body.scenario, body.dueOn]);
    return reply(201, { id });
  });

  route(
    "GET",
    "/api/invitations/:token",
    async (ctx) => {
      const invite = await openInvitation(ctx.params[0] ?? "");
      return { class: invite.className, email: invite.email };
    },
  );

  route(
    "POST",
    "/api/invitations/:token/accept",
    async (ctx) => {
      const invite = await openInvitation(ctx.params[0] ?? "");
      const body = await ctx.json();
      const password = typeof body.password === "string" ? body.password : "";
      const headers = await tx(async (client) => {
        // Claim the invitation first: a concurrent accept waits on this row and then finds it used.
        const claimed = await query(client, "UPDATE invitations SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id", [invite.id]);
        if (claimed.length === 0) throw inviteUsed();
        await query(client, "SELECT pg_advisory_xact_lock(hashtext($1))", [invite.email]);
        const existing = (
          await query<{ id: string; password_hash: string }>(client, "SELECT id, password_hash FROM users WHERE lower(email) = $1", [invite.email])
        )[0];
        let userId: string;
        if (existing) {
          if (!(await checkPassword(password, existing.password_hash))) throw invalidCredentials();
          userId = existing.id;
        } else {
          const errors: Record<string, string> = {};
          const name = cleanName(body.name);
          if (name === null) errors.name = "Name is required.";
          if (password.length < MIN_PASSWORD) errors.password = `Password must be at least ${MIN_PASSWORD} characters.`;
          if (Object.keys(errors).length > 0) throw formErrors(errors);
          userId = newId();
          await query(client, "INSERT INTO users (id, name, email, password_hash, verified) VALUES ($1, $2, $3, $4, true)", [
            userId,
            name,
            invite.email,
            await hashPassword(password),
          ]);
        }
        await query(client, "UPDATE users SET verified = true WHERE id = $1", [userId]);
        await query(client, "INSERT INTO class_members (class_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [invite.classId, userId]);
        return startLogin(client, userId);
      });
      return reply(200, { classId: invite.classId }, headers);
    },
  );
}

async function openInvitation(token: string): Promise<{ id: string; classId: string; className: string; email: string }> {
  const rows = await query<{ id: string; class_id: string; class_name: string; email: string; used: boolean; expired: boolean }>(
    pool,
    `SELECT i.id, i.class_id, c.name AS class_name, i.email, i.used_at IS NOT NULL AS used,
            i.sent_at < now() - interval '${config.inviteTtlHours} hours' AS expired
       FROM invitations i JOIN classes c ON c.id = i.class_id WHERE i.token_hash = $1`,
    [hashToken(token)],
  );
  const found = rows[0];
  if (!found) throw notFound();
  if (found.used) throw inviteUsed();
  if (found.expired) throw inviteExpired();
  return { id: found.id, classId: found.class_id, className: found.class_name, email: found.email };
}
