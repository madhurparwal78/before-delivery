// The project engine: reads a project's rows, schedules them through the domain rules,
// and answers the one read model every view and export shares.
import * as q from "../store/queries.js";
import { WorkingCalendar } from "../domain/calendar.js";
import { schedule, variance } from "../domain/schedule.js";
export async function readProject(pool, projectId, today) {
    const project = await q.projectById(pool, projectId);
    if (project === null)
        return null;
    const [items, links, holidays, baseline, baselineItemRows] = await Promise.all([
        q.projectItems(pool, projectId),
        q.projectLinks(pool, projectId),
        q.projectHolidays(pool, projectId),
        q.baselineOf(pool, projectId),
        q.baselineItems(pool, projectId),
    ]);
    const calendar = new WorkingCalendar(holidays.map((h) => h.date));
    const result = schedule(items.map((item) => ({
        id: item.id,
        row: item.row,
        name: item.name,
        kind: item.kind,
        group: item.groupId,
        chosenStart: item.chosenStart,
        duration: item.duration,
        percent: item.percent,
    })), links.map((link) => ({ id: link.id, from: link.fromId, to: link.toId, type: link.type, lag: link.lag })), calendar, today);
    const assignments = await q.itemAssignments(pool, items.map((item) => item.id));
    const assigneesByItem = new Map();
    const peopleIds = [...new Set(assignments.map((a) => a.userId))];
    const people = new Map();
    for (const id of peopleIds) {
        const person = await q.personById(pool, id);
        if (person !== null)
            people.set(id, person);
    }
    for (const a of assignments) {
        const list = assigneesByItem.get(a.itemId) ?? [];
        const person = people.get(a.userId);
        if (person !== undefined)
            list.push({ userId: a.userId, name: person.name, hours: a.hours });
        assigneesByItem.set(a.itemId, list);
    }
    const baselineByItem = new Map(baselineItemRows.map((row) => [row.itemId, row]));
    const readItems = items.map((item) => {
        const computed = result.items.get(item.id);
        // A milestone happens at the end of its day, so its shown end is the same day.
        const shownEnd = item.kind === 'milestone' ? computed.start : computed.end;
        const base = baselineByItem.get(item.id);
        const baseVariance = base !== undefined && shownEnd !== null ? variance(shownEnd, base.end, calendar) : null;
        return {
            id: item.id,
            row: item.row,
            name: item.name,
            kind: item.kind,
            group: item.groupId,
            chosenStart: item.chosenStart,
            start: computed.start,
            end: shownEnd,
            duration: computed.duration,
            percent: computed.percent,
            critical: computed.critical,
            float: computed.float,
            late: computed.late,
            version: item.version,
            assignees: assigneesByItem.get(item.id) ?? [],
            baseline: base !== undefined && baseVariance !== null
                ? { start: base.start, end: base.end, variance: baseVariance }
                : null,
        };
    });
    const finishVariance = baseline !== null && result.finish !== null ? variance(result.finish, baseline.finish, calendar) : null;
    const readLinks = links.map((link) => {
        const computed = result.links.get(link.id);
        return { id: link.id, from: link.fromId, to: link.toId, type: link.type, lag: link.lag, critical: computed.critical };
    });
    return {
        project: {
            id: project.id,
            name: project.name,
            finish: result.finish,
            holidays: holidays.map((h) => ({ date: h.date, name: h.name })),
            items: readItems,
            links: readLinks,
            baseline: baseline !== null && finishVariance !== null ? { name: baseline.name, finish: baseline.finish, finishVariance } : null,
        },
        calendar,
    };
}
/** Canonical predecessors text for one item, in predecessor row order. */
export function predecessorsText(project, itemId) {
    const item = project.items.find((entry) => entry.id === itemId);
    if (item === undefined)
        return '';
    const incoming = project.links
        .filter((link) => link.to === itemId)
        .map((link) => ({ link, predecessor: project.items.find((entry) => entry.id === link.from) }))
        .filter((entry) => entry.predecessor !== undefined)
        .sort((a, b) => a.predecessor.row - b.predecessor.row);
    return incoming
        .map(({ link, predecessor }) => `${predecessor.row}${link.type}${link.lag === 0 ? '' : formatLag(link.lag)}`)
        .join(', ');
}
export function formatLag(lag) {
    if (lag > 0)
        return `+${lag}`;
    return String(lag);
}
/** The moved count's item list, in row order, excluding the edited item and groups. */
export function movedItems(before, after, editedId) {
    const beforeById = new Map(before.items.map((item) => [item.id, item]));
    const moved = [];
    for (const item of after.items) {
        if (item.id === editedId || item.kind === 'group')
            continue;
        const was = beforeById.get(item.id);
        if (was === undefined)
            continue;
        if (was.start !== item.start || was.end !== item.end) {
            moved.push({ id: item.id, start: item.start, end: item.end });
        }
    }
    moved.sort((a, b) => rowOf(after, a.id) - rowOf(after, b.id));
    return moved;
}
function rowOf(project, id) {
    return project.items.find((item) => item.id === id)?.row ?? 0;
}
