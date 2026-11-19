import { randomUUID } from "node:crypto";
import { copy } from "../../shared/copy";
import { CLASSROOM_MAX_STUDENTS } from "../../shared/limits";
import { isValidNickname, nicknameKey, normalizeJoinCode, normalizeNickname } from "../../shared/rules";
import type { Account } from "../../shared/types";
import { identify, removedError, requirePrincipal, SESSION_COOKIE, startSession } from "../auth";
import { classroomState } from "../classroom-state";
import { serverNow } from "../clock";
import { config } from "../config";
import { first, pool, rows, withTransaction, type Queryable } from "../db";
import { ApiError, validationError } from "../errors";
import type { Route } from "../http-types";
import { bodyText } from "../input";
import { CLASSROOM_COLUMNS, educatorAudience, findClassroom, lockClassroom, studentClassroomView, type ClassroomRow } from "../classrooms-store";
import { publish } from "../stream-hub";

const ATTEMPT_WINDOW_MS = 60_000;

async function studentCount(db: Queryable, classroomId: string): Promise<number> {
  const row = await first<{ n: number }>(db, "SELECT count(*)::int AS n FROM accounts WHERE kind = 'student' AND classroom_id = $1", [classroomId]);
  return row?.n ?? 0;
}

/** Failed code attempts are counted per client address in real time, so the grading clock cannot reset or extend the window. */
async function assertUnderRateLimit(ip: string): Promise<void> {
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MS);
  await pool.query("DELETE FROM join_attempts WHERE attempted_at < $1", [since]);
  const attempts = await rows<{ attemptedAt: Date }>(pool,
    `SELECT attempted_at AS "attemptedAt" FROM join_attempts WHERE client_ip = $1 ORDER BY attempted_at LIMIT $2`, [ip, config.joinRateLimit]);
  const oldest = attempts[0];
  if (attempts.length >= config.joinRateLimit && oldest) {
    const waitMs = oldest.attemptedAt.getTime() + ATTEMPT_WINDOW_MS - Date.now();
    throw new ApiError("too_many_attempts", { retryAfterSeconds: Math.min(60, Math.max(1, Math.ceil(waitMs / 1000))) });
  }
}

async function failAttempt(ip: string, error: ApiError): Promise<never> {
  await pool.query("INSERT INTO join_attempts (client_ip, attempted_at) VALUES ($1, now())", [ip]);
  throw error;
}

const joinCode: Route = {
  method: "POST",
  pattern: "/api/join/code",
  withoutSession: true,
  async handler(req) {
    await assertUnderRateLimit(req.ip);
    const typed = req.jsonObject().code;
    const code = normalizeJoinCode(bodyText(typed));
    const classroom = await first<ClassroomRow>(pool,
      `SELECT ${CLASSROOM_COLUMNS} FROM classrooms c WHERE c.join_code = $1 AND c.archived_at IS NULL`, [code]);
    if (!classroom) return failAttempt(req.ip, new ApiError("unknown_code"));
    if (classroomState(classroom, serverNow()) !== "open") return failAttempt(req.ip, new ApiError("join_closed"));
    if (await studentCount(pool, classroom.id) >= CLASSROOM_MAX_STUDENTS) return failAttempt(req.ip, new ApiError("classroom_full"));
    const cookie = await startSession(req, { pendingClassroomId: classroom.id });
    return { status: 200, body: { classroom: { name: classroom.name } }, headers: { "Set-Cookie": cookie } };
  },
};

const joinNickname: Route = {
  method: "POST",
  pattern: "/api/join/nickname",
  withoutSession: true,
  async handler(req) {
    const identity = await identify(req.cookie(SESSION_COOKIE));
    if (identity.kind === "ended") throw removedError(identity);
    if (identity.kind !== "pending") throw new ApiError("signed_out");
    const typed = req.jsonObject().nickname;
    const nickname = normalizeNickname(bodyText(typed));

    const { account, cookie } = await withTransaction(async (client) => {
      const classroom = await lockClassroom(client, identity.classroomId);
      if (!classroom || classroomState(classroom, serverNow()) !== "open") throw new ApiError("join_closed");
      const taken = await first(client,
        "SELECT 1 FROM accounts WHERE kind = 'student' AND classroom_id = $1 AND nickname_key = $2", [classroom.id, nicknameKey(nickname)]);
      if (taken) throw new ApiError("nickname_taken");
      if (await studentCount(client, classroom.id) >= CLASSROOM_MAX_STUDENTS) throw new ApiError("classroom_full");
      if (!isValidNickname(nickname)) throw validationError({ nickname: copy.nicknameInvalid });
      const student: Account = {
        id: randomUUID(), kind: "student", displayName: nickname, email: null, emailVerified: true, classroomId: classroom.id, nickname,
      };
      await client.query(
        `INSERT INTO accounts (id, kind, display_name, email_verified, classroom_id, nickname, nickname_key, created_at)
         VALUES ($1, 'student', $2, true, $3, $2, $4, $5)`, [student.id, nickname, classroom.id, nicknameKey(nickname), serverNow()]);
      return { account: student, cookie: await startSession(req, { accountId: student.id }, client) };
    });

    publish(await educatorAudience(identity.classroomId), "student-joined",
      { classroomId: identity.classroomId, student: { id: account.id, nickname } });
    return { status: 201, body: { account }, headers: { "Set-Cookie": cookie } };
  },
};

const classView: Route = {
  method: "GET",
  pattern: "/api/class",
  async handler(req) {
    const { account } = await requirePrincipal(req);
    const classroom = account.kind === "student" && account.classroomId ? await findClassroom(account.classroomId) : null;
    if (!classroom) throw new ApiError("forbidden");
    return { status: 200, body: studentClassroomView(classroom) };
  },
};

export const joinRoutes: Route[] = [joinCode, joinNickname, classView];
