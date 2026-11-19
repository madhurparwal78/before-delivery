// The Workload view: two weeks of weekday cells per owner and editor.
import { longDate, shortDate, hoursText } from "./api-types.js";
export function renderWorkloadView(panel, initial, from, callbacks) {
    let workload = initial;
    const controls = document.createElement('div');
    controls.className = 'toolbar';
    const prev = document.createElement('button');
    prev.textContent = 'Previous two weeks';
    const next = document.createElement('button');
    next.textContent = 'Next two weeks';
    prev.addEventListener('click', () => callbacks.onFromChange(shift(from, -14)));
    next.addEventListener('click', () => callbacks.onFromChange(shift(from, 14)));
    controls.append(prev, next);
    panel.append(controls);
    const region = document.createElement('div');
    region.className = 'grid-region';
    const table = document.createElement('table');
    table.className = 'grid workload-grid';
    table.setAttribute('role', 'grid');
    table.setAttribute('aria-label', 'Workload');
    region.append(table);
    panel.append(region);
    let activeCell = { person: 0, day: 0 };
    function shift(date, n) {
        const [y, m, d] = date.split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
        return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    }
    function draw() {
        table.replaceChildren();
        if (workload === null)
            return;
        const headRow = document.createElement('tr');
        const corner = document.createElement('th');
        corner.setAttribute('role', 'columnheader');
        corner.textContent = 'Person';
        corner.scope = 'col';
        headRow.append(corner);
        for (const day of workload.days) {
            const th = document.createElement('th');
            th.setAttribute('role', 'columnheader');
            th.textContent = shortDate(day);
            th.scope = 'col';
            headRow.append(th);
        }
        const overHead = document.createElement('th');
        overHead.setAttribute('role', 'columnheader');
        overHead.textContent = 'Over-allocated days';
        overHead.scope = 'col';
        headRow.append(overHead);
        table.append(headRow);
        for (const [personIndex, person] of workload.people.entries()) {
            const tr = document.createElement('tr');
            tr.setAttribute('role', 'row');
            const th = document.createElement('th');
            th.setAttribute('role', 'rowheader');
            th.textContent = person.name;
            th.scope = 'row';
            tr.append(th);
            for (const [dayIndex, day] of person.days.entries()) {
                const td = document.createElement('td');
                td.setAttribute('role', 'gridcell');
                td.dataset.date = day.date;
                td.dataset.hours = String(day.hours);
                td.dataset.over = String(day.over);
                td.textContent = day.hours === 0 ? '' : hoursText(day.hours);
                td.setAttribute('aria-label', `${person.name}, ${longDate(day.date)}: ${hoursText(day.hours)} of ${hoursText(person.capacity)} hours${day.over ? ', over-allocated' : ''}`);
                td.tabIndex = -1;
                if (activeCell.person === personIndex && activeCell.day === dayIndex)
                    td.classList.add('active');
                td.addEventListener('keydown', (event) => cellKeydown(event, personIndex, dayIndex, person, day));
                tr.append(td);
            }
            const total = document.createElement('td');
            total.textContent = String(person.overDays);
            tr.append(total);
            table.append(tr);
        }
        focusActive();
    }
    function cellKeydown(event, personIndex, dayIndex, person, day) {
        const peopleCount = workload?.people.length ?? 0;
        const dayCount = workload?.days.length ?? 0;
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            activeCell = { person: personIndex, day: Math.min(dayIndex + 1, dayCount - 1) };
            draw();
        }
        else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            activeCell = { person: personIndex, day: Math.max(dayIndex - 1, 0) };
            draw();
        }
        else if (event.key === 'ArrowDown') {
            event.preventDefault();
            activeCell = { person: Math.min(personIndex + 1, peopleCount - 1), day: dayIndex };
            draw();
        }
        else if (event.key === 'ArrowUp') {
            event.preventDefault();
            activeCell = { person: Math.max(personIndex - 1, 0), day: dayIndex };
            draw();
        }
        else if (event.key === 'Home') {
            event.preventDefault();
            activeCell = { person: personIndex, day: 0 };
            draw();
        }
        else if (event.key === 'End') {
            event.preventDefault();
            activeCell = { person: personIndex, day: dayCount - 1 };
            draw();
        }
        else if (event.key === 'Enter') {
            event.preventDefault();
            callbacks.onOpenDay(person.name, day.date, day);
        }
    }
    function focusActive() {
        if (workload === null)
            return;
        const row = table.querySelectorAll('tr')[activeCell.person + 1];
        if (row === undefined)
            return;
        const cell = row.querySelectorAll('td[role="gridcell"]')[activeCell.day];
        cell?.focus();
    }
    draw();
    return {
        update(next) {
            workload = next;
            draw();
        },
    };
}
