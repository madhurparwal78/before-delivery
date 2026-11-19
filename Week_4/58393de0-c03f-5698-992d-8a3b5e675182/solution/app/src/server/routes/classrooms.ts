import { randomInt, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { copy } from "../../shared/copy";
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from "../../shared/limits";
import { isTimeZone, isValidName, isValidNickname, nicknameKey, normalizeNickname } from "../../shared/rules";
import type { Account, ClassroomExport, ExportRecord } from "../../shared/types";
import { ACCOUNT_COLUMNS, requirePrincipal } from "../auth";
import { classroomState } from "../classroom-state";
import { publishClassroomState } from "../classroom-events";
import { serverNow } from "../clock";
import {
  classroomAccess, classroomAudiences, classroomViews, CLASSROOM_COLUMNS, educatorAudience, findClassroom, isEducatorOf, lockClassroom,
  type ClassroomRow,
} from "../classrooms-store";
import { resolveTimes } from "../classroom-times";
import { first, isUniqueViolation, pool, rows, withTransaction } from "../db";
import { ApiError, validationError } from "../errors";
import type { Reply, Request, Route } from "../http-types";
import { bodyText } from "../input";
import { exportView, type ExportRow, EXPORT_COLUMNS } from "../exports-store";
import { purgeObjects } from "../storage-cleanup";
import { endAccountStreams, publish } from "../stream-hub";
import { instantToLocalWire } from "../zone";

function newJoinCode(): string {
  return Array.from({ length: JOIN_CODE_LENGTH }, () => JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)]).join("");
}

async function viewFor(classroom: ClassroomRow, viewerId: string): Promise<Reply> {
  const [view] = await classroomViews([classroom], viewerId);
  return { status: 200, body: view };
}

/**
 * Decides and writes under the classroom's row lock: `change` sees the row as it is now and nothing else can move it until
 * the transaction commits, so a refusal and the write it guards never straddle a concurrent hand-in, archive or rename.
 * Answers with the row as written.
 */
async function changeClassroom(id: string, change: (client: PoolClient, locked: ClassroomRow) => Promise<void>): Promise<ClassroomRow> {
  return withTransaction(async (client) => {
    const locked = await lockClassroom(client, id);
    if (!locked) throw new ApiError("not_found");
    await change(client, locked);
    const changed = await findClassroom(id, client);
    if (!changed) throw new ApiError("not_found");
    return changed;
  });
}

/** Everything a classroom route needs before it acts: the signed-in educator's reach into the classroom, 404 and 403 first. */
async function educatorIn(req: Request, ownerOnly = false) {
  const { account } = await requirePrincipal(req);
  const access = await classroomAccess(account, req.param("id"));
  if (ownerOnly && access.role !== "owner") throw new ApiError("forbidden");
  return { account, ...access };
}

const list: Route = {
  method: "GET",
  pattern: "/api/classrooms",
  async handler(req) {
    const { account } = await requirePrincipal(req);
    if (account.kind !== "educator") throw new ApiError("forbidden");
    const classrooms = await rows<ClassroomRow>(pool,
      `SELECT ${CLASSROOM_COLUMNS} FROM classrooms c WHERE ${isEducatorOf("c.id", "$1")} ORDER BY c.created_at DESC, c.id`, [account.id]);
    return { status: 200, body: { classrooms: await classroomViews(classrooms, account.id) } };
  },
};

