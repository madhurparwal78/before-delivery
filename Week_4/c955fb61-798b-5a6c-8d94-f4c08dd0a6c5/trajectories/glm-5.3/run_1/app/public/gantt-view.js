// The Gantt view: chart region, bars, drag with snapping, keyboard editing and the knock-on.
import { addDays, barDescription, linkDepth, longDate, shortDate, weekday } from "./api-types.js";
import { DAY_WIDTH, ROW_HEIGHT, dateToColumn, geometry } from "./chart-geometry.js";
/** A calendar built from a project's holidays, in the one shape the drag rules use. */
export function projectCalendar(project) {
    const holidays = new Set(project.holidays.map((holiday) => holiday.date));
    const isWorking = (date) => {
        const dow = weekday(date);
        return dow >= 1 && dow <= 5 && !holidays.has(date);
    };
    const nextWorking = (date) => {
        let d = date;
        while (!isWorking(d))
            d = addDays(d, 1);
        return d;
    };
    const previousWorking = (date) => {
        let d = date;
        while (!isWorking(d))
            d = addDays(d, -1);
        return d;
    };
    const addWorkdays = (date, n) => {
        if (n === 0)
            return nextWorking(date);
        if (n > 0) {
            let d = date;
            let left = n;
            while (left > 0) {
                d = addDays(d, 1);
                if (isWorking(d))
                    left -= 1;
            }
            return d;
        }
        let d = date;
        let left = -n;
        while (left > 0) {
            d = addDays(d, -1);
            if (isWorking(d))
                left -= 1;
        }
        return d;
    };
    return { isWorking, nextWorking, previousWorking, addWorkdays };
}
export function movedCountWords(n) {
    if (n === 0)
        return 'No dependent tasks moved.';
    if (n === 1)
        return '1 dependent task moved.';
    return `${n} dependent tasks moved.`;
}
export function finishWords(finish) {
    return finish === null ? '' : ` Project finishes ${longDate(finish)}.`;
}
export function renderGanttView(panel, initialProject, callbacks) {
    let project = initialProject;
    let focusedId = null;
    let drag = null;
    const wrap = document.createElement('div');
    wrap.className = 'gantt-wrap';
    const nameColumn = document.createElement('div');
    nameColumn.className = 'name-column';
    nameColumn.innerHTML = `<div class="name-head">Name</div><div class="name-rows"></div>`;
    const chartRegion = document.createElement('div');
    chartRegion.className = 'chart-region';
    chartRegion.setAttribute('role', 'region');
    chartRegion.setAttribute('aria-label', 'Chart');
    wrap.append(nameColumn, chartRegion);
    panel.append(wrap);
    const timeline = document.createElement('ul');
    timeline.className = 'timeline';
    timeline.setAttribute('aria-label', 'Timeline');
    panel.append(timeline);
    const canvas = document.createElement('div');
    canvas.className = 'chart-canvas';
    chartRegion.append(canvas);
    const itemOf = (id) => project.items.find((entry) => entry.id === id);
    // ----- announcements
    function moveSentence(item, outcome) {
        const updated = itemOf(item.id);
        if (updated === undefined)
            return `${item.name} saved.`;
        if (item.kind === 'milestone') {
            return `${item.name} is now on ${longDate(updated.start ?? '')}. ${movedCountWords(outcome.moved)}${finishWords(outcome.finish)}`;
        }
        return `${item.name} now starts ${longDate(updated.start ?? '')} and ends ${longDate(updated.end ?? '')}. ${movedCountWords(outcome.moved)}${finishWords(outcome.finish)}`;
    }
    function resizeSentence(item, outcome) {
        const updated = itemOf(item.id);
        if (updated === undefined)
            return `${item.name} saved.`;
        const days = updated.duration === 1 ? '1 working day' : `${updated.duration} working days`;
        return `${item.name} now lasts ${days} and ends ${longDate(updated.end ?? '')}. ${movedCountWords(outcome.moved)}${finishWords(outcome.finish)}`;
    }
    function constraintSentence(item, predecessor, date) {
        return `${item.name} can start no earlier than ${longDate(date)} because of ${predecessor}.`;
    }
    // ----- edits
    function submitMove(item, chosenStart) {
        const bar = canvas.querySelector(`[data-item-id="${item.id}"]`);
        if (bar !== null) {
            bar.setAttribute('aria-busy', 'true');
            bar.setAttribute('data-start', chosenStart);
        }
        void callbacks.patchItem(item, { start: chosenStart }).then((outcome) => {
            const updated = itemOf(item.id);
            const constrained = updated !== undefined && updated.start !== null && chosenStart < updated.start;
            if (constrained) {
                const predecessorName = predecessorOf(item.id);
                callbacks.onAnnounce(constraintSentence(item, predecessorName, updated.start));
            }
            else {
                callbacks.onAnnounce(moveSentence(item, outcome));
            }
        });
    }
    function predecessorOf(itemId) {
        const item = itemOf(itemId);
        if (item === undefined)
            return '';
        const incoming = project.links
            .filter((link) => link.to === itemId)
            .map((link) => ({ link, predecessor: project.items.find((entry) => entry.id === link.from) }))
            .filter((entry) => entry.predecessor !== undefined)
            .sort((a, b) => a.predecessor.row - b.predecessor.row);
        return incoming[0]?.predecessor.name ?? '';
    }
    function submitResize(item, duration, start) {
        const body = { duration };
        if (start !== undefined)
            body.start = start;
        void callbacks.patchItem(item, body).then((outcome) => {
            callbacks.onAnnounce(resizeSentence(item, outcome));
        });
    }
    function nudge(item, direction) {
        const calendar = projectCalendar(project);
        // ArrowRight sets the chosen start to the working day after the shown start.
        const target = calendar.addWorkdays(item.start ?? callbacks.config.today, direction);
        submitMove(item, target);
    }
    function resizeBy(item, delta) {
        if (item.kind === 'milestone')
            return;
        if (delta === -1 && item.duration <= 1) {
            callbacks.onAnnounce(`${item.name} is already 1 working day long.`);
            return;
        }
        submitResize(item, item.duration + delta);
    }
    // ----- keyboard
    function barKeydown(event, item) {
        if (callbacks.viewer) {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                callbacks.onAnnounce('You can view this project but not change it.');
            }
            return;
        }
        if (event.key === 'ArrowRight' && !event.shiftKey) {
            event.preventDefault();
            nudge(item, 1);
        }
        else if (event.key === 'ArrowLeft' && !event.shiftKey) {
            event.preventDefault();
            nudge(item, -1);
        }
        else if (event.shiftKey && event.key === 'ArrowRight') {
            event.preventDefault();
            resizeBy(item, 1);
        }
        else if (event.shiftKey && event.key === 'ArrowLeft') {
            event.preventDefault();
            resizeBy(item, -1);
        }
        else if (event.key === 'Enter') {
            event.preventDefault();
            callbacks.onOpenDetails(item.id);
        }
        else if (event.key.toLowerCase() === 'l' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            callbacks.onOpenLink(item.id);
        }
    }
    // ----- drag
    function beginDrag(event, item, bar) {
        if (callbacks.viewer)
            return;
        const handle = event.target.dataset.handle;
        const mode = handle === 'start' ? 'start' : handle === 'end' ? 'end' : 'move';
        drag = { itemId: item.id, mode, startX: event.clientX, active: false };
        bar.setPointerCapture(event.pointerId);
        event.preventDefault();
    }
    function dragMove(event, bar, item) {
        if (drag === null || drag.itemId !== item.id)
            return;
        const dx = event.clientX - drag.startX;
        if (!drag.active) {
            if (Math.abs(dx) < 4)
                return;
            drag.active = true;
        }
        const snapped = snap(item, dx, drag.mode);
        if (snapped === null)
            return;
        const geo = geometry(project, callbacks.config);
        const left = dateToColumn(geo.chartStart, snapped.start) * DAY_WIDTH;
        const width = (dateToColumn(geo.chartStart, snapped.end) + 1) * DAY_WIDTH - left;
        bar.style.left = `${left}px`;
        bar.style.width = `${Math.max(DAY_WIDTH, width)}px`;
        const tip = ensureDragTip();
        tip.style.left = `${event.clientX + 16}px`;
        tip.style.top = `${event.clientY + 16}px`;
        tip.textContent = `${longDate(snapped.start)} - ${longDate(snapped.end)}`;
    }
    function endDrag(event, item) {
        if (drag === null || drag.itemId !== item.id)
            return;
        const dx = event.clientX - drag.startX;
        const mode = drag.mode;
        const active = drag.active;
        drag = null;
        hideDragTip();
        if (!active)
            return;
        const snapped = snap(item, dx, mode);
        if (snapped === null)
            return;
        if (mode === 'move') {
            if (snapped.start === item.start)
                return;
            submitMove(item, snapped.start);
        }
        else if (mode === 'end') {
            const duration = countWorkdays(snapped.start, snapped.end);
            if (duration === item.duration)
                return;
            submitResize(item, duration);
        }
        else {
            const duration = countWorkdays(snapped.start, item.end ?? snapped.end);
            if (duration === item.duration && snapped.start === item.start)
                return;
            submitResize(item, duration, snapped.start);
        }
    }
    function cancelDrag() {
        if (drag === null)
            return;
        drag = null;
        hideDragTip();
        redraw();
    }
    function snap(item, dx, mode) {
        if (item.start === null || item.end === null)
            return null;
        const calendar = projectCalendar(project);
        const offset = Math.round(dx / DAY_WIDTH);
        if (mode === 'move') {
            const start = calendar.nextWorking(addDays(item.start, offset));
            const end = calendar.addWorkdays(start, Math.max(0, item.duration - 1));
            return { start, end };
        }
        if (mode === 'end') {
            let end = addDays(item.end, offset);
            if (!calendar.isWorking(end))
                end = calendar.previousWorking(end);
            if (end < item.start)
                end = item.start;
            return { start: item.start, end };
        }
        let start = addDays(item.start, offset);
        if (!calendar.isWorking(start))
            start = calendar.nextWorking(start);
        if (start > item.end)
            start = item.end;
        return { start, end: item.end };
    }
    function countWorkdays(start, end) {
        const calendar = projectCalendar(project);
        if (end < start)
            return 1;
        let count = 0;
        let d = start;
        while (d <= end) {
            if (calendar.isWorking(d))
                count += 1;
            d = addDays(d, 1);
        }
        return Math.max(1, count);
    }
    function ensureDragTip() {
        let tip = document.getElementById('drag-tip');
        if (tip === null) {
            tip = document.createElement('div');
            tip.id = 'drag-tip';
            tip.className = 'drag-tip';
            document.body.append(tip);
        }
        return tip;
    }
    function hideDragTip() {
        document.getElementById('drag-tip')?.remove();
    }
    // ----- drawing
    function redraw() {
        draw(project);
    }
    function draw(nextProject) {
        // Read focus before the redraw clears the old bars.
        const hadFocus = document.activeElement !== null && document.activeElement !== document.body;
        project = nextProject;
        const geo = geometry(project, callbacks.config);
        const rows = project.items.map((item) => ({ item, depth: item.group === null ? 0 : 1 }));
        const nameRows = nameColumn.querySelector('.name-rows');
        nameRows.replaceChildren();
        for (const { item, depth } of rows) {
            const row = document.createElement('div');
            row.className = `name-row${item.kind === 'group' ? ' group' : ''}`;
            row.style.height = `${ROW_HEIGHT}px`;
            if (depth > 0)
                row.append(Object.assign(document.createElement('span'), { className: 'indent' }));
            row.append(Object.assign(document.createElement('span'), { textContent: item.name }));
            nameRows.append(row);
        }
        canvas.replaceChildren();
        canvas.style.width = `${geo.columns * DAY_WIDTH}px`;
        const head = document.createElement('div');
        head.className = 'day-head';
        const holidayByDate = new Map(project.holidays.map((holiday) => [holiday.date, holiday.name]));
        for (let column = 0; column < geo.columns; column += 1) {
            const date = addDays(geo.chartStart, column);
            const cell = document.createElement('div');
            cell.className = 'day-cell';
            cell.dataset.day = date;
            const working = weekday(date) >= 1 && weekday(date) <= 5 && !holidayByDate.has(date);
            cell.dataset.working = String(working);
            const holidayName = holidayByDate.get(date);
            if (holidayName !== undefined)
                cell.dataset.holiday = holidayName;
            cell.textContent = String(Number(date.slice(8, 10)));
            if (holidayName !== undefined) {
                const label = document.createElement('span');
                label.className = 'holiday-name';
                label.textContent = holidayName;
                cell.append(label);
            }
            head.append(cell);
        }
        canvas.append(head);
        const rowsWrap = document.createElement('div');
        rowsWrap.className = 'chart-rows';
        rowsWrap.style.position = 'relative';
        rowsWrap.style.width = `${geo.columns * DAY_WIDTH}px`;
        rowsWrap.style.height = `${rows.length * ROW_HEIGHT}px`;
        const bars = new Map();
        for (const [index, { item }] of rows.entries()) {
            const row = document.createElement('div');
            row.className = 'chart-row';
            row.style.position = 'absolute';
            row.style.top = `${index * ROW_HEIGHT}px`;
            row.style.left = '0';
            row.style.right = '0';
            row.style.height = `${ROW_HEIGHT}px`;
            rowsWrap.append(row);
            if (item.kind !== 'group' && item.start !== null && item.end !== null) {
                const left = dateToColumn(geo.chartStart, item.start) * DAY_WIDTH;
                const width = (dateToColumn(geo.chartStart, item.end) + 1) * DAY_WIDTH - left;
                const bar = document.createElement('div');
                bar.className = `bar${item.kind === 'milestone' ? ' milestone' : ''}${item.critical ? ' critical' : ''}`;
                bar.style.top = `${index * ROW_HEIGHT + 12}px`;
                bar.dataset.itemId = item.id;
                bar.dataset.kind = item.kind;
                bar.dataset.start = item.start;
                bar.dataset.end = item.end;
                bar.dataset.duration = String(item.duration);
                bar.dataset.percent = String(item.percent);
                bar.dataset.critical = String(item.critical);
                bar.dataset.late = String(item.late);
                if (item.baseline !== null) {
                    bar.dataset.variance = String(item.baseline.variance);
                    bar.dataset.baselineStart = item.baseline.start;
                    bar.dataset.baselineEnd = item.baseline.end;
                }
                if (callbacks.highlightCritical && !item.critical)
                    bar.dataset.dimmed = 'true';
                if (callbacks.viewer)
                    bar.setAttribute('aria-disabled', 'true');
                bar.setAttribute('role', 'button');
                bar.tabIndex = -1;
                bar.style.left = `${left}px`;
                bar.style.width = `${Math.max(DAY_WIDTH, width)}px`;
                const lateWord = item.late ? ' Late' : '';
                bar.setAttribute('aria-label', `${item.name}${lateWord}`);
                const descriptionId = `desc-${item.id}`;
                bar.setAttribute('aria-describedby', descriptionId);
                if (item.kind === 'task') {
                    const startHandle = document.createElement('span');
                    startHandle.className = 'handle';
                    startHandle.dataset.handle = 'start';
                    const endHandle = document.createElement('span');
                    endHandle.className = 'handle';
                    endHandle.dataset.handle = 'end';
                    bar.append(startHandle, endHandle);
                }
                if (item.late) {
                    const word = document.createElement('span');
                    word.className = 'late-word';
                    word.textContent = 'Late';
                    bar.append(word);
                }
                const described = document.createElement('span');
                described.id = descriptionId;
                described.className = 'visually-hidden';
                described.textContent = barDescription(project, item);
                bar.addEventListener('keydown', (event) => {
                    const current = itemOf(item.id);
                    if (current !== undefined)
                        barKeydown(event, current);
                });
                bar.addEventListener('pointerdown', (event) => {
                    const current = itemOf(item.id);
                    if (current === undefined)
                        return;
                    beginDrag(event, current, bar);
                });
                bar.addEventListener('pointermove', (event) => {
                    const current = itemOf(item.id);
                    if (current === undefined)
                        return;
                    dragMove(event, bar, current);
                });
                bar.addEventListener('pointerup', (event) => {
                    const current = itemOf(item.id);
                    if (current === undefined)
                        return;
                    endDrag(event, current);
                });
                bar.addEventListener('pointercancel', () => cancelDrag());
                bar.addEventListener('focus', () => {
                    focusedId = item.id;
                });
                bar.addEventListener('click', () => {
                    focusedId = item.id;
                    bar.focus();
                });
                bars.set(item.id, bar);
                rowsWrap.append(bar, described);
            }
            else if (item.kind === 'group' && item.start !== null && item.end !== null) {
                const left = dateToColumn(geo.chartStart, item.start) * DAY_WIDTH;
                const width = (dateToColumn(geo.chartStart, item.end) + 1) * DAY_WIDTH - left;
                const bar = document.createElement('div');
                bar.className = 'bar group-bar';
                bar.dataset.itemId = item.id;
                bar.dataset.kind = 'group';
                bar.dataset.start = item.start;
                bar.dataset.end = item.end;
                bar.dataset.duration = String(item.duration);
                bar.dataset.percent = String(item.percent);
                bar.dataset.critical = 'false';
                bar.dataset.late = String(item.late);
                bar.style.left = `${left}px`;
                bar.style.width = `${Math.max(DAY_WIDTH, width)}px`;
                bar.style.top = `${index * ROW_HEIGHT + 17}px`;
                bar.setAttribute('aria-hidden', 'true');
                rowsWrap.append(bar);
            }
        }
        // Float tails.
        for (const [index, { item }] of rows.entries()) {
            if (item.kind === 'group' || item.float === null || item.float <= 0 || item.end === null)
                continue;
            const tail = document.createElement('div');
            tail.className = 'float-tail';
            tail.style.left = `${(dateToColumn(geo.chartStart, item.end) + 1) * DAY_WIDTH}px`;
            tail.style.width = `${item.float * DAY_WIDTH}px`;
            tail.style.top = `${index * ROW_HEIGHT + 21}px`;
            rowsWrap.append(tail);
        }
        // Link connectors.
        for (const link of project.links) {
            const from = itemOf(link.from);
            const to = itemOf(link.to);
            if (from === undefined || to === undefined || from.end === null || to.start === null)
                continue;
            const fromRow = rows.findIndex((entry) => entry.item.id === link.from);
            const toRow = rows.findIndex((entry) => entry.item.id === link.to);
            const fromColumn = dateToColumn(geo.chartStart, from.end) + 1;
            const toColumn = dateToColumn(geo.chartStart, to.start);
            const y1 = fromRow * ROW_HEIGHT + 22;
            const y2 = toRow * ROW_HEIGHT + 22;
            const startPx = fromColumn * DAY_WIDTH;
            const endPx = toColumn * DAY_WIDTH;
            const lines = [
                { left: startPx, top: y1, width: Math.max(6, endPx - startPx - 4) },
            ];
            if (y1 !== y2) {
                lines.push({ left: endPx - 4, top: Math.min(y1, y2), height: Math.abs(y2 - y1) });
                lines.push({ left: endPx - 4, top: y2, width: 4 });
            }
            lines.push({ left: endPx - 8, top: y2, width: 8, arrow: true });
            const anchor = document.createElement('div');
            anchor.dataset.linkId = link.id;
            anchor.dataset.from = link.from;
            anchor.dataset.to = link.to;
            anchor.dataset.type = link.type;
            anchor.dataset.lag = String(link.lag);
            anchor.dataset.critical = String(link.critical);
            anchor.style.display = 'none';
            rowsWrap.append(anchor);
            for (const line of lines) {
                const el = document.createElement('div');
                el.className = `link-line ${line.height !== undefined ? 'vertical' : 'horizontal'}${line.arrow === true ? ' arrow' : ''}${link.critical ? ' critical' : ''}`;
                el.style.left = `${line.left}px`;
                el.style.top = `${line.top}px`;
                if (line.width !== undefined)
                    el.style.width = `${line.width}px`;
                if (line.height !== undefined)
                    el.style.height = `${line.height}px`;
                rowsWrap.append(el);
            }
        }
        if (geo.todayColumn !== null && geo.todayColumn >= 0 && geo.todayColumn < geo.columns) {
            const today = document.createElement('div');
            today.className = 'today-line';
            today.id = 'today-line';
            today.dataset.date = callbacks.config.today;
            today.style.left = `${geo.todayColumn * DAY_WIDTH}px`;
            today.style.top = '0';
            today.style.height = '100%';
            rowsWrap.append(today);
        }
        if (geo.finishColumn !== null) {
            const finish = document.createElement('div');
            finish.className = 'finish-marker';
            finish.id = 'finish-marker';
            finish.dataset.date = project.finish ?? '';
            finish.style.left = `${geo.finishColumn * DAY_WIDTH}px`;
            finish.style.top = '0';
            finish.style.height = '100%';
            rowsWrap.append(finish);
        }
        if (callbacks.showBaseline) {
            for (const [index, { item }] of rows.entries()) {
                if (item.baseline === null)
                    continue;
                const ghost = document.createElement('div');
                ghost.className = 'baseline-ghost';
                ghost.setAttribute('data-baseline-bar', '');
                ghost.dataset.itemId = item.id;
                ghost.dataset.start = item.baseline.start;
                ghost.dataset.end = item.baseline.end;
                const left = dateToColumn(geo.chartStart, item.baseline.start) * DAY_WIDTH;
                const width = (dateToColumn(geo.chartStart, item.baseline.end) + 1) * DAY_WIDTH - left;
                ghost.style.left = `${left}px`;
                ghost.style.width = `${Math.max(DAY_WIDTH, width)}px`;
                ghost.style.top = `${index * ROW_HEIGHT + 34}px`;
                rowsWrap.append(ghost);
            }
        }
        canvas.append(rowsWrap);
        // One tab stop across the bars, keeping focus on the same bar.
        const focusables = Array.from(bars.values());
        focusables.forEach((bar) => {
            bar.tabIndex = -1;
        });
        const focusedBar = focusedId !== null ? bars.get(focusedId) : undefined;
        if (focusedBar !== undefined) {
            focusedBar.tabIndex = 0;
            if (hadFocus)
                focusedBar.focus();
        }
        else if (focusables.length > 0) {
            focusables[0].tabIndex = 0;
        }
        drawTimeline();
    }
    function drawTimeline() {
        timeline.replaceChildren();
        for (const item of project.items) {
            const li = document.createElement('li');
            li.className = 'timeline-card';
            const top = document.createElement('div');
            top.className = 'card-top';
            const name = document.createElement('strong');
            name.textContent = item.name;
            top.append(name);
            const dates = document.createElement('span');
            if (item.kind === 'milestone' && item.start !== null)
                dates.textContent = longDate(item.start);
            else if (item.start !== null && item.end !== null)
                dates.textContent = `${shortDate(item.start)} - ${shortDate(item.end)}`;
            top.append(dates);
            li.append(top);
            const words = document.createElement('div');
            words.className = 'words';
            if (item.critical)
                words.append(Object.assign(document.createElement('span'), { textContent: 'Critical' }));
            if (item.late)
                words.append(Object.assign(document.createElement('span'), { textContent: 'Late' }));
            li.append(words);
            const percent = document.createElement('p');
            percent.textContent = `${item.percent}% complete`;
            li.append(percent);
            if (item.kind === 'task') {
                const button = document.createElement('button');
                button.textContent = `Update progress for ${item.name}`;
                button.addEventListener('click', () => callbacks.openProgressSheet(item.id, button));
                li.append(button);
            }
            timeline.append(li);
        }
    }
    draw(initialProject);
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && drag !== null)
            cancelDrag();
    });
    return {
        redraw(next) {
            draw(next);
        },
        playKnockOn(before, after, editedId) {
            draw(after);
            animateKnockOn(before, after, editedId);
        },
        focusedItemId() {
            return focusedId;
        },
        applyPresence(presence, meId) {
            const selectedBy = new Map();
            for (const person of presence) {
                if (person.userId === meId || person.selected === null)
                    continue;
                const list = selectedBy.get(person.selected) ?? [];
                list.push(person.name);
                selectedBy.set(person.selected, list);
            }
            for (const item of project.items) {
                const bar = canvas.querySelector(`[data-item-id="${item.id}"]`);
                if (bar === null)
                    continue;
                const names = (selectedBy.get(item.id) ?? []).sort();
                if (names.length === 0)
                    delete bar.dataset.selectedBy;
                else
                    bar.dataset.selectedBy = names.join(', ');
            }
        },
    };
    /** The knock-on: bars slide one dependency depth at a time, the finish marker last. */
    function animateKnockOn(before, after, editedId) {
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const geo = geometry(after, callbacks.config);
        const beforeById = new Map(before.items.map((item) => [item.id, item]));
        const sliders = [];
        for (const item of after.items) {
            if (item.id === editedId || item.kind === 'group' || item.start === null)
                continue;
            const was = beforeById.get(item.id);
            if (was === undefined || was.start === item.start)
                continue;
            const bar = canvas.querySelector(`[data-item-id="${item.id}"]`);
            if (bar === null)
                continue;
            const oldColumn = dateToColumn(geo.chartStart, was.start ?? '');
            const newColumn = dateToColumn(geo.chartStart, item.start ?? '');
            const depth = linkDepth(after, editedId, item.id);
            sliders.push({ bar, fromPx: (oldColumn - newColumn) * DAY_WIDTH, depth: Math.min(12, depth) });
        }
        const finishBefore = before.finish;
        const finishAfter = after.finish;
        const finishMarker = document.getElementById('finish-marker');
        const finishSlides = finishMarker !== null && finishBefore !== null && finishAfter !== null && finishBefore !== finishAfter
            ? (dateToColumn(geo.chartStart, finishBefore) - dateToColumn(geo.chartStart, finishAfter)) * DAY_WIDTH
            : 0;
        for (const item of after.items) {
            if (item.id === editedId)
                continue;
            const bar = canvas.querySelector(`[data-item-id="${item.id}"]`);
            if (bar === null)
                continue;
            bar.dataset.shifted = 'true';
        }
        if (reduced) {
            for (const item of after.items) {
                const bar = canvas.querySelector(`[data-item-id="${item.id}"]`);
                if (bar === null)
                    continue;
                bar.classList.add('underline-after-motion');
            }
            return;
        }
        const knockOnMs = callbacks.config.knockOnMs;
        const staggerMs = callbacks.config.knockOnStaggerMs;
        const finishMs = callbacks.config.finishMotionMs;
        const start = performance.now();
        let finishStarted = false;
        let finishDoneAt = 0;
        const step = (now) => {
            const e = now - start;
            let allSettled = true;
            for (const slider of sliders) {
                const delay = staggerMs * slider.depth;
                const raw = Math.min(1, Math.max(0, (e - delay) / knockOnMs));
                const progress = easeBezier(raw);
                const px = slider.fromPx * (1 - progress);
                if (progress < 1)
                    allSettled = false;
                if (px === 0) {
                    slider.bar.style.transform = '';
                    delete slider.bar.dataset.motion;
                }
                else {
                    slider.bar.style.transform = `translateX(${px}px)`;
                    slider.bar.dataset.motion = 'knock-on';
                }
            }
            if (allSettled && !finishStarted) {
                finishStarted = true;
                finishDoneAt = e + finishMs;
            }
            if (finishStarted && finishMarker !== null) {
                const raw = Math.min(1, Math.max(0, (e - (finishDoneAt - finishMs)) / finishMs));
                const progress = easeBezier(raw);
                const px = finishSlides * (1 - progress);
                if (px === 0) {
                    finishMarker.style.transform = '';
                    delete finishMarker.dataset.motion;
                }
                else {
                    finishMarker.style.transform = `translateX(${px}px)`;
                    finishMarker.dataset.motion = 'finish';
                }
            }
            const finishComplete = finishMarker === null || finishSlides === 0 ? true : finishStarted && e >= finishDoneAt;
            if (!allSettled || !finishComplete) {
                requestAnimationFrame(step);
            }
            else {
                for (const slider of sliders) {
                    slider.bar.style.transform = '';
                    delete slider.bar.dataset.motion;
                }
                if (finishMarker !== null) {
                    finishMarker.style.transform = '';
                    delete finishMarker.dataset.motion;
                }
            }
        };
        requestAnimationFrame(step);
    }
}
/** The cubic Bezier ease with control points (0.2, 0) and (0, 1). */
function easeBezier(t) {
    // Cubic Bezier through (0.2, 0) and (0, 1) evaluated by Newton steps on x.
    const cx1 = 0.2;
    const cy1 = 0;
    const cx2 = 0;
    const cy2 = 1;
    let x = t;
    for (let i = 0; i < 6; i += 1) {
        const c = 1 - x;
        const dx = 3 * c * c * cx1 + 6 * c * x * (cx2 - cx1) + 3 * x * x * (1 - cx2);
        if (Math.abs(dx) < 1e-6)
            break;
        const diff = 3 * c * c * x * cx1 + 3 * c * x * x * cx2 + x * x * x - t;
        x -= diff / dx;
    }
    const c = 1 - x;
    return 3 * c * c * x * cy1 + 3 * c * x * x * cy2 + x * x * x;
}
