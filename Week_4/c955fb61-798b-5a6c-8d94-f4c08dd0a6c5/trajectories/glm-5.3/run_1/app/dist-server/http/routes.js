// API routes. Every write goes through the project lock, so edits apply one at a time.
import * as q from "../store/queries.js";
import { sendJson, setSessionCookie, clearSessionCookie } from "../http/plumbing.js";
import { ApiError, invalidField, notFound, readOnly, unauthenticated } from "../http/errors.js";
import { hashPassword, verifyPassword } from "../services/auth.js";
import { readProject, movedItems } from "../services/projects.js";
import { WorkingCalendar, isIsoDate } from "../domain/calendar.js";
export function requireSession(ctx) {
    if (ctx.session === null)
        throw unauthenticated();
    return ctx.session.userId;
}
export function asRecord(body) {
    return body !== null && typeof body === 'object' ? body : {};
}
export function requireString(record, field) {
    const value = record[field];
    if (typeof value !== 'string')
        throw invalidField(field);
    return value;
}
export function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
// ---------------------------------------------------------------------------
// Sessions and accounts
export async function signup(deps, ctx) {
    const record = asRecord(ctx.body);
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
    const password = typeof record.password === 'string' ? record.password : '';
    if (name.length < 1 || name.length > 80)
        throw invalidField('name');
    if (!isEmail(email))
        throw invalidField('email');
    if (password.length < 10)
        throw invalidField('password');
    const existing = await q.personByEmail(deps.pool, email);
    if (existing !== null)
        throw new ApiError(409, 'email_taken');
    const person = await q.insertPerson(deps.pool, { name, email, passwordHash: hashPassword(password) });
    const token = await createSession(deps.pool, person.id);
    setSessionCookie(ctx.res, token);
    sendJson(ctx.res, 201, { user: { id: person.id, name: person.name, email: person.email } });
}
export async function signin(deps, ctx) {
    const record = asRecord(ctx.body);
    const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
    const password = typeof record.password === 'string' ? record.password : '';
    const person = await q.personByEmail(deps.pool, email);
    if (person === null || !verifyPassword(password, person.passwordHash))
        throw new ApiError(401, 'invalid_credentials');
    const token = await createSession(deps.pool, person.id);
    setSessionCookie(ctx.res, token);
    sendJson(ctx.res, 200, { user: { id: person.id, name: person.name, email: person.email } });
}
async function createSession(pool, userId) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(36)).join('');
    await pool.query('insert into sessions (token, user_id) values ($1, $2)', [token, userId]);
    return token;
}
export async function signout(deps, ctx) {
    if (ctx.session !== null) {
        await deps.pool.query('delete from sessions where token = $1', [ctx.session.token]);
    }
    clearSessionCookie(ctx.res);
    ctx.res.writeHead(204);
    ctx.res.end();
}
export async function me(deps, ctx) {
    const userId = requireSession(ctx);
    const person = await q.personById(deps.pool, userId);
    if (person === null)
        throw notFound();
    const workspaces = await q.myWorkspaces(deps.pool, userId);
    sendJson(ctx.res, 200, {
        user: { id: person.id, name: person.name, email: person.email },
        workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role })),
    });
}
// ---------------------------------------------------------------------------
// Projects
export async function listProjects(deps, ctx) {
    const userId = requireSession(ctx);
    const projects = await q.projectsForUser(deps.pool, userId);
    const finishById = new Map();
    for (const project of projects) {
        const snapshot = await readProject(deps.pool, project.id, deps.today());
        finishById.set(project.id, snapshot?.project.finish ?? null);
    }
    sendJson(ctx.res, 200, {
        projects: projects.map((p) => ({
            id: p.id,
            name: p.name,
            workspace: { id: p.workspaceId, name: p.workspaceName },
            finish: finishById.get(p.id) ?? null,
        })),
    });
}
export async function createProject(deps, ctx) {
    const userId = requireSession(ctx);
    const record = asRecord(ctx.body);
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const workspaceId = typeof record.workspace === 'string' ? record.workspace : '';
    if (name.length < 1 || name.length > 80)
        throw invalidField('name');
    const role = await q.memberRole(deps.pool, workspaceId, userId);
    if (role === null || role === 'viewer')
        throw notFound();
    const project = await q.insertProject(deps.pool, workspaceId, name);
    const snapshot = await readProject(deps.pool, project.id, deps.today());
    sendJson(ctx.res, 201, { project: snapshot?.project });
}
export async function getProject(deps, ctx, projectId) {
    const { project } = await deps.requireProject(ctx, projectId);
    const snapshot = await readProject(deps.pool, project.id, deps.today());
    sendJson(ctx.res, 200, snapshot?.project);
}
// ---------------------------------------------------------------------------
// Items
export async function createItem(deps, ctx, projectId) {
    const userId = requireSession(ctx);
    const { project, role } = await deps.requireProject(ctx, projectId);
    if (role === 'viewer')
        throw readOnly();
    const record = asRecord(ctx.body);
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const kind = typeof record.kind === 'string' ? record.kind : '';
    if (name.length < 1 || name.length > 120)
        throw invalidField('name');
    if (kind !== 'task' && kind !== 'milestone' && kind !== 'group')
        throw invalidField('kind');
    const before = await readProject(deps.pool, project.id, deps.today());
    const items = before?.project.items ?? [];
    const calendar = before?.calendar ?? new WorkingCalendar([]);
    let start = record.start === undefined || record.start === null ? null : String(record.start);
    if (start !== null && !isIsoDate(start))
        throw invalidField('start');
    let duration = record.duration === undefined || record.duration === null ? undefined : Number(record.duration);
    if (duration !== undefined && !Number.isInteger(duration))
        throw invalidField('duration');
    let groupId = record.group === undefined || record.group === null ? null : String(record.group);
    if (groupId !== null) {
        const group = items.find((item) => item.id === groupId);
        if (group === undefined || group.kind !== 'group')
            throw invalidField('group');
    }
    if (kind === 'group') {
        if (groupId !== null)
            throw invalidField('group');
        start = null;
        duration = undefined;
    }
    if (kind === 'task') {
        if (duration === undefined)
            duration = 1;
        if (duration < 1 || duration > 999)
            throw invalidField('duration');
    }
    if (kind === 'milestone') {
        if (duration === undefined)
            duration = 0;
        if (duration !== 0)
            throw invalidField('duration');
    }
    const chosenStart = start === null ? calendar.nextWorking(deps.today()) : calendar.nextWorking(start);
    let row;
    if (groupId !== null) {
        const groupRow = items.find((item) => item.id === groupId).row;
        const members = items.filter((item) => item.group === groupId);
        const lastRow = members.length === 0 ? groupRow : Math.max(...members.map((item) => item.row));
        row = lastRow + 1;
        await deps.pool.query('update items set row = row + 1 where project_id = $1 and row >= $2', [project.id, row]);
    }
    else {
        row = await q.nextRow(deps.pool, project.id);
    }
    const item = await q.insertItem(deps.pool, {
        projectId: project.id,
        row,
        name,
        kind,
        groupId,
        chosenStart: kind === 'group' ? null : chosenStart,
        duration: kind === 'group' ? 0 : duration,
        versionBy: userId,
    });
    const after = await readProject(deps.pool, project.id, deps.today());
    const moved = before !== null && after !== null ? movedItems(before.project, after.project, item.id) : [];
    await deps.afterEdit(project.id, userId, 'add', item.id);
    sendJson(ctx.res, 201, { item: after?.project.items.find((entry) => entry.id === item.id), moved, finish: after?.project.finish ?? null });
}
export async function patchItem(deps, ctx, itemId) {
    const userId = requireSession(ctx);
    const item = await q.itemById(deps.pool, itemId);
    if (item === null)
        throw notFound();
    const { project, role } = await deps.requireProject(ctx, item.projectId);
    if (role === 'viewer')
        throw readOnly();
    const record = asRecord(ctx.body);
    const baseVersion = record.baseVersion;
    if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion))
        throw invalidField('baseVersion');
    const before = await readProject(deps.pool, project.id, deps.today());
    const beforeItem = before?.project.items.find((entry) => entry.id === itemId);
    if (beforeItem === undefined)
        throw notFound();
    if (beforeItem.version !== baseVersion) {
        const by = await q.personById(deps.pool, item.versionBy);
        throw new ApiError(409, 'version_conflict', {
            item: beforeItem,
            by: by?.name ?? '',
        });
    }
    const calendar = before.calendar;
    const nextVersion = beforeItem.version + 1;
    if (item.kind === 'group') {
        const editable = Object.keys(record).filter((key) => key !== 'baseVersion' && key !== 'name');
        if (editable.length > 0) {
            throw invalidField(editable.includes('start') ? 'start' : editable[0]);
        }
    }
    const updates = [];
    let name = item.name;
    if ('name' in record) {
        const value = typeof record.name === 'string' ? record.name.trim() : '';
        if (value.length < 1 || value.length > 120)
            throw invalidField('name');
        name = value;
        updates.push({ column: 'name', value: name });
    }
    let chosenStart = item.chosenStart;
    if ('start' in record) {
        if (typeof record.start !== 'string' || !isIsoDate(record.start))
            throw invalidField('start');
        chosenStart = calendar.nextWorking(record.start);
        updates.push({ column: 'chosen_start', value: chosenStart });
    }
    let duration = item.duration;
    let kind = item.kind;
    if ('duration' in record) {
        const value = Number(record.duration);
        if (!Number.isInteger(value) || value < 0 || value > 999)
            throw invalidField('duration');
        if (item.kind === 'task' && value === 0) {
            const assignees = beforeItem.assignees;
            if (assignees.length > 0)
                throw new ApiError(422, 'has_assignees');
        }
        duration = value;
        kind = value === 0 ? 'milestone' : 'task';
        updates.push({ column: 'duration', value: duration });
        updates.push({ column: 'kind', value: kind });
    }
    let percent = item.percent;
    if ('percent' in record) {
        const value = Number(record.percent);
        if (!Number.isInteger(value) || value < 0 || value > 100)
            throw invalidField('percent');
        const effectiveKind = duration === 0 ? 'milestone' : kind;
        if (effectiveKind === 'milestone' && value !== 0 && value !== 100)
            throw invalidField('percent');
        percent = value;
        updates.push({ column: 'percent', value: percent });
    }
    let groupId = item.groupId;
    if ('group' in record) {
        if (record.group !== null && typeof record.group !== 'string')
            throw invalidField('group');
        const newGroup = record.group;
        if (newGroup !== null) {
            const group = before?.project.items.find((entry) => entry.id === newGroup);
            if (group === undefined || group.kind !== 'group' || group.id === itemId)
                throw invalidField('group');
        }
        groupId = newGroup;
    }
    await applyPatch(deps.pool, project.id, itemId, updates, nextVersion, userId);
    if ('group' in record && groupId !== item.groupId) {
        await moveToGroup(deps.pool, project.id, itemId, groupId);
    }
    const after = await readProject(deps.pool, project.id, deps.today());
    const moved = before !== null && after !== null ? movedItems(before.project, after.project, itemId) : [];
    await deps.afterEdit(project.id, userId, 'edit', itemId);
    sendJson(ctx.res, 200, {
        item: after?.project.items.find((entry) => entry.id === itemId),
        moved,
        finish: after?.project.finish ?? null,
    });
}
async function applyPatch(pool, projectId, itemId, updates, version, userId) {
    if (updates.length === 0) {
        await pool.query('update items set version = $3, version_by = $4 where id = $1 and project_id = $2', [itemId, projectId, version, userId]);
        return;
    }
    const assignments = updates.map((update, index) => `"${update.column}" = $${index + 5}`).join(', ');
    await pool.query(`update items set ${assignments}, version = $3, version_by = $4 where id = $1 and project_id = $2`, [itemId, projectId, version, userId, ...updates.map((update) => update.value)]);
}
/** Move an item into a group (as that group's last item) or out of it, then renumber the rows. */
async function moveToGroup(pool, projectId, itemId, groupId) {
    const all = await q.projectItems(pool, projectId);
    const me = all.find((entry) => entry.id === itemId);
    if (me === undefined)
        return;
    let rebuilt;
    if (groupId === null) {
        if (me.groupId === null)
            return;
        const withoutMe = all.filter((entry) => entry.id !== itemId);
        const lastInGroup = all.filter((entry) => entry.groupId === me.groupId && entry.id !== itemId);
        const lastRow = lastInGroup.length === 0 ? me.row - 1 : Math.max(...lastInGroup.map((entry) => entry.row));
        rebuilt = [];
        for (const entry of withoutMe) {
            rebuilt.push(entry);
            if (entry.row === lastRow)
                rebuilt.push(me);
        }
        if (!rebuilt.some((entry) => entry.id === itemId))
            rebuilt.push(me);
        for (const entry of rebuilt)
            entry.groupId = entry.id === itemId ? null : entry.groupId;
    }
    else {
        const group = all.find((entry) => entry.id === groupId);
        if (group === undefined || group.kind !== 'group')
            return;
        const members = all.filter((entry) => entry.groupId === groupId && entry.id !== itemId);
        const lastRow = members.length === 0 ? group.row : Math.max(...members.map((entry) => entry.row));
        rebuilt = [];
        for (const entry of all.filter((entry) => entry.id !== itemId)) {
            rebuilt.push(entry);
            if (entry.row === lastRow)
                rebuilt.push(me);
        }
        if (!rebuilt.some((entry) => entry.id === itemId))
            rebuilt.push(me);
        for (const entry of rebuilt)
            entry.groupId = entry.id === itemId ? groupId : entry.groupId;
    }
    let row = 1;
    for (const entry of rebuilt) {
        await pool.query('update items set row = $2, group_id = $3 where id = $1', [entry.id, row, entry.groupId]);
        row += 1;
    }
}
export { moveToGroup };
export async function deleteItem(deps, ctx, itemId) {
    const userId = requireSession(ctx);
    const item = await q.itemById(deps.pool, itemId);
    if (item === null)
        throw notFound();
    const { project, role } = await deps.requireProject(ctx, item.projectId);
    if (role === 'viewer')
        throw readOnly();
    const before = await readProject(deps.pool, project.id, deps.today());
    await deps.pool.query('delete from items where id = $1', [itemId]);
    await q.shiftRowsAbove(deps.pool, project.id, item.row);
    const after = await readProject(deps.pool, project.id, deps.today());
    const moved = before !== null && after !== null ? movedItems(before.project, after.project, itemId) : [];
    await deps.afterEdit(project.id, userId, 'delete', itemId);
    sendJson(ctx.res, 200, { moved, finish: after?.project.finish ?? null });
}
