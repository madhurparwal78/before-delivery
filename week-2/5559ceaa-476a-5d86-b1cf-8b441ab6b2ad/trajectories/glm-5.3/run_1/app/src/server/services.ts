import type { Pool } from "pg";
import type { Config } from "./config.js";
import type { Storage } from "./storage.js";
import type { Mailer } from "./mailer.js";
import type { Bus } from "./api/ctx.js";
import type { User } from "../shared/types.js";
import { FileService } from "./api/file_service.js";
import { CheckpointService } from "./api/checkpoint_service.js";
import { ImportService } from "./api/import_service.js";
import { ReviewerLinkService } from "./api/reviewer_service.js";
import { InviteService, RemovalService } from "./api/invite_service.js";
import { ErasureService, landingPath } from "./api/erasure_service.js";
import { ApiError } from "./errors.js";

export class Services {
  readonly files: FileService;
  readonly checkpoints: CheckpointService;
  readonly imports: ImportService;
  readonly reviewerLinks: ReviewerLinkService;
  readonly invites: InviteService;
  readonly removal: RemovalService;
  readonly erasure: ErasureService;

  constructor(
    readonly pool: Pool,
    readonly cfg: Config,
    readonly storage: Storage,
    readonly mailer: Mailer,
    readonly bus: Bus,
    readonly seed: { createSampleWorkspace(client: import("pg").PoolClient, mentorId: string): Promise<{ projectId: string; checkpointIds: string[] }> },
  ) {
    this.files = new FileService(pool, bus);
    this.checkpoints = new CheckpointService(pool, storage, bus, cfg);
    this.imports = new ImportService(pool, storage, bus, cfg);
    this.reviewerLinks = new ReviewerLinkService(pool, storage, mailer);
    this.invites = new InviteService(pool, mailer, cfg);
    this.removal = new RemovalService(pool, bus);
    this.erasure = new ErasureService(pool, storage, bus);
  }

  async landingFor(
    client: import("pg").PoolClient,
    userId: string,
    purpose: string,
    projectId: string | null,
  ): Promise<string> {
    return landingPath(
      {
        connect: async () => client,
        query: (sql: string, params?: unknown[]) => client.query(sql, params) as never,
      },
      userId,
      purpose,
      projectId,
    );
  }

  async userName(userId: string): Promise<string | null> {
    const r = await this.pool.query(`SELECT name FROM users WHERE id = $1`, [userId]);
    if (r.rowCount === 0) return null;
    return r.rows[0]["name"] as string;
  }

  async checkpointProject(checkpointId: string, user: User): Promise<string> {
    const r = await this.pool.query(
      `SELECT project_id FROM checkpoints WHERE id = $1`,
      [checkpointId],
    );
    if (r.rowCount === 0) throw new ApiError("not_found", "No such checkpoint.");
    const projectId = r.rows[0]["project_id"] as string;
    const member = await this.pool.query(
      `SELECT role FROM memberships WHERE project_id = $1 AND user_id = $2`,
      [projectId, user.id],
    );
    if ((member.rowCount ?? 0) === 0) throw new ApiError("not_found", "No such checkpoint.");
    return projectId;
  }

  async checkpointsByAccess(checkpointId: string, user: User): Promise<Record<string, unknown>> {
    const projectId = await this.checkpointProject(checkpointId, user);
    void projectId;
    return this.checkpoints.checkpointBody(checkpointId);
  }

  async checkpointState(checkpointId: string): Promise<string> {
    const r = await this.pool.query(`SELECT state FROM checkpoints WHERE id = $1`, [checkpointId]);
    if (r.rowCount === 0) throw new ApiError("not_found", "No such checkpoint.");
    return r.rows[0]["state"] as string;
  }

  async restoreProject(restoreId: string, user: User): Promise<string> {
    const r = await this.pool.query(`SELECT project_id FROM restores WHERE id = $1`, [restoreId]);
    if (r.rowCount === 0) throw new ApiError("not_found", "No such restore.");
    const projectId = r.rows[0]["project_id"] as string;
    const member = await this.pool.query(
      `SELECT 1 FROM memberships WHERE project_id = $1 AND user_id = $2`,
      [projectId, user.id],
    );
    if ((member.rowCount ?? 0) === 0) throw new ApiError("not_found", "No such restore.");
    return projectId;
  }

  async readCheckpointBlob(projectId: string, sha: string): Promise<Buffer> {
    return this.storage.getObject(this.storage.blobKey(projectId, sha));
  }
}
