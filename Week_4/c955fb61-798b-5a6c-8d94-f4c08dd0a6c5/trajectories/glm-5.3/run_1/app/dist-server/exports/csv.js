// CSV and PDF rendering. The PDF is drawn by the app itself.
import { predecessorsText } from "../services/projects.js";
export function renderCsv(project) {
    const header = 'Row,Name,Type,Group,Start,End,Duration,Percent complete,Critical,Assignees,Predecessors,Baseline start,Baseline end,Variance';
    const lines = [header];
    const groupNames = new Map(project.items.filter((item) => item.kind === 'group').map((item) => [item.id, item.name]));
    for (const item of project.items) {
        const assignees = item.assignees
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((a) => `${a.name} (${formatHours(a.hours)})`)
            .join('; ');
        const row = [
            String(item.row),
            guard(item.name),
            item.kind,
            item.group !== null ? guard(groupNames.get(item.group) ?? '') : '',
            item.start ?? '',
            item.end ?? '',
            String(item.duration),
            `${item.percent}%`,
            item.critical ? 'yes' : 'no',
            assignees,
            item.kind === 'group' ? '' : guard(predecessorsText(project, item.id)),
            item.baseline?.start ?? '',
            item.baseline?.end ?? '',
            item.baseline !== null ? String(item.baseline.variance) : '',
        ];
        lines.push(row.map(csvCell).join(','));
    }
    return lines.join('\r\n') + '\r\n';
}
/** A whole number or one decimal place, so hours read as `10` or `6.5`. */
export function formatHours(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
function csvCell(value) {
    return `"${value.replaceAll('"', '""')}"`;
}
/** Neutralise a cell that a spreadsheet would read as a formula. */
function guard(value) {
    return /^[=+@-]/.test(value) ? `'${value}` : value;
}
