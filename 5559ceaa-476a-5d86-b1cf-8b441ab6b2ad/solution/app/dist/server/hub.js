import { pool } from "./db.js";
import { memberRows } from "./views.js";
const rooms = new Map();
const cursors = new Map();
function room(projectId) {
    let found = rooms.get(projectId);
    if (!found)
        rooms.set(projectId, (found = new Set()));
    return found;
}
function write(connection, frame) {
    if (connection.socket.readyState === connection.socket.OPEN)
        connection.socket.send(JSON.stringify(frame));
}
export function onlineUsers(projectId) {
    return new Set([...(rooms.get(projectId) ?? [])].map((c) => c.userId));
}
export async function participants(projectId) {
    const online = onlineUsers(projectId);
    return (await memberRows(pool, projectId)).map((m) => ({ ...m, online: online.has(m.user_id) }));
}
export function broadcast(projectId, frame, except) {
    for (const connection of rooms.get(projectId) ?? [])
        if (connection.socket !== except)
            write(connection, frame);
}
export async function broadcastPresence(projectId) {
    broadcast(projectId, { type: "presence", participants: await participants(projectId) });
}
export function join(projectId, userId, socket) {
    const connection = { socket, userId };
    room(projectId).add(connection);
    for (const [owner, frame] of cursors.get(projectId) ?? [])
        if (owner !== userId)
            write(connection, frame);
    return () => {
        const members = rooms.get(projectId);
        members?.delete(connection);
        if (members && members.size === 0)
            rooms.delete(projectId);
        if (!onlineUsers(projectId).has(userId))
            cursors.get(projectId)?.delete(userId);
        void broadcastPresence(projectId).catch(() => undefined);
    };
}
export function relayCursor(projectId, userId, frame, from) {
    let known = cursors.get(projectId);
    if (!known)
        cursors.set(projectId, (known = new Map()));
    known.set(userId, frame);
    broadcast(projectId, frame, from);
}
/** Ends a user's live access to a project: the access notice, then close 4403 "removed". */
export function revoke(projectId, userId) {
    for (const connection of [...(rooms.get(projectId) ?? [])]) {
        if (connection.userId !== userId)
            continue;
        write(connection, { type: "access_revoked" });
        connection.socket.close(4403, "removed");
    }
    cursors.get(projectId)?.delete(userId);
}
