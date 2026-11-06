import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { many, one, pool, tx } from "./db.js";
import { ApiError } from "./errors.js";
import { broadcast } from "./hub.js";
import { lockProject } from "./rules.js";
import { checksumOf, getObject, putObject, sha256Hex, StorageUnavailable, storedChecksum } from "./storage.js";
import { checkpointById, checkpointView, FILE_COLUMNS, fileView, iso } from "./views.js";
export const blobKey = (projectId, sha256) => `projects/${projectId}/blobs/${sha256}`;
export const manifestKey = (projectId, checkpointId) => `projects/${projectId}/checkpoints/${checkpointId}/manifest.json`;
/** Captures the project's current files as a new pending checkpoint; the bytes are staged in Postgres. */
export async function captureCheckpoint(db, projectId, userId, name, createdAt = new Date()) {
    const id = randomUUID();
    await lockProject(db, projectId);
    await db.query("INSERT INTO checkpoints (id, project_id, name, state, created_by, created_at) VALUES ($1, $2, $3, 'pending_upload', $4, $5)", [id, projectId, name, userId, createdAt]);
    await db.query(`INSERT INTO checkpoint_files (checkpoint_id, file_id, path, sha256, size)
     SELECT $1, id, path, sha256, size FROM files WHERE project_id = $2 AND deleted_at IS NULL`, [id, projectId]);
    await db.query(`INSERT INTO checkpoint_staged (checkpoint_id, sha256, content)
     SELECT DISTINCT ON (sha256) $1, sha256, content FROM files WHERE project_id = $2 AND deleted_at IS NULL`, [id, projectId]);
    return id;
}
/** Blob confirmation: storage must report the blob's SHA-256, or its bytes must read back to the key. */
async function confirmBlob(key, bytes) {
    const expected = checksumOf(bytes);
    const reported = await storedChecksum(key);
    if (reported === expected)
        return true;
    if (reported === "") {
        const stored = await getObject(key);
        return stored !== null && checksumOf(stored) === expected;
    }
    return false;
}
async function storeConfirmed(key, bytes, contentType) {
    const existing = await storedChecksum(key);
    if (existing === checksumOf(bytes))
        return;
    await putObject(key, bytes, contentType);
    if (!(await confirmBlob(key, bytes)))
        throw new StorageUnavailable(`object ${key} could not be confirmed`);
}
/**
 * The only place a checkpoint changes state: pending_upload → saved once every blob and the manifest are
 * confirmed, pending_upload → failed at the upload deadline. Claims the row so one instance works on it.
 */
export async function advanceCheckpoint(id) {
    const changed = await tx(async (db) => {
        const row = await one(db, "SELECT id, project_id, name, created_at FROM checkpoints WHERE id = $1 AND state = 'pending_upload' FOR UPDATE SKIP LOCKED", [id]);
        if (!row)
            return false;
        try {
            const staged = await many(db, "SELECT sha256, content FROM checkpoint_staged WHERE checkpoint_id = $1", [id]);
            for (const blob of staged)
                await storeConfirmed(blobKey(row.project_id, blob.sha256), blob.content, "application/octet-stream");
            const files = await many(db, "SELECT file_id, path, sha256, size FROM checkpoint_files WHERE checkpoint_id = $1 ORDER BY path COLLATE \"C\"", [id]);
            const manifest = Buffer.from(JSON.stringify({ checkpoint_id: id, project_id: row.project_id, name: row.name, created_at: iso(row.created_at), files }), "utf8");
            await storeConfirmed(manifestKey(row.project_id, id), manifest, "application/json");
            await db.query("UPDATE checkpoints SET state = 'saved' WHERE id = $1", [id]);
            await db.query("DELETE FROM checkpoint_staged WHERE checkpoint_id = $1", [id]);
            return true;
        }
        catch (error) {
            if (!(error instanceof StorageUnavailable))
                throw error;
            if (Date.now() < row.created_at.getTime() + config.checkpointUploadDeadlineSeconds * 1000)
                return false;
            await db.query("UPDATE checkpoints SET state = 'failed' WHERE id = $1", [id]);
            await db.query("DELETE FROM checkpoint_staged WHERE checkpoint_id = $1", [id]);
            return true;
        }
    });
    if (changed)
        await announceCheckpoint(id);
}
export async function announceCheckpoint(id) {
    const row = await checkpointById(pool, id);
    if (row)
        broadcast(row.project_id, { type: "checkpoint", checkpoint: checkpointView(row) });
}
export async function pendingCheckpoints() {
    return (await many(pool, "SELECT id FROM checkpoints WHERE state = 'pending_upload' ORDER BY created_at")).map((r) => r.id);
}
/**
 * The damage check: reads each recorded blob and hashes it against the manifest. A missing blob (with storage
 * reachable) or one whose bytes differ is damaged; any damage answers checkpoint_damaged and nothing changes.
 */
