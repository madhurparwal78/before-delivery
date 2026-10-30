import { config } from "./config.js";
import { many, one } from "./db.js";
import { ApiError } from "./errors.js";
import { expired } from "./rules.js";
export const iso = (moment) => moment.toISOString();
export function userView(user) {
    return { id: user.id, email: user.email, name: user.name, kind: user.kind };
}
/** Project-scoped access: the caller's role, or not_found for anyone who is not a member. */
export async function projectRole(db, projectId, userId) {
    const row = await one(db, "SELECT role FROM memberships WHERE project_id = $1 AND user_id = $2", [
        projectId,
        userId,
    ]);
    if (!row)
        throw new ApiError("not_found");
    return row.role;
}
export async function mentorOnly(db, projectId, userId) {
    if ((await projectRole(db, projectId, userId)) !== "mentor")
        throw new ApiError("forbidden");
}
export async function memberRows(db, projectId) {
    return many(db, `SELECT m.user_id, u.name, m.role, m.email_status FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.project_id = $1 ORDER BY (m.role = 'mentor') DESC, m.seq`, [projectId]);
}
export const SESSION_COLUMNS = "id, project_id, title, state, scheduled_for, driver_id, version";
export function sessionView(row) {
    return {
        id: row.id,
        project_id: row.project_id,
        title: row.title,
        state: row.state,
        scheduled_for: iso(row.scheduled_for),
        driver_id: row.driver_id,
        version: row.version,
    };
}
export const FILE_COLUMNS = "id, path, revision, sha256, size";
export function fileView(row) {
    return { id: row.id, path: row.path, revision: row.revision, sha256: row.sha256, size: row.size };
}
export const CHECKPOINT_SELECT = `SELECT c.id, c.project_id, c.name, c.state, c.created_by, u.name AS author, c.created_at,
  (SELECT count(*)::int FROM checkpoint_files f WHERE f.checkpoint_id = c.id) AS file_count
  FROM checkpoints c JOIN users u ON u.id = c.created_by`;
export function checkpointView(row) {
    return {
        id: row.id,
        project_id: row.project_id,
        name: row.name,
        state: row.state,
        created_by: { id: row.created_by, name: row.author },
        created_at: iso(row.created_at),
        file_count: row.file_count,
    };
}
export async function checkpointById(db, id) {
    return one(db, `${CHECKPOINT_SELECT} WHERE c.id = $1`, [id]);
}
export const LINK_COLUMNS = "id, checkpoint_id, token, expires_at, revoked_at, email_status";
export function linkState(row, now = new Date()) {
    if (row.revoked_at)
        return "revoked";
    return expired(row.expires_at, now) ? "expired" : "active";
}
export function reviewUrl(token) {
    return `${config.publicUrl}/review/${token}`;
}
export function linkView(row) {
    return {
        id: row.id,
        checkpoint_id: row.checkpoint_id,
        url: reviewUrl(row.token),
        expires_at: iso(row.expires_at),
        state: linkState(row),
        email_status: row.email_status,
    };
}
