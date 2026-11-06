// Client flags on delivered lines, and the single staff reply, each emailed once.
import { config } from "./config.js";
import { one, only, pool, rows, tx } from "./db.js";
import { conflict, forbidden, invalid, isRecord, isString, notFound } from "./http.js";
import { queueMail, staff } from "./mail.js";
import { missionFor } from "./missions.js";
import { newId } from "./passwords.js";
import type { FlagView, LineRecord, UserRecord } from "./records.js";

const FLAG_SELECT = `SELECT f.*, m.name AS mission_name, o.name AS client_name FROM flags f
  JOIN missions m ON m.id = f.mission_id JOIN client_orgs o ON o.id = m.client_org_id`;

function flagJson(f: FlagView): Record<string, unknown> {
  return {
    id: f.id,
    line_label: f.line_label,
    comment: f.comment,
    by: f.by_name,
    at: f.at.toISOString(),
    state: f.state,
    reply: f.reply_text === null ? null : { text: f.reply_text, by: f.reply_by, at: f.reply_at.toISOString() },
    mission_id: f.mission_id,
    mission_name: f.mission_name,
    client_name: f.client_name,
  };
}

function text(raw: unknown, key: string): string {
  return isRecord(raw) && isString(raw[key]) ? (raw[key] as string) : "";
}

export async function flagLine(user: UserRecord, missionId: string, lineId: string, raw: unknown): Promise<Record<string, unknown>> {
  return tx(async (db) => {
    const m = await missionFor(db, user, missionId);
    const line = await one<LineRecord>(db, "SELECT * FROM lines WHERE id = $1 AND mission_id = $2", [lineId, m.id]);
    if (!line) throw notFound();
    if (user.role !== "client_reviewer") throw forbidden();
    if (line.status !== "Delivered") throw conflict("line_not_delivered", `${line.label} has not been delivered yet.`);
    const comment = text(raw, "comment");
    if (comment.trim().length < 1 || comment.trim().length > 500) throw invalid({ comment: "Write a comment of 1 to 500 characters" });
    const id = newId("f");
    await db.query("INSERT INTO flags (id, mission_id, line_id, line_label, comment, by_user_id, by_name, at, state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Open')",
      [id, m.id, line.id, line.label, comment, user.id, user.name, new Date()]);
    const org = await only<{ name: string }>(db, "SELECT name FROM client_orgs WHERE id = $1", [m.client_org_id]);
    for (const s of await staff(db, false)) {
      await queueMail(db, "flag", id, `flag:${id}:${s.id}`, s, `${org.name} flagged ${line.label} on ${m.name}`,
        [`${user.name} of ${org.name} flagged ${line.label} on ${m.name}:`, comment, `Reply from the flags list: ${config.publicUrl}/flags`]);
    }
    return flagJson(await only<FlagView>(db, `${FLAG_SELECT} WHERE f.id = $1`, [id]));
  });
}

export async function listFlags(state: string | null): Promise<Record<string, unknown>[]> {
  const found = await rows<FlagView>(pool, `${FLAG_SELECT} ${state === "all" ? "" : "WHERE f.state = 'Open'"} ORDER BY f.at DESC, f.seq DESC`);
  return found.map(flagJson);
}

export async function replyToFlag(user: UserRecord, flagId: string, raw: unknown): Promise<Record<string, unknown>> {
  return tx(async (db) => {
    const f = await one<FlagView>(db, `${FLAG_SELECT} WHERE f.id = $1 FOR UPDATE OF f`, [flagId]);
    if (!f) throw notFound();
    if (user.role === "client_reviewer") throw forbidden();
    if (f.state === "Answered") throw conflict("flag_answered", "This flag already has a reply.");
    const reply = text(raw, "text");
    if (reply.trim().length < 1 || reply.length > 500) throw invalid({ text: "Write a reply of 1 to 500 characters" });
    await db.query("UPDATE flags SET state = 'Answered', reply_text = $2, reply_by = $3, reply_at = $4 WHERE id = $1", [f.id, reply, user.name, new Date()]);
    const reviewer = await only<UserRecord>(db, "SELECT * FROM users WHERE id = $1", [f.by_user_id]);
    await queueMail(db, "reply", f.id, `reply:${f.id}`, reviewer, `Reply on ${f.line_label} for ${f.mission_name}`,
      [`${user.name} replied to your flag on ${f.line_label} for ${f.mission_name}:`, reply, `Open the survey: ${config.publicUrl}/surveys/${f.mission_id}`]);
    return flagJson(await only<FlagView>(db, `${FLAG_SELECT} WHERE f.id = $1`, [f.id]));
  });
}