export async function readRecorded(projectId, files) {
    const bytes = new Map();
    const damaged = [];
    for (const file of files) {
        const stored = await getObject(blobKey(projectId, file.sha256));
        if (stored === null || sha256Hex(stored) !== file.sha256)
            damaged.push(file.path);
        else
            bytes.set(file.file_id, stored);
    }
    if (damaged.length)
        throw new ApiError("checkpoint_damaged", { paths: damaged.sort() });
    return bytes;
}
export async function recordedFiles(db, checkpointId) {
    return many(db, "SELECT file_id, path, sha256 FROM checkpoint_files WHERE checkpoint_id = $1 ORDER BY path COLLATE \"C\"", [checkpointId]);
}
export function requireSaved(state) {
    if (state !== "saved")
        throw new ApiError("checkpoint_not_saved", { state });
}
/** Makes the project's live file set exactly `entries` (IDs, paths, bytes), raising revisions that change. */
export async function applyFileSet(db, projectId, userId, action, entries) {
    const before = new Map((await many(db, "SELECT id, path, sha256, deleted_at IS NOT NULL AS deleted FROM files WHERE project_id = $1", [projectId])).map((r) => [r.id, r]));
    const keep = new Set(entries.map((e) => e.file_id));
    const deleted = [...before.values()].filter((r) => !r.deleted && !keep.has(r.id)).map((r) => r.id);
    await db.query("UPDATE files SET deleted_at = now() WHERE project_id = $1 AND deleted_at IS NULL", [projectId]);
    const changed = [];
    for (const entry of entries) {
        const sha = sha256Hex(entry.content);
        const prior = before.get(entry.file_id);
        const differs = !prior || prior.deleted || prior.path !== entry.path || prior.sha256 !== sha;
        const row = prior
            ? await one(db, `UPDATE files SET deleted_at = NULL, path = $2, content = $3, sha256 = $4, size = $5,
             revision = revision + $6 WHERE id = $1 RETURNING ${FILE_COLUMNS}`, [entry.file_id, entry.path, entry.content, sha, entry.content.length, differs ? 1 : 0])
            : await one(db, `INSERT INTO files (id, project_id, path, content, sha256, size) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${FILE_COLUMNS}`, [entry.file_id, projectId, entry.path, entry.content, sha, entry.content.length]);
        if (differs && row) {
            changed.push(fileView(row));
            await db.query("INSERT INTO edit_log (project_id, file_id, user_id, action, revision, sha256) VALUES ($1, $2, $3, $4, $5, $6)", [projectId, row.id, userId, action, row.revision, row.sha256]);
        }
    }
    for (const id of deleted) {
        await db.query("INSERT INTO edit_log (project_id, file_id, user_id, action, revision, sha256) SELECT $1, id, $2, 'delete', revision, NULL FROM files WHERE id = $3", [projectId, userId, id]);
    }
    return { changed, deleted };
}
export function announceFileSet(projectId, change) {
    for (const file of change.changed)
        broadcast(projectId, { type: "file", file });
    for (const id of change.deleted)
        broadcast(projectId, { type: "file_deleted", file_id: id });
}
