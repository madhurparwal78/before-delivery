import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "../errors.js";
import type { Storage } from "../storage.js";
import type { User, EmailStatus } from "../../shared/types.js";
import type { Config } from "../config.js";
import type { Mailer } from "../mailer.js";
import { audit } from "./helpers.js";
import { sha256Hex } from "../auth.js";

interface PoolLike {
  connect(): Promise<PoolClient>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
}

interface LinkRow {
  id: string;
  checkpoint_id: string;
  project_id: string;
  token: string;
  expires_at: Date;
  revoked_at: Date | null;
  email: string | null;
  email_status: string;
}

export class ReviewerLinkService {
  constructor(
    private pool: PoolLike,
    private storage: Storage,
    private mailer: Mailer,
  ) {}

  /** The single place link state is decided from the server's clock. */
  private linkState(row: { expires_at: Date; revoked_at: Date | null }): "active" | "expired" | "revoked" {
    if (row.revoked_at) return "revoked";
    if (row.expires_at.getTime() <= Date.now()) return "expired";
    return "active";
  }

  private linkOut(row: LinkRow, cfg: Config): Record<string, unknown> {
    return {
      id: row.id,
      checkpoint_id: row.checkpoint_id,
      url: `${cfg.appPublicUrl}/review/${row.token}`,
      expires_at: row.expires_at.toISOString(),
      state: this.linkState(row),
      email_status: row.email_status,
    };
  }

  async createLink(
    checkpointId: string,
    projectId: string,
    user: User,
    hours: number,
    email: string | null,
    cfg: Config,
  ): Promise<{ link: Record<string, unknown> }> {
    const id = crypto.randomUUID();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + hours * cfg.reviewerLinkHourSeconds * 1000);
    let emailStatus: EmailStatus = "none";
    if (email) {
      emailStatus = await this.mailer.sendOrQueue(
        this.pool,
        email,
        `A Relay Bench checkpoint to review: ${await this.checkpointName(checkpointId)}`,
        reviewEmailBodyFrom(`${cfg.appPublicUrl}/review/${token}`, expiresAt),
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO reviewer_links (id, checkpoint_id, project_id, token, expires_at, email, email_status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, checkpointId, projectId, token, expiresAt, email, emailStatus, user.id],
      );
      await audit(client, projectId, "reviewer_link_created", user, JSON.stringify({ link_id: id }));
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    const row = await this.getLink(id);
    return { link: this.linkOut(row, cfg) };
  }

  private async checkpointName(checkpointId: string): Promise<string> {
    const r = await this.pool.query(`SELECT name FROM checkpoints WHERE id = $1`, [checkpointId]);
    const row = r.rows[0];
    return (row?.["name"] as string) ?? "";
  }

  private async getLink(id: string): Promise<LinkRow> {
    const r = await this.pool.query(
      `SELECT id, checkpoint_id, project_id, token, expires_at, revoked_at, email, email_status
       FROM reviewer_links WHERE id = $1`,
      [id],
    );
    const row = r.rows[0];
    if (!row) throw new ApiError("not_found", "No such link.");
    return row as unknown as LinkRow;
  }

  async listLinks(checkpointId: string, cfg: Config): Promise<Record<string, unknown>[]> {
    const r = await this.pool.query(
      `SELECT id, checkpoint_id, project_id, token, expires_at, revoked_at, email, email_status
       FROM reviewer_links WHERE checkpoint_id = $1 ORDER BY created_at ASC`,
      [checkpointId],
    );
    return r.rows.map((row) => this.linkOut(row as unknown as LinkRow, cfg));
  }

  async linkProject(linkId: string): Promise<{ project_id: string } | null> {
    const r = await this.pool.query(`SELECT project_id FROM reviewer_links WHERE id = $1`, [linkId]);
    const row = r.rows[0];
    if (!row) return null;
    return { project_id: row["project_id"] as string };
  }

