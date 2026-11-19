// The Gantt chart: day columns, bars, handles, links, ghosts, today and finish markers.
import { addDays, barDescription, weekday } from "./api-types.js";
export const DAY_WIDTH = 32;
export const ROW_HEIGHT = 44;
/** The Monday one week before the week of the earliest item start. */
export function chartStart(project, today) {
    let earliest = null;
    for (const item of project.items) {
        if (item.start === null)
            continue;
        if (earliest === null || item.start < earliest)
            earliest = item.start;
    }
    const base = earliest ?? today;
    const monday = addDays(base, 1 - weekday(base));
    return addDays(monday, -7);
}
/** The Sunday two weeks after the week of the project finish. */
export function chartEnd(project, today) {
    const base = project.finish ?? today;
    const sunday = addDays(base, 7 - weekday(base));
    return addDays(sunday, 14);
}
export function dateToColumn(start, date) {
    const a = Date.parse(`${start}T00:00:00Z`);
    const b = Date.parse(`${date}T00:00:00Z`);
    return Math.round((b - a) / 86_400_000);
}
export function columnToDate(start, column) {
    return addDays(start, column);
}
export function geometry(project, config) {
    const start = chartStart(project, config.today);
    const end = chartEnd(project, config.today);
    const columns = dateToColumn(start, end) + 1;
    const todayColumn = project.items.some((item) => item.start !== null)
        ? dateToColumn(start, config.today)
        : null;
    const finishColumn = project.finish !== null ? dateToColumn(start, project.finish) : null;
    return { chartStart: start, columns, todayColumn, finishColumn };
}
export function barSpec(item, geo) {
    if (item.start === null || item.end === null)
        return null;
    const left = dateToColumn(geo.chartStart, item.start) * DAY_WIDTH;
    const width = (dateToColumn(geo.chartStart, item.end) + 1) * DAY_WIDTH - left;
    return { item, left, width: Math.max(DAY_WIDTH, width) };
}
/** The row order the chart shows: items in row order, grouped items indented under their group. */
export function displayRows(project) {
    const rows = [];
    for (const item of project.items) {
        rows.push({ item, depth: item.group === null ? 0 : 1 });
    }
    return rows;
}
export function descriptionFor(project, item) {
    return barDescription(project, item);
}
export function isFocusable(item) {
    return item.kind !== 'group';
}
export function selectedByNames(presence, meId) {
    const names = presence
        .filter((person) => person.userId !== meId && person.selected !== null)
        .filter((person) => person.selected !== null)
        .map((person) => person.name)
        .sort();
    if (names.length === 0)
        return null;
    return names.join(', ');
}
export const ROLE_WORDS = {
    owner: 'owner',
    editor: 'editor',
    viewer: 'viewer',
};
