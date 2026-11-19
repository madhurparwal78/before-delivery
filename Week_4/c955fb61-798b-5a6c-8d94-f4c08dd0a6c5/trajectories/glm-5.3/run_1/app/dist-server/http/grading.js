// The grading setup route: builds the people, workspace, projects, items, links and baseline it is given.
import * as q from "../store/queries.js";
import { sendJson } from "./plumbing.js";
import { ApiError, notFound } from "./errors.js";
import { hashPassword } from "../services/auth.js";
import { readProject } from "../services/projects.js";
import { WorkingCalendar, isIsoDate } from "../domain/calendar.js";
function field(body, path) {
    let current = body;
    for (const part of path.split('.')) {
        if (current === null || typeof current !== 'object')
            throw invalidJson(path);
        current = current[part];
    }
    return current;
}
function invalidJson(path) {
    return new ApiError(422, 'invalid_field', { field: path });
}
function asArray(value, path) {
    if (!Array.isArray(value))
        throw invalidJson(path);
    return value;
}
function asString(value, path) {
    if (typeof value !== 'string')
        throw invalidJson(path);
    return value;
}
export async function gradingSetup(pool, config, ctx) {
    const key = ctx.raw.headers['x-grading-key'];
    if (config.gradingKey === null || key !== config.gradingKey)
        throw notFound();
    const body = ctx.body;
    const users = asArray(body.users, 'users');
    const workspace = field(body, 'workspace');
    const workspaceName = asString(workspace.name, 'workspace.name');
    const members = asArray(workspace.members, 'workspace.members');
    const projects = asArray(body.projects, 'projects');
    const emailToPerson = new Map();
    const createdUsers = [];
    for (const entry of users) {
        const record = entry;
        const email = asString(record.email, 'users.email').trim().toLowerCase();
        const name = asString(record.name, 'users.name');
        const password = asString(record.password, 'users.password');
        const capacity = record.capacity === undefined ? 8 : Number(record.capacity);
        const existing = await q.personByEmail(pool, email);
        if (existing === null) {
            const person = await q.insertPerson(pool, { name, email, passwordHash: hashPassword(password), capacity });
            emailToPerson.set(email, person);
            createdUsers.push({ email, id: person.id });
        }
        else {
            await q.updatePerson(pool, existing.id, { name, passwordHash: hashPassword(password), capacity });
            const updated = await q.personByEmail(pool, email);
            if (updated !== null)
                emailToPerson.set(email, updated);
            createdUsers.push({ email, id: existing.id });
        }
    }
    const workspaceRow = await q.insertWorkspace(pool, workspaceName);
    const roleByEmail = new Map();
    for (const entry of members) {
        const record = entry;
        const email = asString(record.email, 'workspace.members.email').trim().toLowerCase();
        const role = asString(record.role, 'workspace.members.role');
        const person = emailToPerson.get(email);
        if (person === undefined)
            throw invalidJson('workspace.members.email');
        await q.insertMember(pool, workspaceRow.id, person.id, role);
        roleByEmail.set(email, role);
    }
    const firstOwner = [...roleByEmail.entries()].find(([, role]) => role === 'owner')?.[0];
    const firstOwnerId = firstOwner === undefined ? '' : emailToPerson.get(firstOwner).id;
    const projectResults = [];
    for (const entry of projects) {
        const record = entry;
        const name = asString(record.name, 'projects.name');
        const project = await q.insertProject(pool, workspaceRow.id, name);
        const itemIds = {};
        const holidays = asArray(record.holidays ?? [], 'projects.holidays');
        for (const holiday of holidays) {
            const h = holiday;
            const date = asString(h.date, 'projects.holidays.date');
            const holidayName = asString(h.name, 'projects.holidays.name');
            if (!isIsoDate(date))
                throw invalidJson('projects.holidays.date');
            await q.insertHoliday(pool, project.id, date, holidayName);
        }
        const calendar = new WorkingCalendar(holidays.map((h) => asString(h.date, 'projects.holidays.date')));
        const items = asArray(record.items ?? [], 'projects.items');
        let row = 0;
        for (const itemEntry of items) {
            const item = itemEntry;
            const key = asString(item.key, 'projects.items.key');
            const itemName = asString(item.name, 'projects.items.name');
            const kind = asString(item.kind, 'projects.items.kind');
            const groupKey = item.group === undefined || item.group === null ? null : asString(item.group, 'projects.items.group');
            const groupId = groupKey === null ? null : itemIds[groupKey] ?? null;
            const start = item.start === undefined ? null : asString(item.start, 'projects.items.start');
            const duration = item.duration === undefined ? 0 : Number(item.duration);
            const percent = item.percent === undefined ? 0 : Number(item.percent);
            row += 1;
            const effectiveStart = kind === 'group' ? null : start === null ? calendar.nextWorking(config.today) : calendar.nextWorking(start);
            const effectiveDuration = kind === 'group' ? 0 : kind === 'milestone' ? 0 : duration === 0 ? 1 : duration;
            const inserted = await q.insertItem(pool, {
                projectId: project.id,
                row,
                name: itemName,
                kind,
                groupId,
                chosenStart: effectiveStart,
                duration: effectiveDuration,
                percent,
                versionBy: firstOwnerId,
            });
            itemIds[key] = inserted.id;
            const assignees = asArray(item.assignees ?? [], 'projects.items.assignees');
            for (const assignee of assignees) {
                const a = assignee;
                const email = asString(a.email, 'projects.items.assignees.email').trim().toLowerCase();
                const hours = Number(a.hours);
                const person = emailToPerson.get(email);
                if (person === undefined)
                    throw invalidJson('projects.items.assignees.email');
                await q.insertAssignment(pool, inserted.id, person.id, hours);
            }
        }
        const links = asArray(record.links ?? [], 'projects.links');
        for (const linkEntry of links) {
            const link = linkEntry;
            const fromKey = asString(link.from, 'projects.links.from');
            const toKey = asString(link.to, 'projects.links.to');
            const type = asString(link.type, 'projects.links.type');
            const lag = Number(link.lag ?? 0);
            const fromId = itemIds[fromKey];
            const toId = itemIds[toKey];
            if (fromId === undefined || toId === undefined)
                throw invalidJson('projects.links.from');
            await q.insertLink(pool, { projectId: project.id, fromId, toId, type, lag });
        }
        if (record.baseline !== null && record.baseline !== undefined) {
            const baseline = record.baseline;
            const baselineName = asString(baseline.name, 'projects.baseline.name');
            const snapshot = await readProject(pool, project.id, config.today);
            if (snapshot !== null && snapshot.project.finish !== null) {
                await q.saveBaseline(pool, project.id, baselineName, snapshot.project.finish, snapshot.project.items
                    .filter((item) => item.kind !== 'group' && item.start !== null && item.end !== null)
                    .map((item) => ({ itemId: item.id, start: item.start, end: item.end })));
            }
        }
        projectResults.push({ name, id: project.id, items: itemIds });
    }
    sendJson(ctx.res, 201, {
        workspace: { id: workspaceRow.id },
        users: createdUsers,
        projects: projectResults,
    });
}
