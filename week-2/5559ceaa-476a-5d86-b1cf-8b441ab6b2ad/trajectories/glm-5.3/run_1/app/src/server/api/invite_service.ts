import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "../errors.js";
import type { Config } from "../config.js";
import type { Mailer } from "../mailer.js";
import type { User } from "../../shared/types.js";
import { audit } from "./helpers.js";
import { hashToken } from "../auth.js";

interface PoolLike {
  connect(): Promise<PoolClient>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
}

export class InviteService {
  constructor(
    private pool: PoolLike,
    private mailer: Mailer,
    private cfg: Config,
  ) {}

  async createInvite(
    project: { id: string; title: string; kind: string; owner_id: string },
    mentor: User,
    email: string,
    name: string,
  ): Promise<{ invite: Record<string, unknown>; member: Record<string, unknown> }> {
    const seats = project.kind === "one_to_one" ? 1 : 6;
    const client = await this.pool.connect();
    let userId = "";
    let token = "";
    try {
      await client.query("BEGIN");
      const existingUser = await client.query(`SELECT id, name FROM users WHERE email = $1`, [email]);
      let alreadyMember = false;
      if (existingUser.rowCount === 0) {
        userId = crypto.randomUUID();
        await client.query(
          `INSERT INTO users (id, email, name, kind) VALUES ($1,$2,$3,'learner')`,
          [userId, email, name],
        );
      } else {
        userId = existingUser.rows[0]["id"] as string;
        const memberRow = await client.query(
          `SELECT 1 FROM memberships WHERE project_id = $1 AND user_id = $2`,
          [project.id, userId],
        );
        alreadyMember = (memberRow.rowCount ?? 0) > 0;
      }
      if (!alreadyMember) {
        const count = await client.query(
          `SELECT count(*) AS n FROM memberships WHERE project_id = $1 AND role = 'student'`,
          [project.id],
        );
        const n = Number(count.rows[0]["n"]);
        if (n >= seats) {
          throw new ApiError(
            seats === 1 ? "seat_taken" : "group_full",
            seats === 1
              ? "This one-to-one project already has a learner. Remove them first."
              : "This group already has six learners.",
          );
        }
        await client.query(
          `INSERT INTO memberships (project_id, user_id, role) VALUES ($1,$2,'student')`,
          [project.id, userId],
        );
      }
      // Each invite email has its own sign-in token.
      token = randomBytes(32).toString("base64url");
      await client.query(
        `INSERT INTO auth_tokens (token_hash, email, purpose, project_id, expires_at)
         VALUES ($1,$2,'invite',$3,$4)`,
        [hashToken(token), email, project.id, new Date(Date.now() + this.cfg.magicLinkTtlSeconds * 1000)],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    // Exactly one message is sent per request, before the server answers.
    const subject = `${mentor.name} invited you to ${project.title}`;
    const body = [
      `${mentor.name} has invited you to a Relay Bench project.`,
      "",
      `${this.cfg.appPublicUrl}/auth/verify?token=${token}`,
      "",
      "The link works once and expires soon.",
    ].join("\n");
    const emailStatus = await this.mailer.sendOrQueue(this.pool, email, subject, body);
    await this.pool.query(
      `INSERT INTO invite_email_status (project_id, user_id, email, status) VALUES ($1,$2,$3,$4)
       ON CONFLICT (project_id, user_id) DO UPDATE SET status = $4, updated_at = now()`,
      [project.id, userId, email, emailStatus],
    );
    const memberRow = await this.pool.query(
      `SELECT m.user_id, m.role, u.name FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.project_id = $1 AND m.user_id = $2`,
      [project.id, userId],
    );
    const m = memberRow.rows[0];
    if (!m) throw new ApiError("not_found", "No such member.");
    return {
      invite: { id: crypto.randomUUID(), email, name, email_status: emailStatus },
      member: {
        user_id: m["user_id"],
        name: m["name"],
        role: m["role"],
        online: false,
        email_status: emailStatus,
      },
    };
  }
}

export class RemovalService {
  constructor(
    private pool: PoolLike,
    private bus: { closeSockets(projectId: string, userId: string, code: number, reason: string): void; publish(projectId: string, frame: Record<string, unknown>): void },
  ) {}

  async removeMember(
    project: { id: string; owner_id: string },
    targetId: string,
    actor: User,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM memberships WHERE project_id = $1 AND user_id = $2`,
        [project.id, targetId],
      );
      await client.query(
        `DELETE FROM invite_email_status WHERE project_id = $1 AND user_id = $2`,
        [project.id, targetId],
      );
      // If they held the baton, the driver becomes the mentor.
      const live = await client.query(
        `SELECT id FROM sessions WHERE project_id = $1 AND state = 'live' AND driver_id = $2`,
        [project.id, targetId],
      );
      if (live.rowCount && (live.rowCount as number) > 0) {
        const sessionId = live.rows[0]["id"] as string;
        const versionRow = await client.query(`SELECT version FROM sessions WHERE id = $1`, [sessionId]);
        await client.query(
          `UPDATE sessions SET driver_id = $1, version = $2 WHERE id = $3`,
          [project.owner_id, (versionRow.rows[0]["version"] as number) + 1, sessionId],
        );
      }
      await audit(client, project.id, "member_removed", actor, JSON.stringify({ user_id: targetId }));
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    // Notify the learner and close their sockets within one second.
    this.bus.closeSockets(project.id, targetId, 4403, "removed");
    const sessionRow = await this.pool.query(
      `SELECT id, project_id, title, state, scheduled_for, driver_id, version FROM sessions
       WHERE project_id = $1 AND state = 'live'`,
      [project.id],
    );
    if (sessionRow.rowCount && (sessionRow.rowCount as number) > 0) {
      const s = sessionRow.rows[0];
      if (s) {
        this.bus.publish(project.id, {
          type: "session",
          session: {
            id: s["id"],
            project_id: s["project_id"],
            title: s["title"],
            state: s["state"],
            scheduled_for: (s["scheduled_for"] as Date).toISOString(),
            driver_id: s["driver_id"],
            version: s["version"],
          },
        });
      }
    }
  }
}