  async regenerate(linkId: string, user: User, cfg: Config): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    let row: LinkRow;
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `SELECT id, checkpoint_id, project_id, token, expires_at, revoked_at, email, email_status
         FROM reviewer_links WHERE id = $1 FOR UPDATE`,
        [linkId],
      );
      if (r.rowCount === 0) throw new ApiError("not_found", "No such link.");
      row = r.rows[0] as unknown as LinkRow;
      const state = this.linkState(row);
      if (state !== "active") {
        throw new ApiError("illegal_transition", "Only active links can be regenerated.", {
          from: state,
          to: "active",
        });
      }
      const newToken = randomBytes(32).toString("base64url");
      await client.query(`UPDATE reviewer_links SET token = $1 WHERE id = $2`, [newToken, linkId]);
      await audit(client, row.project_id, "reviewer_link_regenerated", user, JSON.stringify({ link_id: linkId }));
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    const fresh = await this.getLink(linkId);
    return this.linkOut(fresh, cfg);
  }

  async revoke(linkId: string, user: User, cfg: Config): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    let projectId = "";
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `SELECT id, checkpoint_id, project_id, token, expires_at, revoked_at, email, email_status
         FROM reviewer_links WHERE id = $1 FOR UPDATE`,
        [linkId],
      );
      if (r.rowCount === 0) throw new ApiError("not_found", "No such link.");
      const row = r.rows[0] as unknown as LinkRow;
      projectId = row.project_id;
      const state = this.linkState(row);
      if (state !== "active") {
        throw new ApiError("illegal_transition", "Only active links can be revoked.", {
          from: state,
          to: "revoked",
        });
      }
      await client.query(`UPDATE reviewer_links SET revoked_at = now() WHERE id = $1`, [linkId]);
      await audit(client, projectId, "reviewer_link_revoked", user, JSON.stringify({ link_id: linkId }));
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    const fresh = await this.getLink(linkId);
    return this.linkOut(fresh, cfg);
  }

  /** The public review view. It carries only the checkpoint's name, save time, files and expiry. */
  async reviewView(token: string): Promise<Record<string, unknown>> {
    const r = await this.pool.query(
      `SELECT id, checkpoint_id, project_id, token, expires_at, revoked_at, email, email_status
       FROM reviewer_links WHERE token = $1`,
      [token],
    );
    if (r.rowCount === 0) {
      throw new ApiError("link_not_found", "This review link doesn't exist.");
    }
    const row = r.rows[0] as unknown as LinkRow;
    const state = this.linkState(row);
    if (state === "revoked") throw new ApiError("link_revoked", "This review link was revoked.");
    if (state === "expired") throw new ApiError("link_expired", "This review link has expired.");
    const cp = await this.pool.query(
      `SELECT id, name, state, created_at FROM checkpoints WHERE id = $1`,
      [row.checkpoint_id],
    );
    if (cp.rowCount === 0) throw new ApiError("link_not_found", "This review link doesn't exist.");
    const meta = cp.rows[0] as unknown as { id: string; name: string; state: string; created_at: Date };
    if (meta.state !== "saved") {
      throw new ApiError("checkpoint_not_saved", "This checkpoint hasn't finished uploading yet.", { state: meta.state });
    }
    const files = await this.pool.query(
      `SELECT file_id, path, sha256, size FROM checkpoint_files WHERE checkpoint_id = $1 ORDER BY path`,
      [row.checkpoint_id],
    );
    const fileList = files.rows as unknown as { file_id: string; path: string; sha256: string; size: number }[];
    const outFiles: { path: string; content: string }[] = [];
    const damaged: string[] = [];
    let readFailed = false;
    for (const f of fileList) {
      try {
        const bytes = await this.storage.getObject(this.storage.blobKey(row.project_id, f.sha256));
        if (sha256Hex(bytes) === f.sha256) {
          outFiles.push({ path: f.path, content: bytes.toString("utf8") });
        } else {
          damaged.push(f.path);
        }
      } catch {
        readFailed = true;
      }
    }
    if (readFailed) {
      const probe = await this.storage.getObject("healthcheck/probe").then(() => true, () => false);
      if (!probe) {
        const ok = await this.probe();
        if (!ok) throw new ApiError("storage_unavailable", "Storage is unreachable.");
      }
      for (const f of fileList) {
        if (!outFiles.some((o) => o.path === f.path)) damaged.push(f.path);
      }
    }
    if (damaged.length > 0) {
      throw new ApiError("checkpoint_damaged", "This checkpoint can't be shown because its stored files are damaged.", {
        paths: [...damaged].sort(),
      });
    }
    return {
      checkpoint: {
        name: meta.name,
        saved_at: meta.created_at.toISOString(),
        expires_at: row.expires_at.toISOString(),
        files: outFiles,
      },
    };
  }

  private async probe(): Promise<boolean> {
    const key = "healthcheck/probe";
    try {
      await this.storage.putObject(key, Buffer.from("ping"));
      await this.storage.deleteObject(key);
      return true;
    } catch {
      return false;
    }
  }
}

function reviewEmailBodyFrom(link: string, expiresAt: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  const exp = `${expiresAt.getUTCDate()} ${months[expiresAt.getUTCMonth()]} ${expiresAt.getUTCFullYear()}, ${pad(expiresAt.getUTCHours())}:${pad(expiresAt.getUTCMinutes())} UTC`;
  return [
    "A Relay Bench checkpoint is ready for you to review.",
    "",
    `Review link: ${link}`,
    `Link expires: ${exp}`,
    "",
    "Open the link to see the checkpoint. It is read-only and needs no sign-in.",
  ].join("\n");
}
