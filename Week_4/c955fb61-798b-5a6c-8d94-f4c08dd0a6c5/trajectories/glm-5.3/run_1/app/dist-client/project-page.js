// The whole project page: header, tabs, toolbar, views, dialogs, live updates and the knock-on.
import { api, ApiFail, openLive } from "./api.js";
import { longDate, varianceText, weekMonday, hoursText, LINK_TYPE_WORDS } from "./api-types.js";
import { renderProjects, renderSignIn, renderSignUp, trapTabs, escapeHtml } from "./auth-pages.js";
import { renderGanttView, movedCountWords, finishWords } from "./gantt-view.js";
import { renderListView } from "./list-view.js";
import { renderWorkloadView } from "./workload-view.js";
let state = null;
let ganttView = null;
let listView = null;
let workloadView = null;
let workspaceId = null;
let taskDialog = null;
const app = () => document.getElementById('app');
function announce(id, message) {
    const node = document.getElementById(id);
    if (node === null)
        return;
    node.textContent = message;
}
function pageAlert(message) {
    const node = document.getElementById('page-alert');
    if (node === null)
        return;
    node.textContent = message;
}
// ---------------------------------------------------------------------------
// Boot and routing
async function boot() {
    const root = app();
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    if (path === '/signin') {
        renderSignIn(root, params.get('next') ?? '/');
        return;
    }
    if (path === '/signup') {
        renderSignUp(root, params.get('next') ?? '/');
        return;
    }
    let me;
    try {
        me = await api.me();
    }
    catch {
        const next = encodeURIComponent(`${path}${window.location.search}`);
        window.location.href = `/signin?next=${next}`;
        return;
    }
    if (path === '/' || path === '') {
        await renderProjects(root, me);
        return;
    }
    const match = /^\/projects\/([^/]+)$/.exec(path);
    if (match === null) {
        root.replaceChildren(noSuchProject());
        return;
    }
    await openProject(match[1], me);
}
function noSuchProject() {
    const div = document.createElement('div');
    div.className = 'page';
    const h = document.createElement('h1');
    h.textContent = 'No such project.';
    div.append(h);
    return div;
}
async function openProject(projectId, me) {
    const config = await api.config();
    let project;
    try {
        project = await api.project(projectId);
    }
    catch {
        app().replaceChildren(noSuchProject());
        return;
    }
    const role = await roleFor(me, projectId);
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view');
    const view = viewParam === 'list' || viewParam === 'workload' ? viewParam : 'gantt';
    const showBaseline = params.get('baseline') === 'on';
    const highlightCritical = params.get('critical') === 'on';
    const workloadFrom = params.get('from') ?? weekMonday(config.today);
    const exportsAnswer = await api.exports(projectId);
    state = {
        me,
        role,
        project,
        config,
        exports: exportsAnswer.exports,
        presence: [],
        view,
        showBaseline,
        highlightCritical,
        workloadFrom,
        workload: null,
    };
    renderPage();
    openLive(project.id, onLiveEvent);
    startPresence();
    const taskParam = params.get('task');
    if (taskParam !== null) {
        const item = project.items.find((entry) => entry.id === taskParam);
        if (item !== undefined)
            openTaskDetails(item.id, 'gantt');
    }
}
/** The role comes from the workspace membership, read with the project list. */
async function roleFor(me, projectId) {
    const projects = await api.projects();
    const mine = projects.projects.find((entry) => entry.id === projectId);
    if (mine === undefined)
        return 'viewer';
    workspaceId = mine.workspace.id;
    const workspace = me.workspaces.find((entry) => entry.id === mine.workspace.id);
    return workspace?.role ?? 'viewer';
}
function startPresence() {
    const tick = async () => {
        if (state === null)
            return;
        const selected = ganttView?.focusedItemId() ?? null;
        try {
            const result = await api.presence(state.project.id, selected);
            state.presence = result.people;
            updatePeopleHere();
            ganttView?.applyPresence(result.people, state.me.user.id);
        }
        catch {
            // Presence stops updating when the request fails.
        }
    };
    void tick();
    window.setInterval(tick, 1500);
}
// ---------------------------------------------------------------------------
// Live updates
function onLiveEvent(event) {
    if (state === null)
        return;
    if (event.kind === 'project') {
        const payload = event.payload;
        if (payload.project === null)
            return;
        const mine = payload.by === state.me.user.name;
        const before = state.project;
        state.project = payload.project;
        if (!mine) {
            announce('project-updates', projectUpdateSentence(payload.by, payload.kind, payload.item, before, payload.project));
        }
        updateHeader();
        if (state.view === 'gantt' && ganttView !== null) {
            ganttView.playKnockOn(before, state.project, payload.item);
        }
        else if (state.view === 'list' && listView !== null) {
            listView.update(state.project);
        }
        else if (state.view === 'workload') {
            void loadWorkload();
        }
        taskDialog?.onProjectChanged(payload.project);
    }
    else if (event.kind === 'presence') {
        const payload = event.payload;
        state.presence = payload.people;
        updatePeopleHere();
        ganttView?.applyPresence(payload.people, state.me.user.id);
    }
    else if (event.kind === 'comment') {
        const payload = event.payload;
        if (payload.comment.author.userId !== state.me.user.id) {
            taskDialog?.onLiveComment(payload.itemId, payload.comment);
        }
    }
    else if (event.kind === 'export') {
        const payload = event.payload;
        state.exports = payload.exports;
        renderExports();
    }
}
function projectUpdateSentence(by, kind, itemId, before, after) {
    if (kind === 'holiday')
        return `${by} changed the holidays.`;
    if (kind === 'baseline')
        return `${by} saved the baseline.`;
    if (itemId === null)
        return `${by} changed the plan.`;
    const item = after.items.find((entry) => entry.id === itemId) ?? before.items.find((entry) => entry.id === itemId);
    const name = item?.name ?? 'the plan';
    if (kind === 'add')
        return `${by} added ${name}.`;
    if (kind === 'delete')
        return `${by} deleted ${name}.`;
    if (kind === 'comment')
        return `${by} commented on ${name}.`;
    return `${by} changed ${name}.`;
}
// ---------------------------------------------------------------------------
// Page rendering
function renderPage() {
    if (state === null)
        return;
    const root = app();
    const page = document.createElement('div');
    page.className = 'page';
    page.id = 'project-page';
    const header = document.createElement('header');
    header.className = 'project-header';
    const facts = document.createElement('div');
    facts.innerHTML = `
    <h1>${escapeHtml(state.project.name)}</h1>
    <div class="header-facts">
      <p id="project-finish"></p>
      <p id="finish-variance" hidden></p>
      <p id="critical-count"></p>
    </div>
  `;
    const people = document.createElement('div');
    people.innerHTML = `<ul id="people-here" aria-label="People here"></ul>`;
    header.append(facts, people);
    page.append(header);
    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'View');
    for (const name of ['gantt', 'list', 'workload']) {
        const tab = document.createElement('button');
        tab.setAttribute('role', 'tab');
        tab.textContent = name === 'gantt' ? 'Gantt' : name === 'list' ? 'List' : 'Workload';
        tab.id = `tab-${name}`;
        tab.setAttribute('aria-selected', state.view === name ? 'true' : 'false');
        tab.tabIndex = state.view === name ? 0 : -1;
        tab.addEventListener('click', () => selectView(name));
        tab.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
                return;
            const order = ['gantt', 'list', 'workload'];
            const at = order.indexOf(name);
            const next = event.key === 'ArrowRight' ? order[(at + 1) % 3] : order[(at + 2) % 3];
            selectView(next);
            document.getElementById(`tab-${next}`).focus();
        });
        tabs.append(tab);
    }
    page.append(tabs);
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.id = 'toolbar';
    const baselineCheck = document.createElement('input');
    baselineCheck.type = 'checkbox';
    baselineCheck.id = 'show-baseline';
    baselineCheck.checked = state.showBaseline;
    const baselineLabel = document.createElement('label');
    baselineLabel.append(baselineCheck, Object.assign(document.createElement('span'), { textContent: 'Show baseline' }));
    baselineCheck.addEventListener('change', () => {
        if (state === null)
            return;
        state.showBaseline = baselineCheck.checked;
        setParam('baseline', baselineCheck.checked ? 'on' : null);
        renderViewPanel();
    });
    const criticalCheck = document.createElement('input');
    criticalCheck.type = 'checkbox';
    criticalCheck.id = 'highlight-critical';
    criticalCheck.checked = state.highlightCritical;
    const criticalLabel = document.createElement('label');
    criticalLabel.append(criticalCheck, Object.assign(document.createElement('span'), { textContent: 'Highlight critical path' }));
    criticalCheck.addEventListener('change', () => {
        if (state === null)
            return;
        state.highlightCritical = criticalCheck.checked;
        setParam('critical', criticalCheck.checked ? 'on' : null);
        renderViewPanel();
    });
    const saveBaselineButton = document.createElement('button');
    saveBaselineButton.textContent = 'Save baseline';
    if (state.role === 'viewer')
        saveBaselineButton.setAttribute('aria-disabled', 'true');
    saveBaselineButton.addEventListener('click', () => {
        if (state === null)
            return;
        if (state.role === 'viewer') {
            pageAlert('You can view this project but not change it.');
            return;
        }
        openBaselineDialog();
    });
    const holidaysButton = document.createElement('button');
    holidaysButton.textContent = 'Holidays';
    holidaysButton.id = 'holidays-button';
    if (state.role === 'viewer')
        holidaysButton.setAttribute('aria-disabled', 'true');
    holidaysButton.addEventListener('click', () => {
        if (state === null)
            return;
        if (state.role === 'viewer') {
            pageAlert('You can view this project but not change it.');
            return;
        }
        openHolidaysDialog();
    });
    const exportButton = document.createElement('button');
    exportButton.textContent = 'Export';
    exportButton.id = 'export-button';
    exportButton.setAttribute('aria-haspopup', 'menu');
    exportButton.addEventListener('click', () => openExportMenu(exportButton));
    exportButton.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openExportMenu(exportButton);
        }
    });
    toolbar.append(baselineLabel, criticalLabel, saveBaselineButton, holidaysButton, exportButton);
    page.append(toolbar);
    const statuses = document.createElement('div');
    statuses.className = 'statuses';
    statuses.innerHTML = `
    <p id="schedule-updates" role="status" aria-live="polite" class="visually-hidden"></p>
    <p id="project-updates" role="status" aria-live="polite" class="visually-hidden"></p>
    <p id="export-status" role="status" aria-live="polite" class="visually-hidden"></p>
  `;
    page.append(statuses);
    const alert = document.createElement('p');
    alert.id = 'page-alert';
    alert.className = 'page-alert';
    alert.setAttribute('role', 'alert');
    page.append(alert);
    const panel = document.createElement('div');
    panel.id = 'view-panel';
    page.append(panel);
    const exportsRegion = document.createElement('section');
    exportsRegion.className = 'exports';
    exportsRegion.setAttribute('role', 'region');
    exportsRegion.setAttribute('aria-label', 'Exports');
    exportsRegion.id = 'exports-region';
    page.append(exportsRegion);
    root.replaceChildren(page);
    renderViewPanel();
    updateHeader();
    renderExports();
    updatePeopleHere();
}
function renderViewPanel() {
    if (state === null)
        return;
    const panel = document.getElementById('view-panel');
    if (panel === null)
        return;
    ganttView = null;
    listView = null;
    workloadView = null;
    panel.replaceChildren();
    if (state.project.items.length === 0 && state.view !== 'list' && state.view !== 'workload') {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        const sentence = document.createElement('p');
        sentence.textContent = 'No tasks yet. Add the first task in the list.';
        const button = document.createElement('button');
        button.textContent = 'Open the list';
        button.addEventListener('click', () => selectView('list'));
        empty.append(sentence, button);
        panel.append(empty);
        return;
    }
    if (state.view === 'gantt') {
        ganttView = renderGanttView(panel, state.project, {
            patchItem: (item, body) => performPatch(item, body),
            onAnnounce: (message) => announce('schedule-updates', message),
            onOpenDetails: (itemId) => openTaskDetails(itemId, 'gantt'),
            onOpenLink: (itemId) => openAddLinkDialog(itemId),
            openProgressSheet: (itemId, opener) => openProgressSheet(itemId, opener),
            viewer: state.role === 'viewer',
            config: state.config,
            showBaseline: state.showBaseline,
            highlightCritical: state.highlightCritical,
            meId: state.me.user.id,
        });
    }
    else if (state.view === 'list') {
        listView = renderListView(panel, state.project, {
            createItem: async (name, kind) => {
                const result = await api.createItem(state.project.id, { name, kind });
                await reloadProject();
                return result;
            },
            patchItem: async (item, body) => performPatch(item, body),
            setPredecessors: async (item, text) => {
                try {
                    const result = await api.predecessors(item.id, item.version, text);
                    await reloadProject();
                    return result;
                }
                catch (error) {
                    handleEditError(error);
                    throw error;
                }
            },
            reorder: async (item, direction) => {
                const result = await api.reorder(item.id, direction);
                await reloadProject();
                return result;
            },
            openDetails: (itemId) => openTaskDetails(itemId, 'list'),
            onAnnounce: (message) => announce('schedule-updates', message),
            onPageAlert: pageAlert,
            viewer: state.role === 'viewer',
            project: () => state.project,
        });
    }
    else {
        workloadView = renderWorkloadView(panel, state.workload, state.workloadFrom, {
            onFromChange: (from) => {
                if (state === null)
                    return;
                state.workloadFrom = from;
                setParam('from', from);
                void loadWorkload();
            },
            onOpenDay: (personName, date, day) => openDayDialog(personName, date, day),
        });
        if (state.workload === null)
            void loadWorkload();
    }
}
async function performPatch(item, body) {
    if (state === null)
        throw new Error('no state');
    try {
        const result = await api.patchItem(item.id, { baseVersion: item.version, ...body });
        const before = state.project;
        state.project = await api.project(state.project.id);
        if (state.view === 'gantt' && ganttView !== null) {
            ganttView.playKnockOn(before, state.project, item.id);
        }
        else if (state.view === 'list' && listView !== null) {
            listView.update(state.project);
        }
        return { moved: result.moved.length, finish: result.finish };
    }
    catch (error) {
        handleEditError(error);
        throw error;
    }
}
/** A refused edit: show the published alert and put the server's state on screen. */
function handleEditError(error) {
    if (error instanceof ApiFail) {
        if (error.status === 409 && error.body.error === 'version_conflict') {
            const by = String(error.body.by ?? '');
            const item = error.body.item;
            pageAlert(`${by} changed ${item?.name ?? 'the task'} first. Your change was not saved.`);
            if (item !== undefined && state !== null) {
                const index = state.project.items.findIndex((entry) => entry.id === item.id);
                if (index !== -1) {
                    state.project = { ...state.project, items: state.project.items.map((entry, at) => (at === index ? item : entry)) };
                    if (state.view === 'gantt' && ganttView !== null)
                        ganttView.redraw(state.project);
                    if (state.view === 'list' && listView !== null)
                        listView.update(state.project);
                }
            }
            return;
        }
        if (error.status === 403) {
            pageAlert('You can view this project but not change it.');
            return;
        }
        if (typeof error.body.message === 'string') {
            pageAlert(error.body.message);
            return;
        }
        if (typeof error.body.field === 'string') {
            const messages = {
                name: 'Name must be 1 to 120 characters.',
                start: 'Enter a date as YYYY-MM-DD.',
                duration: 'Duration must be a whole number from 0 to 999.',
                percent: 'Percent complete must be a whole number from 0 to 100.',
            };
            pageAlert(messages[error.body.field] ?? 'Your change could not be saved. Try again.');
            return;
        }
    }
    pageAlert('Your change could not be saved. Try again.');
}
async function reloadProject() {
    if (state === null)
        return;
    try {
        const project = await api.project(state.project.id);
        const before = state.project;
        state.project = project;
        updateHeader();
        if (state.view === 'gantt' && ganttView !== null) {
            ganttView.playKnockOn(before, project, null);
        }
        else if (state.view === 'list' && listView !== null) {
            listView.update(project);
        }
        else if (state.view === 'workload') {
            void loadWorkload();
        }
    }
    catch {
        pageAlert('Your change could not be saved. Try again.');
    }
}
async function loadWorkload() {
    if (state === null || workspaceId === null)
        return;
    const workload = await api.workload(workspaceId, state.workloadFrom);
    if (state === null)
        return;
    state.workload = workload;
    workloadView?.update(workload);
}
function selectView(view) {
    if (state === null)
        return;
    state.view = view;
    setParam('view', view === 'gantt' ? null : view);
    for (const name of ['gantt', 'list', 'workload']) {
        const tab = document.getElementById(`tab-${name}`);
        if (tab === null)
            continue;
        tab.setAttribute('aria-selected', name === view ? 'true' : 'false');
        tab.tabIndex = name === view ? 0 : -1;
    }
    renderViewPanel();
}
function setParam(name, value) {
    const url = new URL(window.location.href);
    if (value === null)
        url.searchParams.delete(name);
    else
        url.searchParams.set(name, value);
    window.history.replaceState(null, '', url);
}
function updateHeader() {
    if (state === null)
        return;
    const finish = document.getElementById('project-finish');
    const variance = document.getElementById('finish-variance');
    const critical = document.getElementById('critical-count');
    if (finish !== null) {
        finish.textContent = state.project.finish === null ? 'No finish date yet' : `Finishes ${longDate(state.project.finish)}`;
    }
    if (variance !== null) {
        if (state.project.baseline === null)
            variance.hidden = true;
        else {
            variance.hidden = false;
            variance.textContent = varianceText(state.project.baseline.finishVariance);
        }
    }
    if (critical !== null) {
        const count = state.project.items.filter((item) => item.kind !== 'group' && item.critical).length;
        critical.textContent = count === 0 ? 'No critical tasks' : count === 1 ? '1 critical task' : `${count} critical tasks`;
    }
}
function updatePeopleHere() {
    const current = state;
    if (current === null)
        return;
    const ul = document.getElementById('people-here');
    if (ul === null)
        return;
    ul.replaceChildren();
    const meId = current.me.user.id;
    const mine = current.presence.find((person) => person.userId === meId);
    const others = current.presence
        .filter((person) => person.userId !== meId)
        .sort((a, b) => a.name.localeCompare(b.name));
    const ordered = mine === undefined ? others : [mine, ...others];
    for (const person of ordered) {
        const li = document.createElement('li');
        li.textContent = person.userId === meId ? `${person.name} (you)` : person.name;
        ul.append(li);
    }
}
function renderExports() {
    if (state === null)
        return;
    const region = document.getElementById('exports-region');
    if (region === null)
        return;
    region.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = 'Exports';
    region.append(heading);
    if (state.exports.length === 0)
        return;
    const ul = document.createElement('ul');
    for (const [index, row] of state.exports.entries()) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = row.downloadUrl;
        a.textContent = `Download ${row.filename}`;
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = `${row.format.toUpperCase()} ${new Date(row.createdAt).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}`;
        li.append(a, meta);
        if (index === 0) {
            const ready = document.createElement('span');
            ready.className = 'ready';
            ready.textContent = 'Ready';
            li.append(ready);
        }
        ul.append(li);
    }
    region.append(ul);
}
// ---------------------------------------------------------------------------
// Export menu
function openExportMenu(opener) {
    document.querySelector('.menu')?.remove();
    const menu = document.createElement('ul');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Export');
    const items = [
        { label: 'Export CSV', format: 'csv' },
        { label: 'Export PDF', format: 'pdf' },
    ];
    const buttons = [];
    for (const entry of items) {
        const li = document.createElement('li');
        li.setAttribute('role', 'none');
        const button = document.createElement('button');
        button.setAttribute('role', 'menuitem');
        button.textContent = entry.label;
        button.addEventListener('click', () => {
            close();
            void runExport(entry.format);
        });
        li.append(button);
        menu.append(li);
        buttons.push(button);
    }
    const rect = opener.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.position = 'fixed';
    document.body.append(menu);
    buttons[0].focus();
    const close = () => {
        menu.remove();
        document.removeEventListener('keydown', onKeydown, true);
        opener.focus();
    };
    const onKeydown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
        }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const at = buttons.indexOf(document.activeElement);
            const next = event.key === 'ArrowDown' ? (at + 1) % buttons.length : (at + buttons.length - 1) % buttons.length;
            buttons[next].focus();
        }
        else if (event.key === 'Tab') {
            event.preventDefault();
            close();
        }
    };
    document.addEventListener('keydown', onKeydown, true);
}
async function runExport(format) {
    if (state === null)
        return;
    announce('export-status', `Preparing the ${format.toUpperCase()} export.`);
    try {
        const row = await api.createExport(state.project.id, format);
        const list = await api.exports(state.project.id);
        state.exports = list.exports;
        renderExports();
        announce('export-status', `${row.filename} is ready to download.`);
    }
    catch (error) {
        if (error instanceof ApiFail && error.status === 503) {
            const message = 'File storage is unavailable. Your export was not saved. Try again later.';
            announce('export-status', message);
            pageAlert(message);
        }
        else {
            announce('export-status', 'Your change could not be saved. Try again.');
        }
    }
}
// ---------------------------------------------------------------------------
// Holidays dialog
function openHolidaysDialog() {
    if (state === null)
        return;
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Holidays');
    dialog.innerHTML = `
    <form class="dialog-body" method="dialog">
      <h2>Holidays</h2>
      <ul id="holidays-list" aria-label="Holidays"></ul>
      <label>Date <input name="date" inputmode="numeric" placeholder="YYYY-MM-DD"></label>
      <label>Holiday name <input name="name"></label>
      <p class="alert" role="alert" id="holidays-alert" hidden></p>
      <div class="dialog-actions">
        <button type="submit" class="primary">Add holiday</button>
        <button type="button" data-cancel>Cancel</button>
      </div>
    </form>
  `;
    document.body.append(dialog);
    const list = dialog.querySelector('#holidays-list');
    const alert = dialog.querySelector('#holidays-alert');
    function drawList() {
        if (state === null)
            return;
        list.replaceChildren();
        for (const holiday of state.project.holidays) {
            const li = document.createElement('li');
            li.textContent = `${longDate(holiday.date)} ${holiday.name}`;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = `Remove ${holiday.name}`;
            remove.addEventListener('click', async () => {
                if (state === null)
                    return;
                const before = state.project;
                try {
                    await api.removeHoliday(state.project.id, holiday.date);
                    const project = await api.project(state.project.id);
                    state.project = project;
                    updateHeader();
                    if (state.view === 'gantt' && ganttView !== null)
                        ganttView.playKnockOn(before, project, null);
                    if (state.view === 'list' && listView !== null)
                        listView.update(project);
                    const moved = countMoved(before, project, null);
                    const words = moved === 0 ? 'No tasks moved.' : moved === 1 ? '1 task moved.' : `${moved} tasks moved.`;
                    const finish = project.finish;
                    announce('schedule-updates', `Holiday ${holiday.name} removed. ${words}${finish === null ? '' : ` Project finishes ${longDate(finish)}.`}`);
                    drawList();
                    alert.hidden = true;
                }
                catch {
                    alert.textContent = 'Your change could not be saved. Try again.';
                    alert.hidden = false;
                }
            });
            li.append(remove);
            list.append(li);
        }
    }
    drawList();
    trapTabs(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());
    const form = dialog.querySelector('form');
    const dateInput = form.elements.namedItem('date');
    const nameInput = form.elements.namedItem('name');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (state === null)
            return;
        const date = dateInput.value.trim();
        const name = nameInput.value.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            alert.textContent = 'Enter a date as YYYY-MM-DD.';
            alert.hidden = false;
            return;
        }
        if (name.length < 1 || name.length > 60) {
            alert.textContent = 'Holiday name must be 1 to 60 characters.';
            alert.hidden = false;
            return;
        }
        const [y, m, d] = date.split('-').map(Number);
        const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        if (dow === 6 || dow === 0) {
            alert.textContent = 'That date is a weekend.';
            alert.hidden = false;
            return;
        }
        if (state.project.holidays.some((holiday) => holiday.date === date)) {
            alert.textContent = 'That date is already a holiday.';
            alert.hidden = false;
            return;
        }
        const before = state.project;
        try {
            await api.addHoliday(state.project.id, { date, name });
            const project = await api.project(state.project.id);
            state.project = project;
            updateHeader();
            if (state.view === 'gantt' && ganttView !== null)
                ganttView.playKnockOn(before, project, null);
            if (state.view === 'list' && listView !== null)
                listView.update(project);
            const moved = countMoved(before, project, null);
            const words = moved === 0 ? 'No tasks moved.' : moved === 1 ? '1 task moved.' : `${moved} tasks moved.`;
            const finish = project.finish;
            announce('schedule-updates', `Holiday ${name} added. ${words}${finish === null ? '' : ` Project finishes ${longDate(finish)}.`}`);
            drawList();
            dateInput.value = '';
            nameInput.value = '';
            alert.hidden = true;
        }
        catch (error) {
            if (error instanceof ApiFail && error.status === 422 && typeof error.body.field === 'string') {
                alert.textContent = error.body.field === 'date' ? 'Enter a date as YYYY-MM-DD.' : 'Holiday name must be 1 to 60 characters.';
            }
            else if (error instanceof ApiFail && error.status === 422) {
                alert.textContent = 'That date is a weekend.';
            }
            else if (error instanceof ApiFail && error.status === 409) {
                alert.textContent = 'That date is already a holiday.';
            }
            else {
                alert.textContent = 'Your change could not be saved. Try again.';
            }
            alert.hidden = false;
        }
    });
    dialog.showModal();
    dateInput.focus();
}
/** Items other than the edited one whose shown start or end changed, groups excluded. */
function countMoved(before, after, editedId) {
    const beforeById = new Map(before.items.map((item) => [item.id, item]));
    let count = 0;
    for (const item of after.items) {
        if (item.id === editedId || item.kind === 'group')
            continue;
        const was = beforeById.get(item.id);
        if (was === undefined)
            continue;
        if (was.start !== item.start || was.end !== item.end)
            count += 1;
    }
    return count;
}
// ---------------------------------------------------------------------------
// Baseline dialog
function openBaselineDialog() {
    if (state === null)
        return;
    const existing = state.project.baseline;
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Save baseline');
    dialog.innerHTML = `
    <form class="dialog-body" method="dialog" id="baseline-form">
      <h2>Save baseline</h2>
      ${existing !== null ? `<p id="replace-note">This replaces the baseline ${escapeHtml(existing.name)}.</p>` : ''}
      <label>Baseline name <input name="name"></label>
      <p class="alert" role="alert" id="baseline-alert" hidden></p>
      <div class="dialog-actions">
        <button type="submit" class="primary">Save baseline</button>
        <button type="button" data-cancel>Cancel</button>
      </div>
    </form>
  `;
    document.body.append(dialog);
    const alert = dialog.querySelector('#baseline-alert');
    trapTabs(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());
    const form = dialog.querySelector('#baseline-form');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (state === null)
            return;
        const nameInput = form.elements.namedItem('name');
        const name = nameInput.value.trim();
        if (name.length < 1 || name.length > 60) {
            alert.textContent = 'Baseline name must be 1 to 60 characters.';
            alert.hidden = false;
            return;
        }
        try {
            await api.saveBaseline(state.project.id, { name, replace: existing !== null });
            await reloadProject();
            announce('schedule-updates', `Baseline ${name} saved.`);
            form.remove();
            const set = document.createElement('div');
            set.className = 'baseline-set full-yellow';
            set.innerHTML = `<h2>Baseline set</h2><p>${escapeHtml(name)}</p>`;
            const back = document.createElement('button');
            back.className = 'primary';
            back.textContent = 'Back to plan';
            back.addEventListener('click', () => dialog.close());
            set.append(back);
            dialog.append(set);
            back.focus();
        }
        catch {
            alert.textContent = 'Your change could not be saved. Try again.';
            alert.hidden = false;
        }
    });
    dialog.showModal();
    dialog.querySelector('input[name="name"]').focus();
}
// ---------------------------------------------------------------------------
// Add link dialog
function openAddLinkDialog(itemId) {
    if (state === null)
        return;
    const from = state.project.items.find((entry) => entry.id === itemId);
    if (from === undefined)
        return;
    const candidates = state.project.items.filter((entry) => entry.kind !== 'group' && entry.id !== itemId);
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Add link');
    dialog.innerHTML = `
    <form class="dialog-body" method="dialog" id="link-form">
      <h2>Link from ${escapeHtml(from.name)}</h2>
      <label>Successor
        <input name="successor" role="combobox" aria-expanded="true" aria-controls="link-options" autocomplete="off">
        <ul class="option-list" id="link-options" role="listbox"></ul>
      </label>
      <fieldset>
        <legend>Link type</legend>
        <div role="radiogroup" aria-label="Link type" id="link-types" style="display:grid;gap:6px;">
          <label><input type="radio" name="type" value="FS" checked> Finish to start</label>
          <label><input type="radio" name="type" value="SS"> Start to start</label>
          <label><input type="radio" name="type" value="FF"> Finish to finish</label>
          <label><input type="radio" name="type" value="SF"> Start to finish</label>
        </div>
      </fieldset>
      <label>Lag in working days <input name="lag" type="number" value="0" min="-30" max="30"></label>
      <p class="alert" role="alert" id="link-alert" hidden></p>
      <div class="dialog-actions">
        <button type="submit" class="primary">Add link</button>
        <button type="button" data-cancel>Cancel</button>
      </div>
    </form>
  `;
    document.body.append(dialog);
    const alert = dialog.querySelector('#link-alert');
    const optionsList = dialog.querySelector('#link-options');
    const successorInput = dialog.querySelector('input[name="successor"]');
    let chosen = null;
    function drawOptions(filter) {
        optionsList.replaceChildren();
        const lowered = filter.toLowerCase();
        const matches = candidates.filter((entry) => entry.name.toLowerCase().includes(lowered) || String(entry.row).includes(filter.trim()));
        for (const entry of matches) {
            const li = document.createElement('li');
            li.setAttribute('role', 'option');
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = `${entry.row} ${entry.name}`;
            button.setAttribute('aria-selected', chosen !== null && chosen.id === entry.id ? 'true' : 'false');
            button.addEventListener('click', () => {
                chosen = entry;
                successorInput.value = `${entry.row} ${entry.name}`;
                optionsList.replaceChildren();
            });
            li.append(button);
            optionsList.append(li);
        }
    }
    drawOptions('');
    successorInput.addEventListener('input', () => drawOptions(successorInput.value));
    successorInput.addEventListener('keydown', (event) => {
        const buttons = Array.from(optionsList.querySelectorAll('button'));
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (buttons.length === 0)
                return;
            const at = buttons.indexOf(document.activeElement);
            const next = event.key === 'ArrowDown' ? Math.min(at + 1, buttons.length - 1) : Math.max(at - 1, 0);
            buttons[at === -1 ? 0 : next].focus();
        }
        else if (event.key === 'Enter') {
            event.preventDefault();
            const focused = document.activeElement;
            const button = focused.tagName === 'BUTTON' ? focused : buttons[0];
            button?.click();
        }
    });
    trapTabs(dialog);
    dialog.addEventListener('close', () => {
        dialog.remove();
        restoreFocusToBar(itemId);
    });
    dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());
    const form = dialog.querySelector('#link-form');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (state === null || chosen === null) {
            alert.textContent = 'Choose a successor.';
            alert.hidden = false;
            return;
        }
        const type = form.elements.namedItem('type').value;
        const lag = Number(form.elements.namedItem('lag').value || '0');
        if (!Number.isInteger(lag) || lag < -30 || lag > 30) {
            alert.textContent = 'Lag must be between -30 and 30 working days.';
            alert.hidden = false;
            return;
        }
        if (state.project.links.some((link) => link.from === itemId && link.to === chosen.id)) {
            alert.textContent = 'Those tasks are already linked.';
            alert.hidden = false;
            return;
        }
        try {
            const result = await api.createLink(state.project.id, { from: itemId, to: chosen.id, type, lag });
            const project = await api.project(state.project.id);
            const before = state.project;
            state.project = project;
            updateHeader();
            if (state.view === 'gantt' && ganttView !== null)
                ganttView.playKnockOn(before, project, itemId);
            if (state.view === 'list' && listView !== null)
                listView.update(project);
            const typeWords = LINK_TYPE_WORDS[type];
            announce('schedule-updates', `Linked ${from.name} to ${chosen.name}, ${typeWords}, lag ${lag < 0 ? lag : lag}. ${movedCountWords(result.moved.length)}${finishWords(result.finish)}`);
            dialog.close();
        }
        catch (error) {
            if (error instanceof ApiFail) {
                if (error.body.error === 'duplicate_link')
                    alert.textContent = 'Those tasks are already linked.';
                else if (error.body.error === 'self_link')
                    alert.textContent = 'A task cannot wait for itself.';
                else if (error.body.error === 'group_link')
                    alert.textContent = 'Groups cannot be linked.';
                else if (typeof error.body.message === 'string')
                    alert.textContent = error.body.message;
                else if (typeof error.body.field === 'string')
                    alert.textContent = 'Lag must be between -30 and 30 working days.';
                else
                    alert.textContent = 'Your change could not be saved. Try again.';
            }
            else {
                alert.textContent = 'Your change could not be saved. Try again.';
            }
            alert.hidden = false;
        }
    });
    dialog.showModal();
    successorInput.focus();
}
function restoreFocusToBar(itemId) {
    window.setTimeout(() => {
        document.querySelector(`[data-item-id="${itemId}"]`)?.focus();
    }, 0);
}
function openTaskDetails(itemId, opener) {
    if (state === null)
        return;
    const found = state.project.items.find((entry) => entry.id === itemId);
    if (found === undefined)
        return;
    let item = found;
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Task details');
    document.body.append(dialog);
    const viewer = state.role === 'viewer';
    let version = item.version;
    let comments = [];
    const openerBar = document.querySelector(`[data-item-id="${itemId}"]`);
    function showAlert(message) {
        const alert = dialog.querySelector('#task-alert');
        if (alert === null)
            return;
        alert.textContent = message;
        alert.hidden = false;
    }
    function markInvalid(form, name) {
        const input = form.elements.namedItem(name);
        if (input !== null)
            input.setAttribute('aria-invalid', 'true');
    }
    function draw(keepFields) {
        if (state === null)
            return;
        const current = state.project.items.find((entry) => entry.id === itemId);
        // A pushed change redraws the chart behind the dialog but never changes its fields,
        // focus or the version it edits.
        if (current !== undefined) {
            item = current;
        }
        const itemNow = item;
        const nameField = dialog.querySelector('input[name="name"]');
        const startField = dialog.querySelector('input[name="start"]');
        const durationField = dialog.querySelector('input[name="duration"]');
        const percentField = dialog.querySelector('input[name="percent"]');
        const nameValue = keepFields && nameField !== null ? nameField.value : itemNow.name;
        const startValue = keepFields && startField !== null ? startField.value : itemNow.chosenStart ?? '';
        const durationValue = keepFields && durationField !== null ? durationField.value : String(itemNow.duration);
        const percentValue = keepFields && percentField !== null ? percentField.value : String(itemNow.percent);
        dialog.innerHTML = `
      <form class="dialog-body" method="dialog" id="task-form">
        <h2>Task details</h2>
        <label>Name <input name="name" value="${escapeHtml(nameValue)}" ${viewer ? 'readonly' : ''}></label>
        <label>Start <input name="start" value="${escapeHtml(startValue)}" ${viewer ? 'readonly' : ''}></label>
        ${itemNow.kind === 'group' ? '' : `<label>Duration <input name="duration" type="number" min="0" max="999" value="${durationValue}" ${viewer ? 'readonly' : ''}></label>
        <label>Percent complete <input name="percent" type="number" min="0" max="100" value="${percentValue}" ${viewer ? 'readonly' : ''}></label>`}
        ${itemNow.kind === 'task' ? `<div role="region" aria-label="Assignees" id="assignees-region"><h3>Assignees</h3></div>` : ''}
        <div role="region" aria-label="Comments" id="comments-region">
          <h3>Comments</h3>
          <ul id="comments-list" aria-label="Comments"></ul>
          ${viewer ? '' : `<label>New comment <textarea name="comment" rows="3"></textarea></label>
          <button type="button" id="post-comment" disabled>Post comment</button>`}
        </div>
        <p class="alert" role="alert" id="task-alert" hidden></p>
        <div class="dialog-actions">
          ${viewer ? '' : `<button type="submit" class="primary">Save task</button>
          <button type="button" id="delete-task">Delete task</button>`}
          <button type="button" data-cancel>Close</button>
        </div>
      </form>
    `;
        drawAssignees();
        void drawComments();
        wireControls();
    }
    function drawAssignees() {
        const region = dialog.querySelector('#assignees-region');
        if (region === null || state === null)
            return;
        const ul = document.createElement('ul');
        ul.setAttribute('aria-label', 'Assignments');
        for (const assignee of item.assignees) {
            const li = document.createElement('li');
            li.textContent = `${assignee.name}, ${hoursText(assignee.hours)} hours a day`;
            if (!viewer) {
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.textContent = `Remove ${assignee.name}`;
                remove.addEventListener('click', async () => {
                    try {
                        const result = await api.removeAssignee(item.id, assignee.userId);
                        await reloadProject();
                        version = result.item.version;
                        announce('schedule-updates', `${assignee.name} removed from ${item.name}.`);
                        draw(true);
                    }
                    catch {
                        showAlert('Your change could not be saved. Try again.');
                    }
                });
                li.append(remove);
            }
            ul.append(li);
        }
        region.append(ul);
        if (viewer)
            return;
        const addLabel = document.createElement('label');
        addLabel.textContent = 'Add person';
        const combo = document.createElement('input');
        combo.name = 'add-person';
        combo.setAttribute('role', 'combobox');
        combo.setAttribute('aria-expanded', 'true');
        combo.autocomplete = 'off';
        const options = document.createElement('ul');
        options.className = 'option-list';
        options.setAttribute('role', 'listbox');
        const hoursLabel = document.createElement('label');
        hoursLabel.textContent = 'Hours a day';
        const hours = document.createElement('input');
        hours.type = 'number';
        hours.value = '8';
        hours.min = '0.5';
        hours.max = '24';
        hours.step = '0.5';
        const assign = document.createElement('button');
        assign.type = 'button';
        assign.textContent = 'Assign';
        let chosenPerson = null;
        addLabel.append(combo, options);
        hoursLabel.append(hours);
        region.append(addLabel, hoursLabel, assign);
        void workspacePeople().then((people) => {
            const notAssigned = people.filter((person) => !item.assignees.some((a) => a.userId === person.userId));
            const drawOptions = (filter) => {
                options.replaceChildren();
                const lowered = filter.toLowerCase();
                for (const person of notAssigned.filter((entry) => entry.name.toLowerCase().includes(lowered))) {
                    const li = document.createElement('li');
                    li.setAttribute('role', 'option');
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.textContent = person.name;
                    button.setAttribute('aria-selected', chosenPerson?.userId === person.userId ? 'true' : 'false');
                    button.addEventListener('click', () => {
                        chosenPerson = person;
                        combo.value = person.name;
                        options.replaceChildren();
                    });
                    li.append(button);
                    options.append(li);
                }
            };
            drawOptions('');
            combo.addEventListener('input', () => drawOptions(combo.value));
            combo.addEventListener('keydown', (event) => {
                const buttons = Array.from(options.querySelectorAll('button'));
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    if (buttons.length === 0)
                        return;
                    const at = buttons.indexOf(document.activeElement);
                    buttons[event.key === 'ArrowDown' ? Math.min(at + 1, buttons.length - 1) : Math.max(at - 1, 0)].focus();
                }
                else if (event.key === 'Enter') {
                    event.preventDefault();
                    const focused = document.activeElement;
                    (focused.tagName === 'BUTTON' ? focused : buttons[0])?.click();
                }
            });
            assign.addEventListener('click', async () => {
                if (chosenPerson === null) {
                    showAlert('Choose a person.');
                    return;
                }
                const hoursValue = Number(hours.value);
                if (!Number.isFinite(hoursValue) || hoursValue < 0.5 || hoursValue > 24 || hoursValue * 2 !== Math.round(hoursValue * 2)) {
                    showAlert('Hours a day must be from 0.5 to 24 in steps of 0.5.');
                    return;
                }
                if (item.assignees.some((a) => a.userId === chosenPerson.userId)) {
                    showAlert(`${chosenPerson.name} is already assigned to this task.`);
                    return;
                }
                try {
                    const result = await api.addAssignee(item.id, { userId: chosenPerson.userId, hours: hoursValue });
                    await reloadProject();
                    version = result.item.version;
                    announce('schedule-updates', `${chosenPerson.name} assigned to ${item.name}, ${hoursText(hoursValue)} hours a day.`);
                    chosenPerson = null;
                    combo.value = '';
                    draw(true);
                }
                catch (error) {
                    if (error instanceof ApiFail && error.status === 409)
                        showAlert('That person is already assigned to this task.');
                    else if (error instanceof ApiFail && error.body.field === 'hours')
                        showAlert('Hours a day must be from 0.5 to 24 in steps of 0.5.');
                    else
                        showAlert('Your change could not be saved. Try again.');
                }
            });
        });
    }
    async function workspacePeople() {
        if (state === null || workspaceId === null)
            return [];
        const workload = await api.workload(workspaceId, state.workloadFrom);
        return workload.people.map((person) => ({ userId: person.userId, name: person.name }));
    }
    async function drawComments() {
        const ul = dialog.querySelector('#comments-list');
        if (ul === null)
            return;
        if (comments.length === 0) {
            try {
                const result = await api.comments(itemId);
                comments = result.comments;
            }
            catch {
                comments = [];
            }
        }
        ul.replaceChildren();
        for (const comment of comments) {
            const li = document.createElement('li');
            li.textContent = `${comment.author.name}: ${comment.text}`;
            ul.append(li);
        }
    }
    function wireControls() {
        dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());
        dialog.querySelector('#delete-task')?.addEventListener('click', async () => {
            try {
                await api.deleteItem(itemId);
                await reloadProject();
                const remaining = state?.project.items.length ?? 0;
                announce('schedule-updates', remaining === 0
                    ? `${item.name} deleted. The project has no tasks left.`
                    : `${item.name} deleted.`);
                dialog.close();
                focusNextBar(itemId);
            }
            catch {
                showAlert('Your change could not be saved. Try again.');
            }
        });
        const post = dialog.querySelector('#post-comment');
        const textarea = dialog.querySelector('textarea[name="comment"]');
        if (post !== null && textarea !== null) {
            textarea.addEventListener('input', () => {
                post.disabled = textarea.value.trim().length === 0;
            });
            textarea.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    post.click();
                }
            });
            post.addEventListener('click', async () => {
                const text = textarea.value.trim();
                if (text.length === 0)
                    return;
                if (text.length > 1000) {
                    showAlert('Comments can be at most 1000 characters.');
                    return;
                }
                try {
                    const result = await api.postComment(itemId, text);
                    comments = [...comments, result.comment];
                    textarea.value = '';
                    post.disabled = true;
                    announce('schedule-updates', 'Comment posted.');
                    void drawComments();
                }
                catch {
                    showAlert('Your change could not be saved. Try again.');
                }
            });
        }
        const form = dialog.querySelector('#task-form');
        form?.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (state === null || viewer)
                return;
            const name = form.elements.namedItem('name').value.trim();
            const start = form.elements.namedItem('start').value.trim();
            const durationInput = form.elements.namedItem('duration');
            const percentInput = form.elements.namedItem('percent');
            if (name.length < 1 || name.length > 120) {
                showAlert('Name must be 1 to 120 characters.');
                markInvalid(form, 'name');
                return;
            }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
                showAlert('Enter a date as YYYY-MM-DD.');
                markInvalid(form, 'start');
                return;
            }
            const body = { baseVersion: version, name, start };
            if (durationInput !== null && percentInput !== null) {
                const duration = Number(durationInput.value);
                if (!Number.isInteger(duration) || duration < 0 || duration > 999) {
                    showAlert('Duration must be a whole number from 0 to 999.');
                    markInvalid(form, 'duration');
                    return;
                }
                const percent = Number(percentInput.value);
                if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
                    showAlert('Percent complete must be a whole number from 0 to 100.');
                    markInvalid(form, 'percent');
                    return;
                }
                if (duration === 0 && percent !== 0 && percent !== 100) {
                    showAlert('A milestone is either 0% or 100% complete.');
                    markInvalid(form, 'percent');
                    return;
                }
                body.duration = duration;
                body.percent = percent;
            }
            try {
                const result = await api.patchItem(itemId, body);
                await reloadProject();
                version = result.item.version;
                announce('schedule-updates', `${result.item.name} saved.`);
                dialog.close();
                restoreFocusToBar(itemId);
            }
            catch (error) {
                if (error instanceof ApiFail && error.status === 409 && error.body.error === 'version_conflict') {
                    const by = String(error.body.by ?? '');
                    const current = error.body.item;
                    const notice = `${by} changed ${current?.name ?? item.name} first. Your change was not saved.`;
                    if (current !== undefined) {
                        // The dialog takes the current values and version, so saving again works.
                        version = current.version;
                        item = current;
                        draw(false);
                    }
                    showAlert(notice);
                }
                else if (error instanceof ApiFail && error.status === 422 && typeof error.body.message === 'string') {
                    showAlert(error.body.message);
                }
                else if (error instanceof ApiFail && error.status === 422 && error.body.error === 'has_assignees') {
                    showAlert('Remove the assignees before making this a milestone.');
                }
                else if (error instanceof ApiFail && typeof error.body.field === 'string') {
                    const fields = {
                        name: 'Name must be 1 to 120 characters.',
                        start: 'Enter a date as YYYY-MM-DD.',
                        duration: 'Duration must be a whole number from 0 to 999.',
                        percent: 'Percent complete must be a whole number from 0 to 100.',
                    };
                    showAlert(fields[error.body.field] ?? 'Your change could not be saved. Try again.');
                    markInvalid(form, error.body.field);
                }
                else {
                    showAlert('Your change could not be saved. Try again.');
                }
            }
        });
    }
    draw(false);
    trapTabs(dialog);
    dialog.addEventListener('close', () => {
        taskDialog = null;
        dialog.remove();
        if (openerBar !== null)
            openerBar.focus();
        else
            focusNextBar(itemId, true);
    });
    dialog.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            dialog.close();
        }
    });
    dialog.showModal();
    dialog.querySelector('input[name="name"]').focus();
    taskDialog = {
        onProjectChanged(project) {
            const current = project.items.find((entry) => entry.id === itemId);
            if (current === undefined) {
                dialog.close();
                return;
            }
            item = current;
            draw(true);
        },
        onLiveComment(forItem, comment) {
            if (forItem !== itemId)
                return;
            comments = [...comments, comment];
            void drawComments();
        },
    };
}
function focusNextBar(deletedId, previous = false) {
    if (state === null)
        return;
    const bars = state.project.items.filter((item) => item.kind !== 'group');
    const index = bars.findIndex((item) => item.id === deletedId);
    const next = bars[index + (previous ? -1 : 1)] ?? bars[index - 1];
    if (next === undefined)
        return;
    window.setTimeout(() => {
        document.querySelector(`[data-item-id="${next.id}"]`)?.focus();
    }, 0);
}
// ---------------------------------------------------------------------------
// Progress sheet (phone)
function openProgressSheet(itemId, opener) {
    if (state === null)
        return;
    const item = state.project.items.find((entry) => entry.id === itemId);
    if (item === undefined)
        return;
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Update progress');
    dialog.innerHTML = `
    <form class="dialog-body" method="dialog">
      <h2>${escapeHtml(item.name)}</h2>
      <label>Percent complete
        <input type="range" name="percent" min="0" max="100" step="5" value="${item.percent}">
        <output for="percent">${item.percent}%</output>
      </label>
      <p class="alert" role="alert" id="progress-alert" hidden></p>
      <div class="dialog-actions">
        <button type="submit" class="primary">Save progress</button>
        <button type="button" data-cancel>Cancel</button>
      </div>
    </form>
  `;
    document.body.append(dialog);
    const slider = dialog.querySelector('input[name="percent"]');
    const output = dialog.querySelector('output');
    const alert = dialog.querySelector('#progress-alert');
    slider.addEventListener('input', () => {
        output.textContent = `${slider.value}%`;
    });
    trapTabs(dialog);
    dialog.addEventListener('close', () => {
        dialog.remove();
        opener.focus();
    });
    dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());
    const form = dialog.querySelector('form');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (state === null)
            return;
        const percent = Number(slider.value);
        try {
            await api.patchItem(itemId, { baseVersion: item.version, percent });
            await reloadProject();
            announce('schedule-updates', `${item.name} is ${percent}% complete.`);
            dialog.close();
        }
        catch (error) {
            if (error instanceof ApiFail && error.status === 403) {
                alert.textContent = 'You can view this project but not change it.';
                alert.hidden = false;
            }
            else {
                alert.textContent = 'Your change could not be saved. Try again.';
                alert.hidden = false;
            }
        }
    });
    dialog.showModal();
    slider.focus();
}
// ---------------------------------------------------------------------------
// Workload day dialog
function openDayDialog(personName, date, day) {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', `${personName}, ${longDate(date)}`);
    dialog.innerHTML = `
    <div class="dialog-body">
      <h2>${escapeHtml(personName)}, ${escapeHtml(longDate(date))}</h2>
      <ul id="day-list" aria-label="Assignments"></ul>
      <div class="dialog-actions">
        <button type="button" class="primary" data-close>Close</button>
      </div>
    </div>
  `;
    document.body.append(dialog);
    const list = dialog.querySelector('#day-list');
    for (const entry of day.assignments) {
        const li = document.createElement('li');
        li.textContent = `${entry.project}: ${entry.item}, ${hoursText(entry.hours)} hours`;
        list.append(li);
    }
    if (day.assignments.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No assignments that day.';
        list.append(li);
    }
    trapTabs(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
    dialog.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            dialog.close();
        }
    });
    dialog.showModal();
    dialog.querySelector('button').focus();
}
boot();
