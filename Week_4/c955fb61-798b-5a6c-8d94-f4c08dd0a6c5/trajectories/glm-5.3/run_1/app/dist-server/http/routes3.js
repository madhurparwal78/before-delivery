// Reordering by the row and group rules.
import * as q from "../store/queries.js";
import { sendJson } from "./plumbing.js";
import { ApiError, invalidField, notFound, readOnly } from "./errors.js";
import { requireSession, asRecord } from "./routes.js";
/** Full row blocks: a group together with its items, at its place. */
function blocks(items) {
    const blocks = [];
    const groupItems = new Map();
    for (const item of items) {
        if (item.kind === 'group')
            groupItems.set(item.id, []);
    }
    for (const item of items) {
        if (item.groupId !== null && groupItems.has(item.groupId))
            groupItems.get(item.groupId).push(item);
    }
    for (const item of items) {
        if (item.groupId !== null)
            continue;
        blocks.push(item.kind === 'group' ? [item, ...(groupItems.get(item.id) ?? [])] : [item]);
    }
    return blocks;
}
/** Rows of a list with their renumbered positions, for the answer. */
function renumbered(items) {
    return items.map((entry, index) => ({ id: entry.id, row: index + 1, group: entry.groupId }));
}
export async function reorderItem(deps, ctx, itemId) {
    const userId = requireSession(ctx);
    const item = await q.itemById(deps.pool, itemId);
    if (item === null)
        throw notFound();
    const { project, role } = await deps.requireProject(ctx, item.projectId);
    if (role === 'viewer')
        throw readOnly();
    const record = asRecord(ctx.body);
    const direction = record.direction;
    if (direction !== 'up' && direction !== 'down')
        throw invalidField('direction');
    if (item.kind === 'group')
        throw new ApiError(422, 'not_reorderable');
    const items = await q.projectItems(deps.pool, project.id);
    const me = items.find((entry) => entry.id === itemId);
    if (me === undefined)
        throw notFound();
    const rowsAnswer = (list) => renumbered(list);
    const unchanged = () => sendJson(ctx.res, 200, { changed: false, rows: rowsAnswer(items) });
    if (me.groupId !== null) {
        // Inside a group: swap with the neighbouring item of the same group.
        const siblings = items.filter((entry) => entry.groupId === me.groupId);
        const index = siblings.findIndex((entry) => entry.id === itemId);
        const target = direction === 'up' ? index - 1 : index + 1;
        if (target < 0 || target >= siblings.length) {
            unchanged();
            return;
        }
        const swapped = [...siblings];
        swapped[index] = siblings[target];
        swapped[target] = siblings[index];
        const siblingIds = new Set(siblings.map((entry) => entry.id));
        const rebuilt = [];
        let at = 0;
        for (const entry of items) {
            if (siblingIds.has(entry.id)) {
                if (at < swapped.length) {
                    rebuilt.push(swapped[at]);
                    at += 1;
                }
                continue;
            }
            rebuilt.push(entry);
        }
        persistRows(deps.pool, project.id, rebuilt);
        await deps.afterEdit(project.id, userId, 'reorder', itemId);
        sendJson(ctx.res, 200, { changed: true, rows: renumbered(rebuilt) });
        return;
    }
    const current = blocks(items);
    const blockIndex = current.findIndex((block) => block.some((entry) => entry.id === itemId));
    const swapWith = direction === 'up' ? blockIndex - 1 : blockIndex + 1;
    if (swapWith < 0 || swapWith >= current.length) {
        unchanged();
        return;
    }
    const next = [...current];
    const tmp = next[blockIndex];
    next[blockIndex] = next[swapWith];
    next[swapWith] = tmp;
    const mapped = next.flat().map((entry) => ({ ...entry }));
    persistRows(deps.pool, project.id, mapped);
    await deps.afterEdit(project.id, userId, 'reorder', itemId);
    sendJson(ctx.res, 200, { changed: true, rows: renumbered(mapped) });
}
/** Rewrite the whole project's row order from a rebuilt list, renumbering from 1. */
async function persistRows(pool, projectId, items) {
    let row = 1;
    for (const item of items) {
        await pool.query('update items set row = $2 where id = $1 and project_id = $3', [item.id, row, projectId]);
        row += 1;
    }
}