const create: Route = {
  method: "POST",
  pattern: "/api/classrooms",
  async handler(req) {
    const { account } = await requirePrincipal(req);
    if (account.kind !== "educator") throw new ApiError("forbidden");
    if (!account.emailVerified) throw new ApiError("email_unverified", { message: copy.unverifiedClassroom });
    const body = req.jsonObject();
    const name = bodyText(body.name).trim();
    const timeZone = bodyText(body.timeZone);

    const fields: Record<string, string> = {};
    if (!isValidName(name)) fields.name = copy.nameInvalid;
    if (!isTimeZone(timeZone)) fields.timeZone = copy.timeZoneInvalid;
    const times = resolveTimes(timeZone, body, serverNow(), fields);

    const id = randomUUID();
    for (;;) {
      try {
        await pool.query(
          `INSERT INTO classrooms (id, owner_id, name, time_zone, join_code, join_opens_local, join_closes_local, hand_in_local,
             join_opens_at, join_closes_at, hand_in_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [id, account.id, name, timeZone, newJoinCode(), times.joinOpensLocal, times.joinClosesLocal, times.handInLocal,
            times.joinOpensAt, times.joinClosesAt, times.handInAt, serverNow()]);
        break;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    const created = await findClassroom(id);
    if (!created) throw new ApiError("not_found");
    return { ...(await viewFor(created, account.id)), status: 201 };
  },
};

const get: Route = {
  method: "GET",
  pattern: "/api/classrooms/:id",
  async handler(req) {
    const { account, classroom } = await educatorIn(req);
    return viewFor(classroom, account.id);
  },
};

const editTimes: Route = {
  method: "PATCH",
  pattern: "/api/classrooms/:id",
  async handler(req) {
    const { account, classroom } = await educatorIn(req, true);
    const updated = await changeClassroom(classroom.id, async (client, locked) => {
      const now = serverNow();
      const state = classroomState(locked, now);
      if (state === "handed_in") throw new ApiError("classroom_handed_in");
      if (state === "archived") throw new ApiError("classroom_archived");
      const times = resolveTimes(locked.timeZone, req.jsonObject(), now, {}, locked);
      await client.query(
        `UPDATE classrooms SET join_opens_local = $2, join_closes_local = $3, hand_in_local = $4,
           join_opens_at = $5, join_closes_at = $6, hand_in_at = $7 WHERE id = $1`,
        [locked.id, times.joinOpensLocal, times.joinClosesLocal, times.handInLocal, times.joinOpensAt, times.joinClosesAt, times.handInAt]);
    });
    await publishClassroomState(updated);
    return viewFor(updated, account.id);
  },
};

const rotateCode: Route = {
  method: "POST",
  pattern: "/api/classrooms/:id/join-code",
  async handler(req) {
    const { classroom } = await educatorIn(req);
    for (;;) {
      const joinCode = newJoinCode();
      try {
        await changeClassroom(classroom.id, async (client, locked) => {
          if (classroomState(locked, serverNow()) === "archived") throw new ApiError("classroom_archived");
          await client.query("UPDATE classrooms SET join_code = $2 WHERE id = $1", [locked.id, joinCode]);
        });
        return { status: 200, body: { joinCode } };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
  },
};

const handIn: Route = {
  method: "POST",
  pattern: "/api/classrooms/:id/hand-in",
  async handler(req) {
    const { account, classroom } = await educatorIn(req);
    const updated = await changeClassroom(classroom.id, async (client, locked) => {
      const now = serverNow();
      const state = classroomState(locked, now);
      if (state === "archived") throw new ApiError("classroom_archived");
      if (state === "handed_in") throw new ApiError("classroom_handed_in");
      if (state === "draft") throw new ApiError("classroom_not_started");
      await client.query("UPDATE classrooms SET hand_in_at = $2, hand_in_local = $3 WHERE id = $1",
        [locked.id, now, instantToLocalWire(now, locked.timeZone)]);
    });
    await publishClassroomState(updated);
    return viewFor(updated, account.id);
  },
};

const archive: Route = {
  method: "POST",
  pattern: "/api/classrooms/:id/archive",
  async handler(req) {
    const { account, classroom } = await educatorIn(req, true);
    const updated = await changeClassroom(classroom.id, async (client, locked) => {
      const now = serverNow();
      const state = classroomState(locked, now);
      if (state === "archived") throw new ApiError("classroom_archived");
      if (state !== "handed_in") throw new ApiError("not_handed_in");
      await client.query("UPDATE classrooms SET archived_at = $2 WHERE id = $1", [locked.id, now]);
    });
    await publishClassroomState(updated);
    for (const studentId of (await classroomAudiences([classroom.id])).get(classroom.id)?.students ?? []) endAccountStreams(studentId);
    return viewFor(updated, account.id);
  },
};

async function studentIn(classroomId: string, studentId: string): Promise<{ id: string; nickname: string }> {
  const student = await first<{ id: string; nickname: string }>(pool,
    "SELECT id, nickname FROM accounts WHERE id = $1 AND kind = 'student' AND classroom_id = $2", [studentId, classroomId]);
  if (!student) throw new ApiError("not_found");
  return student;
}

const rename: Route = {
  method: "PATCH",
  pattern: "/api/classrooms/:id/students/:studentId",
  async handler(req) {
    const { classroom } = await educatorIn(req);
    const student = await studentIn(classroom.id, req.param("studentId"));
    const nickname = normalizeNickname(bodyText(req.jsonObject().nickname));
    await changeClassroom(classroom.id, async (client) => {
      const clash = await first(client,
        "SELECT 1 FROM accounts WHERE kind = 'student' AND classroom_id = $1 AND nickname_key = $2 AND id <> $3",
        [classroom.id, nicknameKey(nickname), student.id]);
      if (clash) throw new ApiError("nickname_taken");
      if (!isValidNickname(nickname)) throw validationError({ nickname: copy.nicknameInvalid });
      await client.query("UPDATE accounts SET nickname = $2, display_name = $2, nickname_key = $3 WHERE id = $1",
        [student.id, nickname, nicknameKey(nickname)]);
    });
    publish(await educatorAudience(classroom.id), "student-renamed", { classroomId: classroom.id, studentId: student.id, nickname });
    return { status: 200, body: { id: student.id, nickname } };
  },
};

const removeStudent: Route = {
  method: "DELETE",
  pattern: "/api/classrooms/:id/students/:studentId",
  async handler(req) {
    const { classroom } = await educatorIn(req);
    const student = await studentIn(classroom.id, req.param("studentId"));
    const message = copy.removed(classroom.name);
    const objectKeys = await withTransaction(async (client) => {
      const stored = await rows<{ objectKey: string }>(client,
        `SELECT r.object_key AS "objectKey" FROM revisions r JOIN projects p ON p.id = r.project_id WHERE p.owner_id = $1
         UNION ALL SELECT object_key FROM exports WHERE owner_id = $1`, [student.id]);
      const keys = stored.map((row) => row.objectKey);
      await client.query("INSERT INTO orphaned_objects (object_key) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING", [keys]);
      await client.query("UPDATE sessions SET removed_message = $2 WHERE account_id = $1", [student.id, message]);
      await client.query("DELETE FROM accounts WHERE id = $1", [student.id]);
      return keys;
    });
    endAccountStreams(student.id, { classroomId: classroom.id, message });
    publish(await educatorAudience(classroom.id), "student-removed",
      { classroomId: classroom.id, studentId: student.id, nickname: student.nickname });
    await purgeObjects(objectKeys);
    return { status: 204 };
  },
};

const addAssistant: Route = {
  method: "POST",
  pattern: "/api/classrooms/:id/educators",
  async handler(req) {
    const { classroom } = await educatorIn(req, true);
    const email = bodyText(req.jsonObject().email).trim();
    const educator = await first<Account & { email: string }>(pool,
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts a WHERE lower(a.email) = lower($1) AND a.kind = 'educator' AND a.email_verified`, [email]);
    if (!educator) throw new ApiError("no_such_educator");
    if (educator.id === classroom.ownerId) throw new ApiError("already_added");
    try {
      await pool.query("INSERT INTO classroom_educators (classroom_id, educator_id, added_at) VALUES ($1, $2, $3)",
        [classroom.id, educator.id, serverNow()]);
    } catch (error) {
      throw isUniqueViolation(error) ? new ApiError("already_added") : error;
    }
    return { status: 201, body: { id: educator.id, displayName: educator.displayName, email: educator.email, role: "assistant" } };
  },
};

const removeAssistant: Route = {
  method: "DELETE",
  pattern: "/api/classrooms/:id/educators/:educatorId",
  async handler(req) {
    const { classroom } = await educatorIn(req, true);
    const educatorId = req.param("educatorId");
    if (educatorId === classroom.ownerId) throw new ApiError("owner_cannot_leave");
    const removed = await first(pool,
      "DELETE FROM classroom_educators WHERE classroom_id = $1 AND educator_id = $2 RETURNING educator_id", [classroom.id, educatorId]);
    if (!removed) throw new ApiError("not_found");
    endAccountStreams(educatorId, { classroomId: classroom.id, message: copy.removed(classroom.name) });
    return { status: 204 };
  },
};

const handInFiles: Route = {
  method: "GET",
  pattern: "/api/classrooms/:id/exports",
  async handler(req) {
    const { classroom } = await educatorIn(req);
    const found = await rows<ExportRow & { nickname: string }>(pool,
      `SELECT ${EXPORT_COLUMNS}, a.nickname FROM exports e JOIN accounts a ON a.id = e.owner_id
       WHERE a.kind = 'student' AND a.classroom_id = $1 ORDER BY e.created_at, e.id`, [classroom.id]);
    const exports: ClassroomExport[] = found.map((row): ClassroomExport => ({ ...(exportView(row) satisfies ExportRecord), nickname: row.nickname }));
    return { status: 200, body: { exports } };
  },
};

export const classroomRoutes: Route[] = [
  list, create, get, editTimes, rotateCode, handIn, archive, rename, removeStudent, addAssistant, removeAssistant, handInFiles,
];
