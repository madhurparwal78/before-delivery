/** Browser app: one request path, every screen. */
const app = document.getElementById('app');
const statusLive = document.getElementById('loft-status');
const alertLive = document.getElementById('loft-alert');
const outageRegion = document.getElementById('store-outage');
let token = null;
let pendingRefresh = null;
const confirmKeys = new Map();
function newIdempotencyKey() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** The one request path: adds the bearer token and handles the session refresh. */
async function request(method, path, body, opts = {}) {
    const headers = {};
    if (body !== undefined && !opts.raw)
        headers['content-type'] = 'application/json';
    if (token)
        headers['authorization'] = `Bearer ${token}`;
    if (opts.key)
        headers['idempotency-key'] = opts.key;
    const init = { method, headers, body: body === undefined ? null : (opts.raw ? body : JSON.stringify(body)) };
    let res = await fetch(path, init);
    if (res.status === 401 && !path.endsWith('/api/session') && (opts.retry ?? true)) {
        if (!pendingRefresh) {
            pendingRefresh = (async () => {
                const sessionRes = await fetch('/api/session', { headers: { authorization: token ? `Bearer ${token}` : '' } });
                if (sessionRes.status === 200) {
                    const session = (await sessionRes.json());
                    token = session.access_token;
                }
                else {
                    token = null;
                    const current = encodeURIComponent(location.pathname + location.search);
                    location.href = `/signin?resume=${current}`;
                    throw new Error('session ended');
                }
            })().finally(() => { pendingRefresh = null; });
        }
        await pendingRefresh;
        headers['authorization'] = `Bearer ${token}`;
        res = await fetch(path, { ...init, headers });
    }
    if (res.status === 503) {
        const errBody = (await res.clone().json().catch(() => ({})));
        if (errBody.error === 'store_unavailable')
            showOutage();
    }
    else {
        hideOutage();
    }
    return res;
}
async function getJson(path) {
    const res = await request('GET', path);
    if (res.status === 404)
        return null;
    if (res.status === 503) {
        const body = (await res.json());
        announce('alert', String(body['message'] ?? ''));
        return null;
    }
    if (!res.ok)
        return null;
    return (await res.json());
}
function showOutage() {
    outageRegion.textContent = 'The cut-sheet store is not answering. Try again in a few minutes.';
    outageRegion.hidden = false;
}
function hideOutage() {
    outageRegion.hidden = true;
}
function announce(region, text) {
    const el = region === 'status' ? statusLive : alertLive;
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = text; });
}
function ts(d) {
    return `${d.slice(0, 10)} ${d.slice(11, 16)}`;
}
function screenGroup(...nodes) {
    app.replaceChildren();
    for (const node of nodes) {
        if (typeof node === 'string')
            app.append(node);
        else
            app.append(node);
    }
}
function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === true)
            node.setAttribute(k, '');
        else if (v !== false)
            node.setAttribute(k, String(v));
    }
    for (const child of children)
        node.append(child);
    return node;
}
function heading(level, text, attrs = {}) {
    return el(`h${level}`, attrs, text);
}
function link(text, href) {
    const a = el('a', { href }, text);
    return a;
}
function button(text, attrs = {}, onClick) {
    const b = el('button', attrs, text);
    if (onClick)
        b.addEventListener('click', onClick);
    return b;
}
function select(labelText, name, options, selected) {
    const input = el('select', { id: name, name });
    for (const o of options) {
        const opt = el('option', { value: o.value }, o.label);
        if (o.value === selected)
            opt.setAttribute('selected', '');
        input.append(opt);
    }
    const wrap = el('div', { class: 'field' }, el('label', { for: name }, labelText), input);
    return { wrap, input };
}
function field(labelText, name, attrs = {}) {
    const input = el('input', { id: name, name, type: 'text', ...attrs });
    const wrap = el('div', { class: 'field' }, el('label', { for: name }, labelText), input);
    return { wrap, input };
}
function errorFor(wrap, message) {
    let err = wrap.querySelector('.error');
    if (!err) {
        err = el('span', { class: 'error' });
        wrap.append(err);
    }
    err.textContent = message;
}
function clearErrors(form) {
    form.querySelectorAll('.error').forEach((n) => n.remove());
}
function applyFieldErrors(form, fields) {
    for (const [member, message] of Object.entries(fields)) {
        const input = form.querySelector(`[name="${member}"]`);
        const wrap = input?.closest('.field') ?? form;
        errorFor(wrap, message);
    }
}
/** A modal dialog: focus to first field, tab wrap, Escape closes, focus returns to opener. */
function openDialog(name, body, onSubmit) {
    const dlg = el('dialog', { 'aria-label': name });
    const inner = el('div', { class: 'dialog-body' });
    const form = el('form');
    for (const b of body)
        form.append(b);
    const row = el('div', { style: 'display:flex;gap:12px;justify-content:flex-end' });
    const cancel = button('Cancel', { type: 'button' });
    row.append(cancel, button('Save', { type: 'submit', class: 'tomato' }));
    form.append(row);
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (onSubmit)
            await onSubmit(form);
    });
    inner.append(form);
    dlg.append(inner);
    document.body.append(dlg);
    const opener = document.activeElement;
    dlg.addEventListener('close', () => {
        dlg.remove();
        if (opener && document.contains(opener))
            opener.focus();
    });
    cancel.addEventListener('click', () => dlg.close());
    dlg.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            dlg.close();
        }
        if (e.key === 'Tab') {
            const focusables = dlg.querySelectorAll('button, input, select, textarea, a[href]');
            if (focusables.length === 0)
                return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
            else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    });
    dlg.showModal();
    const firstField = dlg.querySelector('input, select, textarea');
    if (firstField)
        firstField.focus();
    return dlg;
}
// ---------------------------------------------------------------------------
// Layout shell and navigation
function roleHome(role) {
    if (role === 'sailmaker')
        return '/loft';
    if (role === 'loft-hand')
        return '/floor';
    return '/owner';
}
const NAV_ITEMS = {
    sailmaker: [
        { label: 'Loft', href: '/loft' },
        { label: 'Stock', href: '/stock' },
        { label: 'Ledger', href: '/ledger' },
        { label: 'Console', href: '/console' },
        { label: 'Rule sets', href: '/rulesets' },
        { label: 'Accounts', href: '/accounts' },
    ],
    'loft-hand': [{ label: 'Cutting floor', href: '/floor' }],
    'yacht-owner': [
        { label: 'My boats', href: '/owner' },
        { label: 'Cut sheets', href: '/owner#sheets' },
    ],
};
function navBar(session) {
    const nav = el('nav', { class: 'top', 'aria-label': 'Loft' });
    nav.append(el('span', { class: 'brand' }, 'BOLTROPE'));
    for (const item of NAV_ITEMS[session.account.role] ?? []) {
        nav.append(link(item.label, item.href));
    }
    nav.append(button('Sign out', { class: 'quiet', style: 'margin-left:auto' }, () => void signOut()));
    return nav;
}
async function signOut() {
    await request('DELETE', '/api/session');
    token = null;
    location.href = '/';
}
// ---------------------------------------------------------------------------
// Landing page
function renderLanding() {
    document.title = 'Boltrope';
    screenGroup(el('section', { class: 'hero' }, sailSvg(), el('div', { style: 'margin-top:auto' }), el('div', { class: 'label' }, el('div', {}, el('p', {}, 'A loft workbench for one sailmaker'), el('p', { class: 'stats' }, '42.60 m² · 458.54 ft²'), el('p', {}, 'The figure that ruins a sail is the one you misread.')), link('Open the loft', '/signin'))), el('section', { class: 'ground-figure' }, el('div', { class: 'figure' }, '42.60 m² · 458.54 ft²')));
    app.querySelector('a[href="/signin"]').classList.add('btn', 'tomato');
    app.querySelector('a[href="/signin"]').style.display = 'inline-flex';
    app.querySelector('a[href="/signin"]').style.alignItems = 'center';
}
function sailSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'sail');
    svg.setAttribute('viewBox', '0 0 1200 800');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.setAttribute('aria-hidden', 'true');
    const paths = [
        'M120,760 L120,40',
        'M120,760 L980,760',
        'M120,40 L980,760',
    ];
    const seams = [];
    for (let i = 1; i <= 12; i++) {
        const x = 120 + (i * 70);
        if (x < 980)
            seams.push(`M${x},${760 - (x - 120) * 0.87} L${x + 90},760`);
    }
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('stroke', 'rgba(255,255,255,0.35)');
    g.setAttribute('stroke-width', '3');
    g.setAttribute('fill', 'none');
    for (const d of [...paths, ...seams]) {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', d);
        g.append(p);
    }
    svg.append(g);
    return svg;
}
// ---------------------------------------------------------------------------
// Sign in
function resumeTarget() {
    const url = new URL(location.href);
    const resume = url.searchParams.get('resume') ?? '';
    if (resume === '/' || /^\/[^/\\]/.test(resume))
        return resume;
    return '';
}
async function renderSignIn() {
    document.title = 'Sign in — Boltrope';
    const resume = resumeTarget();
    const emailField = field('Email', 'email', { type: 'email', autocomplete: 'username' });
    const passwordField = field('Password', 'password', { type: 'password', autocomplete: 'current-password' });
    const note = el('p', {});
    const form = el('form', {}, heading(1, 'Sign in to the loft'), note, emailField.wrap, passwordField.wrap, button('Sign in', { type: 'submit', class: 'tomato' }));
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearErrors(form);
        announce('status', 'Saving...');
        const res = await fetch('/api/session', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: emailField.input.value, password: passwordField.input.value }),
        });
        if (res.status === 503) {
            const body = (await res.json());
            errorFor(form, body.message ?? 'Sign-in is not answering. Try again in a minute.');
            announce('alert', body.message ?? '');
            return;
        }
        if (res.status !== 200) {
            const body = (await res.json());
            errorWithField(form, await res.json());
            announce('alert', body.message ?? 'Sign in failed.');
            return;
        }
        const session = (await res.json());
        token = session.access_token;
        announce('status', 'Saved.');
        if (resume) {
            location.href = resume;
        }
        else {
            location.href = roleHome(session.account.role);
        }
    });
    screenGroup(el('main', { style: 'max-width:480px' }, form));
    const url = new URL(location.href);
    if (url.searchParams.has('resume')) {
        // Only show the session-ended copy when the browser itself sent us here.
    }
    emailField.input.focus();
}
function errorWithField(form, body) {
    const fields = (body['fields'] ?? {});
    applyFieldErrors(form, fields);
}
const STATUS_LABEL = {
    measuring: 'Measuring', remeasure: 'Remeasure', drawn: 'Drawn', nested: 'Nested', cutting: 'Cutting',
    cut: 'Cut', pending_store: 'Pending store', issued: 'Issued', lapsed: 'Lapsed', held: 'Held',
};
function statusChip(status) {
    return el('span', { class: `chip ${status}` }, STATUS_LABEL[status] ?? status);
}
function stepsRail(code, step) {
    const nav = el('nav', { class: 'steps', 'aria-label': 'Sail steps' });
    const names = [['measure', 'Measure'], ['draw', 'Draw'], ['nest', 'Nest'], ['confirm', 'Confirm']];
    const order = ['measure', 'draw', 'nest', 'confirm'];
    const current = order.indexOf(step);
    names.forEach(([key, label], i) => {
        if (i <= current) {
            const a = link(label, `/drawings/${code}/${key}`);
            a.classList.add('step');
            if (i === current)
                a.classList.add('current');
            nav.append(a);
        }
        else {
            const span = el('span', { class: 'step' }, label);
            nav.append(span);
        }
    });
    return nav;
}
// ---------------------------------------------------------------------------
// Loft home
async function renderLoft() {
    const session = await requireSession();
    if (!session)
        return;
    document.title = 'Loft — Boltrope';
    const boats = (await getJson('/api/boats'))?.items ?? [];
    const drawings = (await getJson('/api/drawings'))?.items ?? [];
    const boatsTable = el('table', { 'aria-label': 'Boats' });
    boatsTable.append(el('thead', {}, el('tr', {}, ...['Boat', 'Class', 'Owner'].map((h) => el('th', {}, h)))));
    const boatsBody = el('tbody');
    for (const b of boats) {
        const code = String(b['code']);
        const owner = (b['owner'] ?? {});
        const tr = el('tr', {}, el('td', {}, link(String(code), `/boats/${code}`)), el('td', {}, String(b['class_name'])), el('td', {}, String(owner.display_name ?? '')));
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => { location.href = `/boats/${code}`; });
        boatsBody.append(tr);
    }
    boatsTable.append(boatsBody);
    const drawingsTable = el('table', { 'aria-label': 'Sail drawings' });
    drawingsTable.append(el('thead', {}, el('tr', {}, ...['Drawing', 'Boat', 'Sail', 'Status', 'Lot'].map((h) => el('th', {}, h)))));
    const drawingsBody = el('tbody');
    for (const d of drawings) {
        drawingsBody.append(el('tr', {}, el('td', {}, link(d.code, `/drawings/${d.code}`)), el('td', {}, d.boat_name), el('td', {}, d.sail === 'mainsail' ? 'Mainsail' : 'Headsail'), el('td', {}, statusChip(d.status)), el('td', {}, d.lot ?? '')));
    }
    drawingsTable.append(drawingsBody);
    const newBoat = button('New boat', { class: 'tomato' }, () => void newBoatDialog());
    const newDrawing = button('New drawing', {}, () => void newDrawingDialog());
    screenGroup(navBar(session), el('main', {}, heading(1, 'Loft'), el('div', { style: 'display:flex;gap:12px;margin:12px 0' }, newBoat, newDrawing), heading(2, 'Boats'), boatsTable, heading(2, 'Sail drawings'), drawingsTable));
}
async function newBoatDialog() {
    const accounts = (await getJson('/api/accounts'))?.items ?? [];
    const owners = accounts.filter((a) => a.role === 'yacht-owner');
    const name = field('Boat name', 'name');
    const className = field('Class', 'class_name');
    const notes = field('Notes', 'notes');
    const owner = select('Owner', 'owner_email', owners.map((o) => ({ value: o.email, label: o.display_name })));
    const dlg = openDialog('New boat', [heading(2, 'New boat'), name.wrap, className.wrap, notes.wrap, owner.wrap], async (form) => {
        clearErrors(form);
        announce('status', 'Saving...');
        const res = await request('POST', '/api/boats', {
            name: name.input.value,
            class_name: className.input.value,
            notes: notes.input.value,
            owner_email: owner.input.value,
        });
        if (res.status === 201) {
            const boat = (await res.json());
            announce('status', 'Saved.');
            dlg.close();
            location.href = `/boats/${boat.code}`;
        }
        else {
            const body = (await res.json());
            errorWithField(form, body);
            announce('alert', String(body['message'] ?? ''));
        }
    });
}
async function newDrawingDialog() {
    const boats = (await getJson('/api/boats'))?.items ?? [];
    const cloths = (await getJson('/api/cloths'))?.items ?? [];
    const boat = select('Boat', 'boat_code', boats.map((b) => ({ value: b.code, label: `${b.code} · ${b.name}` })));
    const sail = select('Sail', 'sail', [{ value: 'mainsail', label: 'Mainsail' }, { value: 'headsail', label: 'Headsail' }]);
    const cloth = select('Cloth', 'cloth_code', cloths.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` })));
    openDialog('New drawing', [heading(2, 'New drawing'), boat.wrap, sail.wrap, cloth.wrap], async (form) => {
        clearErrors(form);
        announce('status', 'Saving...');
        const res = await request('POST', '/api/drawings', {
            boat_code: boat.input.value,
            sail: sail.input.value,
            cloth_code: cloth.input.value,
        });
        if (res.status === 201) {
            const drawing = (await res.json());
            announce('status', 'Saved.');
            location.href = `/drawings/${drawing.code}/${drawing.step}`;
        }
        else {
            const body = (await res.json());
            errorWithField(form, body);
            announce('alert', String(body['message'] ?? ''));
        }
    });
}
async function requireSession() {
    const res = await fetch('/api/session');
    if (res.status === 401) {
        const current = encodeURIComponent(location.pathname + location.search);
        location.href = `/signin?resume=${current}`;
        return null;
    }
    const session = (await res.json());
    token = session.access_token;
    return session;
}
function screenInches(mm) {
    const hundredths = mulHalfClient(mm * 1000, 254);
    return groupFig(hundredths);
}
function screenM2(mm2) {
    return groupFig(mulHalfClient(mm2 * 100, 1000000));
}
function screenFt2(mm2) {
    return groupFig(mulHalfClient(mm2 * 100, 92903));
}
function screenPounds(pence) {
    return groupFig(mulHalfClient(pence * 100, 100));
}
function mulHalfClient(n, d) {
    const q = Math.trunc(n / d);
    const r = n - d * q;
    return r * 2 >= d ? q + 1 : r * 2 <= -d ? q - 1 : q;
}
function groupFig(hundredths) {
    const neg = hundredths < 0 ? '-' : '';
    const a = Math.abs(hundredths);
    const whole = Math.trunc(a / 100);
    const frac = a % 100;
    const intPart = String(whole);
    if (intPart.length < 4)
        return `${neg}${intPart}.${frac < 10 ? '0' : ''}${frac}`;
    let grouped = '';
    for (let i = 0; i < intPart.length; i++) {
        if (i > 0 && (intPart.length - i) % 3 === 0)
            grouped += ' ';
        grouped += intPart[i];
    }
    return `${neg}${grouped}.${frac < 10 ? '0' : ''}${frac}`;
}
async function renderBoat(code) {
    const session = await requireSession();
    if (!session)
        return;
    const boat = await getJson(`/api/boats/${code}`);
    if (!boat) {
        renderNotFound();
        return;
    }
    document.title = `${boat.code} — Boltrope`;
    const h = heading(1, `${boat.code} · ${boat.name}`);
    const dimsTable = el('table', { 'aria-label': 'Rig dimensions' });
    dimsTable.append(el('thead', {}, el('tr', {}, ...['Dimension', 'Value', 'Status', 'Photo'].map((x) => el('th', {}, x)))));
    const dimsBody = el('tbody');
    for (const d of boat.dimensions) {
        const dueText = d.status === 'remeasure' && d.remeasure_due ? `Remeasure by ${d.remeasure_due}` : '';
        const cells = [
            el('td', {}, d.key),
            el('td', { class: 'num' }, `${screenInt(d.value_mm ?? 0)} mm (${screenInches(d.value_mm ?? 0)} in)`),
            el('td', {}, statusChip(d.status === 'remeasure' ? 'remeasure' : 'measured'), dueText ? ' ' + dueText : ''),
        ];
        const lastPhoto = d.measurements.filter((m) => m.photo).slice(-1)[0]?.photo;
        cells.push(el('td', {}, lastPhoto ? link('Tape photo', `/api/measurements/${String(lastPhoto['key'] ? '' : '')}#photo`) : ''));
        dimsBody.append(el('tr', {}, ...cells));
    }
    dimsTable.append(dimsBody);
    const record = button('Record measurement', { class: 'tomato' }, () => void recordMeasurementDialog(boat.code, null));
    const editBoat = button('Edit boat', {}, () => void editBoatDialog(boat));
    screenGroup(navBar(session), el('main', {}, h, el('div', { style: 'display:flex;gap:12px;margin:12px 0' }, record, editBoat), heading(2, 'Foretriangle'), el('div', { class: 'field-cobalt', style: 'padding:24px;margin:12px 0' }, el('div', { class: 'poster' }, `${screenM2(boat.foretriangle.area_mm2)} m² · ${screenFt2(boat.foretriangle.area_mm2)} ft²`), el('p', {}, boat.foretriangle.basis)), heading(2, 'Rig dimensions'), dimsTable));
    h.focus();
    fixPhotoLinks(boat);
}
function screenInt(n) {
    const s = String(n);
    if (s.length < 4)
        return s;
    let out = '';
    for (let i = 0; i < s.length; i++) {
        if (i > 0 && (s.length - i) % 3 === 0)
            out += ' ';
        out += s[i];
    }
    return out;
}
/** Rewire the photo links to the real photo endpoints, since the API hides the key. */
function fixPhotoLinks(boat) {
    app.querySelectorAll('a[href$="#photo"]').forEach((aEl) => {
        const row = aEl.closest('tr');
        const key = row?.querySelector('td')?.textContent ?? '';
        const dim = boat.dimensions.find((d) => d.key === key);
        const photo = dim?.measurements.filter((m) => m.photo).slice(-1)[0];
        if (photo)
            aEl.href = `/api/measurements/${photo.id}/photo`;
    });
}
async function recordMeasurementDialog(boatCode, only) {
    const boat = await getJson(`/api/boats/${boatCode}`);
    if (!boat)
        return;
    const dims = only ?? ['I', 'J', 'P', 'E', 'LL', 'LP'];
    const dimension = select('Dimension', 'dimension', dims.map((d) => ({ value: d, label: d })));
    const value = field('Measured length (mm)', 'value_mm', { type: 'number' });
    const on = field('Measured on', 'measured_on', { type: 'date' });
    const photo = field('Tape photo', 'photo_file', { type: 'file', accept: 'image/jpeg,image/png' });
    openDialog('Record measurement', [heading(2, 'Record measurement'), dimension.wrap, value.wrap, on.wrap, photo.wrap], async (form) => {
        clearErrors(form);
        announce('status', 'Saving...');
        const res = await request('POST', `/api/boats/${boatCode}/measurements`, {
            dimension: dimension.input.value,
            value_mm: Number(value.input.value),
            measured_on: on.input.value,
        });
        if (res.status === 201) {
            const saved = (await res.json());
            const dim = saved.dimensions.find((d) => d.key === dimension.input.value);
            let message = 'Measurement saved.';
            if (dim?.status === 'remeasure' && dim.remeasure_due) {
                message = `Measurement saved. ${dimension.input.value} needs remeasuring by ${dim.remeasure_due}.`;
            }
            announce('status', message);
            const file = photo.input.files?.[0];
            if (file) {
                const latest = dim?.measurements.slice(-1)[0];
                if (latest) {
                    const photoRes = await request('PUT', `/api/measurements/${latest.id}/photo`, file, { raw: true });
                    if (photoRes.status === 503) {
                        announce('alert', 'The cut-sheet store is not answering. The tape photo was not saved.');
                    }
                    else if (photoRes.status === 415) {
                        announce('alert', 'That content type is not accepted here.');
                    }
                }
            }
            location.reload();
        }
        else {
            const body = (await res.json());
            errorWithField(form, body);
            announce('alert', String(body['message'] ?? ''));
        }
    });
}
async function editBoatDialog(boat) {
    const name = field('Boat name', 'name', { value: boat.name });
    const className = field('Class', 'class_name', { value: boat.class_name });
    const notes = field('Notes', 'notes', { value: boat.notes });
    const res0 = await fetch(`/api/boats/${boat.code}`);
    const revision = res0.headers.get('etag') ?? '"1"';
    openDialog('Edit boat', [heading(2, 'Edit boat'), name.wrap, className.wrap, notes.wrap], async (form) => {
        clearErrors(form);
        announce('status', 'Saving...');
        const res = await request('PATCH', `/api/boats/${boat.code}`, {
            name: name.input.value,
            class_name: className.input.value,
            notes: notes.input.value,
        });
        void revision;
        if (res.status === 200) {
            announce('status', 'Saved.');
            location.reload();
        }
        else if (res.status === 428) {
            errorFor(form, 'Reload before saving.');
            announce('alert', 'Reload before saving.');
        }
        else if (res.status === 412) {
            errorFor(form, 'Someone saved this first. Reload to see their change.');
            announce('alert', 'Someone saved this first. Reload to see their change.');
        }
        else {
            const body = (await res.json());
            errorWithField(form, body);
            announce('alert', String(body['message'] ?? ''));
        }
    });
}
// ---------------------------------------------------------------------------
// Drawing overview and steps
async function renderDrawingOverview(code) {
    const session = await requireSession();
    if (!session)
        return;
    const drawing = await getJson(`/api/drawings/${code}`);
    if (!drawing) {
        renderNotFound();
        return;
    }
    document.title = `${drawing.code} — Boltrope`;
    const h = heading(1, drawing.code);
    const loftHands = (await getJson('/api/accounts'))?.items.filter((a) => a.role === 'loft-hand') ?? [];
    const assignSelect = select('Loft hand', 'loft_hand_email', loftHands.map((l) => ({ value: l.email, label: l.display_name })));
    const assignBtn = button('Assign', {}, async () => {
        announce('status', 'Saving...');
        const res = await request('POST', `/api/drawings/${code}/assign`, { loft_hand_email: assignSelect.input.value });
        if (res.ok) {
            announce('status', 'Saved.');
            location.reload();
        }
        else
            announce('alert', String((await res.json())['message'] ?? ''));
    });
    const issueBtn = button('Issue cut sheet', { class: 'tomato' }, () => void issueDrawing(code));
    const reviseBtn = button('Revise drawing', {}, async () => {
        const res = await request('POST', `/api/drawings/${code}/revise`);
        if (res.status === 201) {
            const successor = (await res.json());
            announce('status', 'Saved.');
            location.href = `/drawings/${successor.code}`;
        }
        else {
            announce('alert', String((await res.json())['message'] ?? ''));
        }
    });
    const grants = (await getJson(`/api/drawings/${code}/grants`))?.items ?? [];
    const accounts = (await getJson('/api/accounts'))?.items ?? [];
    const grantBtn = button('Grant sight', {}, () => {
        const owner = select('Owner', 'owner_email', accounts.filter((a) => a.role === 'yacht-owner').map((o) => ({ value: o.email, label: o.display_name })));
        const ends = field('Sight ends', 'ends_at', { type: 'datetime-local', step: '1' });
        openDialog('Grant sight', [heading(2, 'Grant sight'), owner.wrap, ends.wrap], async (form) => {
            const res = await request('POST', `/api/drawings/${code}/grants`, {
                owner_email: owner.input.value,
                ends_at: ends.input.value ? `${ends.input.value.replace(' ', 'T')}Z` : undefined,
            });
            if (res.status === 201) {
                announce('status', `Sight granted to ${owner.input.selectedOptions[0]?.textContent ?? ''}.`);
                location.reload();
            }
            else {
                errorWithField(form, (await res.json()));
            }
        });
    });
    const account = await getJson(`/api/drawings/${code}/account`);
    const accountRegion = el('section', { 'aria-label': 'Sail account' });
    if (account)
        accountRegion.append(sailAccountBody(account, true));
    const overview = el('main', {}, h, stepsRail(code, drawing.step), el('div', { style: 'display:flex;gap:12px;align-items:center;margin:12px 0;flex-wrap:wrap' }, statusChip(drawing.status), drawing.lot ? el('span', {}, `Lot ${drawing.lot}`) : '', assignSelect.wrap, assignBtn, issueBtn, reviseBtn, grantBtn, drawing.cut_sheet ? link('Open cut sheet', `/api/cut-sheets/${drawing.cut_sheet.sha256}`) : ''), el('div', {}, ...grants.filter((g) => g.status === 'granted').map((g) => button(`Withdraw sight from ${g.owner.display_name}`, { class: 'quiet' }, async () => {
        const res = await request('POST', `/api/grants/${g.id}/withdraw`);
        if (res.ok) {
            announce('status', `Sight withdrawn from ${g.owner.display_name}.`);
            location.reload();
        }
        else
            announce('alert', String((await res.json())['message'] ?? ''));
    }))), el('h2', {}, 'Sail area'), drawing.area ? el('div', { class: 'field-cobalt', style: 'padding:24px;margin:12px 0' }, el('div', { class: 'poster' }, `${screenM2(drawing.area.area_mm2)} m² · ${screenFt2(drawing.area.area_mm2)} ft²`), el('p', {}, drawing.area.basis)) : el('p', {}, 'This sail has not been drawn yet.'), el('h2', {}, 'Sail account'), accountRegion);
    screenGroup(navBar(session), overview);
    h.focus();
    if (drawing.status === 'pending_store')
        startPendingStorePoll(code);
}
function sailAccountBody(account, withButtons) {
    const wrap = el('section', { 'aria-label': 'Sail account' });
    const chipLabel = account.status === 'deposit_due' ? 'Deposit due' : account.status === 'settled' ? 'Settled' : 'Balance due';
    wrap.append(el('div', { style: 'display:flex;gap:12px;align-items:center;margin-bottom:12px' }, statusChip(account.status), el('span', {}, chipLabel)));
    const rows = [
        ['Cloth charge', account.charge_pence],
        ['Tax at 20%', account.tax_pence],
        ['Total', account.total_pence],
        ['Deposit', account.deposit_pence],
        ['Paid', account.paid_pence],
        ['Credit notes', account.credited_pence],
        ['Balance', account.balance_pence],
    ];
    for (const [label, pence] of rows) {
        wrap.append(el('p', { class: 'money' }, `${label} £${screenPounds(pence)}`));
    }
    if (withButtons) {
        wrap.append(button('Record payment', {}, () => {
            const amount = field('Amount (£)', 'amount_pence');
            const note = field('Note', 'note');
            openDialog('Record payment', [heading(2, 'Record payment'), amount.wrap, note.wrap], async (form) => {
                const pence = Math.round(Number(amount.input.value) * 100);
                const key = newIdempotencyKey();
                const res = await request('POST', `/api/drawings/${account.drawing_code}/payments`, { amount_pence: pence, note: note.input.value }, { key });
                if (res.status === 201) {
                    const updated = (await res.json());
                    announce('status', `Payment of £${screenPounds(pence)} recorded. Balance £${screenPounds(updated.balance_pence)}.`);
                    location.reload();
                }
                else {
                    errorWithField(form, (await res.json()));
                }
            });
        }), button('Issue credit note', {}, () => {
            const amount = field('Amount (£)', 'amount_pence');
            const reason = field('Reason', 'reason');
            openDialog('Credit note', [heading(2, 'Credit note'), amount.wrap, reason.wrap], async (form) => {
                const pence = Math.round(Number(amount.input.value) * 100);
                const res = await request('POST', `/api/drawings/${account.drawing_code}/credit-notes`, { amount_pence: pence, reason: reason.input.value });
                if (res.status === 201) {
                    const updated = (await res.json());
                    announce('status', `Credit note of £${screenPounds(pence)} recorded. Balance £${screenPounds(updated.balance_pence)}.`);
                    location.reload();
                }
                else {
                    errorWithField(form, (await res.json()));
                }
            });
        }));
    }
    return wrap;
}
let pendingStoreTimer = null;
function startPendingStorePoll(code) {
    showOutage();
    outageRegion.textContent = 'The cut-sheet store is not answering. This cut sheet will be issued as soon as the store is back.';
    if (pendingStoreTimer !== null)
        window.clearInterval(pendingStoreTimer);
    pendingStoreTimer = window.setInterval(async () => {
        const drawing = await getJson(`/api/drawings/${code}`);
        if (drawing && drawing.status === 'issued') {
            window.clearInterval(pendingStoreTimer);
            pendingStoreTimer = null;
            hideOutage();
            announce('status', 'Cut sheet issued.');
            location.reload();
        }
    }, 5000);
}
async function issueDrawing(code) {
    announce('status', 'Issuing cut sheet...');
    const res = await request('POST', `/api/drawings/${code}/issue`);
    const body = (await res.json());
    if (res.status === 200) {
        announce('status', 'Cut sheet issued.');
        location.reload();
    }
    else if (res.status === 202) {
        announce('alert', 'The cut-sheet store is not answering. This cut sheet will be issued as soon as the store is back.');
        startPendingStorePoll(code);
    }
    else {
        announce('alert', String(body['message'] ?? ''));
    }
}
// ---------------------------------------------------------------------------
// Draw step
async function renderDrawStep(code) {
    const session = await requireSession();
    if (!session)
        return;
    const drawing = await getJson(`/api/drawings/${code}`);
    if (!drawing) {
        renderNotFound();
        return;
    }
    if (drawing.step !== 'draw' && drawing.panels.length === 0) {
        announce('alert', 'Finish the Measure step first.');
        location.replace(`/drawings/${code}/${drawing.step}`);
        return;
    }
    document.title = `Draw ${drawing.code} — Boltrope`;
    const h = heading(1, `Draw ${drawing.code}`);
    const canvas = el('div', { class: 'canvas-cobalt', 'aria-label': 'Sail drawing' });
    const info = el('p', {});
    const areaRegion = el('section', { 'aria-label': 'Sail area' });
    if (drawing.area) {
        areaRegion.append(el('div', { class: 'poster' }, `${screenM2(drawing.area.area_mm2)} m² · ${screenFt2(drawing.area.area_mm2)} ft²`), el('p', {}, drawing.area.basis));
    }
    else {
        areaRegion.append(el('div', { class: 'empty-state' }, el('p', { class: 'display' }, 'This sail has not been drawn yet.')));
    }
    const drawBtn = button('Draw sail', { class: 'tomato' }, async () => {
        announce('status', 'Saving...');
        const res = await request('POST', `/api/drawings/${code}/draw`);
        if (res.ok) {
            const updated = (await res.json());
            announce('status', `Sail drawn: ${updated.panels.length} panels.`);
            location.href = `/drawings/${code}/nest`;
        }
        else {
            announce('alert', String((await res.json())['message'] ?? ''));
        }
    });
    const right = el('section', { 'aria-label': 'Sail area' }, statusChip(drawing.status), areaRegion, drawBtn, info);
    const wrap = el('div', { class: 'draw-layout' }, canvas, right);
    screenGroup(navBar(session), el('main', {}, h, stepsRail(code, drawing.step), wrap));
    h.focus();
    if (drawing.panels.length > 0)
        drawCanvas(canvas, drawing, info);
}
function drawCanvas(canvas, drawing, info) {
    const svg = svgForOutlineGroup(drawing.panels.map((p) => ({ number: p.number, outline: p.outline })), drawing.luff_mm ?? 1, drawing.foot_mm ?? 1);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Sail drawing');
    canvas.append(svg);
    for (const p of drawing.panels) {
        const btn = button(`Panel ${p.number}`, { class: 'quiet', style: 'position:absolute' }, () => {
            info.textContent = `Panel ${p.number}: ${screenInt(p.length_mm)} mm (${screenInches(p.length_mm)} in) × ${screenInt(p.width_mm)} mm (${screenInches(p.width_mm)} in) · ${screenM2(p.area_mm2)} m² (${screenFt2(p.area_mm2)} ft²)`;
        });
        btn.style.color = '#fff';
        canvas.append(btn);
    }
}
function svgForOutlineGroup(panels, luff, foot) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const W = 600;
    const H = 500;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const sx = (W - 40) / foot;
    const sy = (H - 40) / luff;
    const s = Math.min(sx, sy);
    for (const p of panels) {
        const pts = p.outline.map(([x, y]) => `${20 + x * s},${H - 20 - y * s}`).join(' ');
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', pts);
        polygon.setAttribute('fill', 'none');
        polygon.setAttribute('stroke', '#ffffff');
        polygon.setAttribute('stroke-width', '2');
        polygon.setAttribute('aria-label', `Drawing panel ${p.number}`);
        svg.append(polygon);
    }
    return svg;
}
let nest = null;
async function renderNest(code, isFloor) {
    const session = await requireSession();
    if (!session)
        return;
    const drawing = await getJson(`/api/drawings/${code}`);
    if (!drawing) {
        renderNotFound();
        return;
    }
    if (!isFloor && drawing.panels.length === 0) {
        location.replace(`/drawings/${code}/${drawing.step}`);
        return;
    }
    document.title = `${isFloor ? 'Nest' : 'Nest'} ${drawing.code} — Boltrope`;
    const claims = [];
    for (const id of drawing.claim_ids) {
        const claim = await getJson(`/api/claims/${id}`);
        if (claim && claim.status === 'held' && claim.seconds_remaining > 0)
            claims.push(claim);
    }
    nest = {
        drawing, claims, activeClaim: claims[0] ?? null, stock: null, selectedPanel: null,
        ghost: null, unlaidCount: drawing.panels.filter((p) => !p.laid && !p.cut).length,
        announcedMinute: false, timer: null,
    };
    if (nest.activeClaim)
        nest.stock = await getJson(`/api/stock/${nest.activeClaim.stock_code}`);
    const h = heading(1, `Nest ${drawing.code}`);
    const canvas = el('div', { class: 'canvas-cobalt', 'aria-label': 'Sail drawing', role: 'region' });
    const region = el('section', { 'aria-label': 'Nesting', style: 'display:grid;gap:16px' });
    const panelsList = el('ul', { 'aria-label': 'Panels', style: 'display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0' });
    const panelsToggle = button(`Panels (${nest.unlaidCount} unlaid)`, { 'aria-expanded': 'false' });
    const holdSelect = select('Active hold', 'active_hold', claims.map((c) => ({ value: c.id, label: `${c.stock_code} · lot ${c.stock_code}` })));
    const strip = el('div', { 'aria-label': 'Roll strip', class: 'strip-black' });
    const readout = el('p', { class: 'readout', 'aria-label': 'Placement' });
    const remaining = el('section', { 'aria-label': 'Roll remaining' });
    const timerEl = el('div', { role: 'timer', 'aria-label': 'Hold' });
    const layoutRow = el('div', { class: 'draw-layout' }, canvas, el('div', {}, panelsList, holdSelect.wrap, readout));
    region.append(layoutRow, strip);
    const controls = el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;margin:12px 0' });
    const turnBtn = button('Turn 180°', {}, () => turnGhost());
    const layBtn = button('Lay', { class: 'tomato' }, () => void laySelected());
    const undoBtn = button('Undo', {}, () => void undoLay());
    const claimBtn = button('Claim length', {}, () => void claimDialog(code, drawing));
    const confirmBtn = button('Confirm cut', {}, () => void confirmCut());
    const releaseBtn = button('Release hold', {}, () => void releaseHold());
    controls.append(panelsToggle, turnBtn, layBtn, undoBtn, claimBtn, confirmBtn, releaseBtn);
    const main = el('main', {}, h);
    if (!isFloor)
        main.append(stepsRail(code, drawing.step));
    main.append(region, controls, remaining, timerEl);
    screenGroup(navBar(session), main);
    h.focus();
    drawNestCanvas(canvas);
    renderPanelsList(panelsList, panelsToggle);
    renderStrip(strip);
    updateRemaining(remaining);
    updateTimer(timerEl);
    holdSelect.input.addEventListener('change', () => void switchHold(holdSelect.input.value, remaining, strip, timerEl));
    region.addEventListener('keydown', (e) => nestKeydown(e));
    if (nest.activeClaim)
        startNestTimer(timerEl);
    watchLayout(panelsList, panelsToggle);
}
function watchLayout(list, toggle) {
    const apply = () => {
        const phone = window.innerWidth <= 599;
        if (phone) {
            list.hidden = true;
            toggle.hidden = false;
            toggle.setAttribute('aria-expanded', 'false');
        }
        else {
            list.hidden = false;
            toggle.hidden = true;
        }
    };
    apply();
    window.addEventListener('resize', apply);
}
function drawNestCanvas(canvas) {
    if (!nest)
        return;
    canvas.replaceChildren();
    const svg = svgForOutlineGroup(nest.drawing.panels.map((p) => ({ number: p.number, outline: p.outline })), nest.drawing.luff_mm ?? 1, nest.drawing.foot_mm ?? 1);
    canvas.append(svg);
}
function renderPanelsList(list, toggle) {
    if (!nest)
        return;
    list.replaceChildren();
    const unlaid = nest.drawing.panels.filter((p) => !p.laid && !p.cut);
    toggle.textContent = `Panels (${unlaid.length} unlaid)`;
    for (const p of unlaid) {
        const b = button(`Panel ${p.number}`, { 'aria-pressed': String(nest.selectedPanel === p.number) }, () => selectPanel(p.number, toggle));
        list.append(el('li', {}, b));
    }
    for (const p of nest.drawing.panels.filter((x) => x.laid || x.cut)) {
        const b = button(`Panel ${p.number}`, { class: 'quiet', disabled: true });
        list.append(el('li', {}, b));
    }
}
function selectPanel(number, toggle) {
    if (!nest)
        return;
    nest.selectedPanel = number;
    const entry = nest.activeClaim?.next_positions.find((n) => n.panel_number === number);
    if (entry && entry.x_mm !== null && entry.y_mm !== null && entry.rotation !== null) {
        nest.ghost = { x: entry.x_mm, y: entry.y_mm, rotation: entry.rotation };
    }
    else {
        nest.ghost = { x: 0, y: 0, rotation: 0 };
    }
    updateReadout();
    const phone = window.innerWidth <= 599;
    if (phone && toggle.parentElement) {
        const list = app.querySelector('ul[aria-label="Panels"]');
        if (list)
            list.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        const lay = app.querySelector('button:not([hidden])');
        void lay;
        const layBtn = [...app.querySelectorAll('button')].find((b) => b.textContent === 'Lay');
        layBtn?.focus();
    }
    renderPanelsList(app.querySelector('ul[aria-label="Panels"]'), toggle);
}
function updateReadout() {
    const readout = app.querySelector('.readout');
    if (!readout || !nest?.ghost)
        return;
    readout.textContent = `x ${screenInt(nest.ghost.x)} mm (${screenInches(nest.ghost.x)} in) · y ${screenInt(nest.ghost.y)} mm (${screenInches(nest.ghost.y)} in) · ${nest.ghost.rotation}°`;
}
function nestKeydown(e) {
    if (!nest)
        return;
    const target = e.target;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')
        return;
    if (document.querySelector('dialog[open]'))
        return;
    if (!nest.ghost)
        return;
    const step = e.shiftKey ? 10 : 1;
    let handled = true;
    switch (e.key) {
        case 'ArrowRight':
            nest.ghost.x += step;
            break;
        case 'ArrowLeft':
            nest.ghost.x -= step;
            break;
        case 'ArrowDown':
            nest.ghost.y += step;
            break;
        case 'ArrowUp':
            nest.ghost.y -= step;
            break;
        case 'r':
        case 'R':
            turnGhost();
            return;
        case 'l':
        case 'L':
            void laySelected();
            return;
        case 'u':
        case 'U':
            void undoLay();
            return;
        case 'Escape':
            nest.selectedPanel = null;
            nest.ghost = null;
            updateReadout();
            return;
        default: handled = false;
    }
    if (handled) {
        e.preventDefault();
        clampGhost();
        updateReadout();
    }
}
function clampGhost() {
    const state = nest;
    if (!state?.ghost || !state.activeClaim || !state.stock)
        return;
    const panel = state.drawing.panels.find((p) => p.number === state.selectedPanel);
    if (!panel)
        return;
    const claimLength = state.activeClaim.length_mm;
    const usable = state.stock.usable_width_mm;
    const ghost = state.ghost;
    if (ghost.x < 0)
        ghost.x = 0;
    if (ghost.y < 0)
        ghost.y = 0;
    if (ghost.x + panel.length_mm > claimLength)
        ghost.x = Math.max(0, claimLength - panel.length_mm);
    if (ghost.y + panel.width_mm > usable)
        ghost.y = Math.max(0, usable - panel.width_mm);
}
function turnGhost() {
    if (!nest?.ghost)
        return;
    nest.ghost.rotation = nest.ghost.rotation === 0 ? 180 : 0;
    clampGhost();
    updateReadout();
    announce('status', `Panel ${nest.selectedPanel} turned to ${nest.ghost.rotation}°.`);
}
async function laySelected() {
    if (!nest?.ghost || !nest.selectedPanel || !nest.activeClaim)
        return;
    announce('status', `Laying panel ${nest.selectedPanel}...`);
    const body = { panel_number: nest.selectedPanel };
    if (nest.ghost.x !== 0 || nest.ghost.y !== 0 || nest.ghost.rotation !== 0) {
        body['x_mm'] = nest.ghost.x;
        body['y_mm'] = nest.ghost.y;
        body['rotation'] = nest.ghost.rotation;
    }
    const res = await request('POST', `/api/claims/${nest.activeClaim.id}/lays`, body);
    await applyLayAnswer(res);
}
async function applyLayAnswer(res) {
    if (!nest)
        return;
    if (res.status === 201) {
        const body = (await res.json());
        nest.activeClaim = body.claim;
        nest.stock = body.stock;
        await refreshDrawing();
        announce('status', `Panel ${body.claim.lays.slice(-1)[0]?.panel_number} laid on ${body.stock.kind} ${body.stock.code}. ${screenInt(body.stock.after_laid_mm)} mm (${screenInches(body.stock.after_laid_mm)} in) remaining.`);
        rerenderNest();
    }
    else {
        const body = (await res.json());
        announce('alert', String(body['message'] ?? ''));
    }
}
async function undoLay() {
    if (!nest?.activeClaim)
        return;
    const last = nest.activeClaim.lays.slice(-1)[0];
    if (!last)
        return;
    const res = await request('DELETE', `/api/claims/${nest.activeClaim.id}/lays/${last.panel_number}`);
    if (res.status === 200) {
        const body = (await res.json());
        nest.activeClaim = body.claim;
        nest.stock = body.stock;
        await refreshDrawing();
        announce('status', `Panel ${last.panel_number} lifted from ${body.stock.kind} ${body.stock.code}.`);
        rerenderNest();
    }
    else {
        announce('alert', String((await res.json())['message'] ?? ''));
    }
}
async function refreshDrawing() {
    if (!nest)
        return;
    const drawing = await getJson(`/api/drawings/${nest.drawing.code}`);
    if (drawing)
        nest.drawing = drawing;
}
function rerenderNest() {
    if (!nest)
        return;
    const list = app.querySelector('ul[aria-label="Panels"]');
    const toggle = [...app.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Panels ('));
    if (list && toggle)
        renderPanelsList(list, toggle);
    const strip = app.querySelector('.strip-black');
    if (strip)
        renderStrip(strip);
    const remaining = app.querySelector('section[aria-label="Roll remaining"]');
    if (remaining)
        updateRemaining(remaining);
    drawNestCanvas(app.querySelector('.canvas-cobalt'));
    nest.selectedPanel = null;
    nest.ghost = null;
    updateReadout();
}
function renderStrip(strip) {
    if (!nest?.activeClaim || !nest.stock) {
        strip.replaceChildren();
        return;
    }
    strip.replaceChildren();
    const claim = nest.activeClaim;
    const L = claim.length_mm;
    const U = nest.stock.usable_width_mm;
    const innerW = Math.max(strip.clientWidth - 24, 300);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const height = Math.max(140, Math.min(240, (U / L) * innerW));
    svg.setAttribute('viewBox', `0 0 ${innerW} ${height}`);
    svg.setAttribute('width', String(innerW));
    svg.setAttribute('height', String(height));
    const scale = innerW / L;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(innerW));
    rect.setAttribute('height', String(height));
    rect.setAttribute('fill', '#2a2622');
    svg.append(rect);
    for (const lay of claim.lays) {
        const pts = lay.outline.map(([x, y]) => `${x * scale},${height - y * scale}`).join(' ');
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', pts);
        poly.setAttribute('fill', nest.stock.kind === 'offcut' ? 'none' : '#faf6f1');
        poly.setAttribute('stroke', nest.stock.kind === 'offcut' ? '#e8492d' : '#faf6f1');
        poly.setAttribute('stroke-width', '2');
        poly.setAttribute('aria-label', `Laid panel ${lay.panel_number}`);
        svg.append(poly);
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', String(lay.x_mm * scale + 6));
        label.setAttribute('y', '20');
        label.setAttribute('fill', '#12100e');
        label.setAttribute('font-weight', '700');
        label.textContent = String(lay.panel_number);
        svg.append(label);
    }
    strip.append(svg);
}
function updateRemaining(region) {
    if (!nest?.stock) {
        region.replaceChildren();
        return;
    }
    const offcuts = 0;
    void offcuts;
    region.replaceChildren(el('div', { class: 'poster', style: 'font-size:48px' }, `${screenInt(nest.stock.after_laid_mm)} mm (${screenInches(nest.stock.after_laid_mm)} in)`), el('p', {}, `On hand ${screenM2(nest.stock.on_hand_mm2)} m² (${screenFt2(nest.stock.on_hand_mm2)} ft²)`));
}
function updateTimer(timerEl) {
    if (!nest?.activeClaim) {
        timerEl.replaceChildren();
        return;
    }
    const secs = nest.activeClaim.seconds_remaining;
    timerEl.replaceChildren(el('div', {}, `Hold ends in ${fmtCountdown(secs)}`));
}
function fmtCountdown(total) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function startNestTimer(timerEl) {
    if (!nest?.activeClaim)
        return;
    if (nest.timer !== null)
        window.clearInterval(nest.timer);
    const startedAt = Date.now();
    const base = nest.activeClaim.seconds_remaining;
    let lastWhole = base;
    nest.timer = window.setInterval(async () => {
        if (!nest?.activeClaim)
            return;
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        const whole = Math.max(0, base - elapsed);
        if (whole !== lastWhole) {
            lastWhole = whole;
            timerEl.replaceChildren(el('div', {}, `Hold ends in ${fmtCountdown(whole)}`));
        }
        if (whole <= 60 && whole > 0 && !nest.announcedMinute) {
            nest.announcedMinute = true;
            announce('status', `One minute left on the hold on ${nest.activeClaim.stock_code}.`);
        }
        if (whole <= 0) {
            window.clearInterval(nest.timer);
            nest.timer = null;
            const claim = await getJson(`/api/claims/${nest.activeClaim.id}`);
            if (!claim || claim.status === 'lapsed') {
                timerEl.replaceChildren(el('div', {}, 'Lapsed'));
                announce('alert', 'This hold has lapsed. Claim the length again before cutting.');
                const claimBtn = [...app.querySelectorAll('button')].find((b) => b.textContent === 'Claim length');
                claimBtn?.focus();
                nest.selectedPanel = null;
                nest.ghost = null;
                nest.activeClaim = claim && claim.status === 'lapsed' ? claim : nest.activeClaim;
                await refreshDrawing();
                rerenderNest();
            }
            else {
                nest.activeClaim = claim;
                startNestTimer(timerEl);
            }
        }
    }, 1000);
}
async function switchHold(claimId, remaining, strip, timerEl) {
    if (!nest)
        return;
    const claim = await getJson(`/api/claims/${claimId}`);
    if (claim) {
        nest.activeClaim = claim;
        nest.stock = await getJson(`/api/stock/${claim.stock_code}`);
        nest.selectedPanel = null;
        nest.ghost = null;
        nest.announcedMinute = false;
        renderStrip(strip);
        updateRemaining(remaining);
        startNestTimer(timerEl);
    }
}
async function claimDialog(code, drawing) {
    const stockItems = (await getJson('/api/stock'))?.items ?? [];
    const candidates = stockItems.filter((s) => s.cloth_code === drawing.cloth_code);
    const roll = select('Roll or offcut', 'stock_code', candidates.map((s) => ({ value: s.code, label: `${s.code} · lot ${s.lot}` })));
    const length = field('Length (mm)', 'length_mm', { type: 'number' });
    const dlg = openDialog('Claim length', [heading(2, 'Claim length'), roll.wrap, length.wrap], async (form) => {
        clearErrors(form);
        announce('status', 'Claiming length...');
        const res = await request('POST', '/api/claims', {
            stock_code: roll.input.value,
            drawing_code: code,
            length_mm: Number(length.input.value),
        });
        if (res.status === 201) {
            const claim = (await res.json());
            announce('status', `Holding ${screenInt(claim.length_mm)} mm on ${claim.stock_code} until ${claim.expires_at.slice(11, 16)} UTC.`);
            dlg.close();
            location.reload();
        }
        else {
            const body = (await res.json());
            errorWithField(form, body);
            announce('alert', String(body['message'] ?? ''));
        }
    });
}
async function confirmCut() {
    if (!nest?.activeClaim)
        return;
    const claimId = nest.activeClaim.id;
    const storedKey = confirmKeys.get(claimId) ?? newIdempotencyKey();
    confirmKeys.set(claimId, storedKey);
    announce('status', 'Confirming cut...');
    const res = await request('POST', `/api/claims/${claimId}/cut`, undefined, { key: storedKey });
    if (res.status === 200) {
        const body = (await res.json());
        let message = `Cut confirmed on ${body.stock.kind} ${body.stock.code}. ${screenInt(body.stock.after_laid_mm)} mm (${screenInches(body.stock.after_laid_mm)} in) remaining.`;
        if (body.offcut)
            message += ` Offcut ${body.offcut.code} added to the shelf.`;
        announce('status', message);
        const session = await requireSession();
        if (session?.account.role === 'loft-hand')
            location.href = '/floor';
        else
            location.href = `/drawings/${nest.drawing.code}`;
    }
    else {
        const body = (await res.json());
        announce('alert', String(body['message'] ?? ''));
    }
}
async function releaseHold() {
    if (!nest?.activeClaim)
        return;
    const res = await request('POST', `/api/claims/${nest.activeClaim.id}/release`);
    if (res.status === 200) {
        announce('status', `Hold released on ${nest.activeClaim.stock_code}.`);
        location.reload();
    }
    else {
        announce('alert', String((await res.json())['message'] ?? ''));
    }
}
// ---------------------------------------------------------------------------
// Confirm step
async function renderConfirmStep(code) {
    const session = await requireSession();
    if (!session)
        return;
    const drawing = await getJson(`/api/drawings/${code}`);
    if (!drawing) {
        renderNotFound();
        return;
    }
    if (drawing.step !== 'confirm') {
        announce('alert', `Finish the ${drawing.step[0].toUpperCase()}${drawing.step.slice(1)} step first.`);
        location.replace(`/drawings/${code}/${drawing.step}`);
        return;
    }
    document.title = `Confirm ${drawing.code} — Boltrope`;
    const h = heading(1, `Confirm ${drawing.code}`);
    const table = el('table', { 'aria-label': 'Holds to cut' });
    table.append(el('thead', {}, el('tr', {}, ...['Stock', 'Lot', 'Used length', 'Panels'].map((x) => el('th', {}, x)))));
    const body = el('tbody');
    for (const claimId of drawing.claim_ids) {
        const claim = await getJson(`/api/claims/${claimId}`);
        if (!claim || claim.status !== 'held' || claim.seconds_remaining <= 0 || claim.lays.length === 0)
            continue;
        const stock = await getJson(`/api/stock/${claim.stock_code}`);
        const row = el('tr', {}, el('td', {}, claim.stock_code), el('td', {}, stock?.lot ?? ''), el('td', { class: 'num' }, `${screenInt(claim.used_mm)} mm (${screenInches(claim.used_mm)} in)`), el('td', {}, claim.lays.map((l) => l.panel_number).join(', ')));
        body.append(row);
    }
    table.append(body);
    const remaining = el('section', { 'aria-label': 'Roll remaining' });
    screenGroup(navBar(session), el('main', {}, h, stepsRail(code, drawing.step), table, remaining));
    h.focus();
    const remainingClaims = (await Promise.all(drawing.claim_ids.map(async (id) => {
        const claim = await getJson(`/api/claims/${id}`);
        if (claim && claim.status === 'held' && claim.lays.length > 0) {
            const btnRow = body.querySelector(`tr:last-child`);
            void btnRow;
            const row = [...body.querySelectorAll('tr')].find((tr) => tr.children[0]?.textContent === claim.stock_code);
            if (row) {
                const confirmBtn = button(`Confirm cut on ${claim.stock_code}`, { class: 'tomato' }, async () => {
                    const storedKey = confirmKeys.get(claim.id) ?? newIdempotencyKey();
                    confirmKeys.set(claim.id, storedKey);
                    announce('status', 'Confirming cut...');
                    const res = await request('POST', `/api/claims/${claim.id}/cut`, undefined, { key: storedKey });
                    if (res.status === 200) {
                        const body = (await res.json());
                        let message = `Cut confirmed on ${body.stock.kind} ${body.stock.code}. ${screenInt(body.stock.after_laid_mm)} mm (${screenInches(body.stock.after_laid_mm)} in) remaining.`;
                        if (body.offcut)
                            message += ` Offcut ${body.offcut.code} added to the shelf.`;
                        announce('status', message);
                        const sessionNow = await requireSession();
                        if (sessionNow?.account.role === 'loft-hand')
                            location.href = '/floor';
                        else
                            location.reload();
                    }
                    else {
                        announce('alert', String((await res.json())['message'] ?? ''));
                    }
                });
                row.append(el('td', {}, confirmBtn));
            }
        }
        return claim;
    })));
    void remainingClaims;
    const firstStock = drawing.claim_ids.length ? await getJson(`/api/stock/${(await getJson(`/api/claims/${drawing.claim_ids[0]}`))?.stock_code ?? ''}`) : null;
    if (firstStock) {
        remaining.replaceChildren(el('div', { class: 'poster', style: 'font-size:48px' }, `${screenInt(firstStock.after_laid_mm)} mm (${screenInches(firstStock.after_laid_mm)} in)`), el('p', {}, `On hand ${screenM2(firstStock.on_hand_mm2)} m² (${screenFt2(firstStock.on_hand_mm2)} ft²)`));
    }
}
// ---------------------------------------------------------------------------
// Floor, stock, ledger, console, rulesets, accounts, owner screens
async function renderFloor() {
    const session = await requireSession();
    if (!session)
        return;
    document.title = 'Cutting floor — Boltrope';
    const drawings = (await getJson('/api/drawings'))?.items ?? [];
    const queue = el('ul', { 'aria-label': 'Cutting queue', class: 'grid queue', style: 'list-style:none;padding:0' });
    const known = new Set();
    const addCard = (d, announceNew) => {
        if (known.has(d.code))
            return;
        known.add(d.code);
        const card = el('li', { class: 'card' }, link(`${d.code} · ${d.boat_name} ${d.sail === 'mainsail' ? 'Mainsail' : 'Headsail'}`, `/floor/${d.code}`), statusChip(d.status));
        queue.append(card);
        if (announceNew)
            announce('status', `${d.code} is on your cutting floor.`);
    };
    for (const d of drawings)
        addCard(d, false);
    screenGroup(navBar(session), el('main', {}, heading(1, 'Cutting floor'), drawings.length === 0 ? el('div', { class: 'empty-state' }, el('p', { class: 'display' }, 'Nothing is assigned to you on the cutting floor.')) : queue));
    window.setInterval(async () => {
        const fresh = (await getJson('/api/drawings'))?.items ?? [];
        for (const d of fresh) {
            if (!known.has(d.code))
                addCard(d, true);
        }
    }, 5000);
}
async function renderStock() {
    const session = await requireSession();
    if (!session)
        return;
    document.title = 'Stock shelf — Boltrope';
    const summary = await getJson('/api/stock/summary');
    const items = ((await getJson('/api/stock'))?.items ?? []).slice().sort((a, b) => a.on_hand_mm2 - b.on_hand_mm2 || a.code.localeCompare(b.code));
    const grid = el('ul', { 'aria-label': 'Rolls and offcuts', class: 'grid shelf', style: 'list-style:none;padding:0' });
    for (const s of items) {
        const card = el('li', { class: 'card' }, link(s.code, `/ledger?stock=${s.code}`), el('span', {}, `${s.kind === 'roll' ? 'Roll' : 'Offcut'} · lot ${s.lot}`), el('div', { class: 'figure' }, `${screenInt(s.remaining_mm)} mm`), el('span', { class: 'num' }, `${screenInches(s.remaining_mm)} in · ${screenM2(s.on_hand_mm2)} m² (${screenFt2(s.on_hand_mm2)} ft²)`), el('span', {}, s.shelf_location), button(`Count ${s.code}`, {}, () => void countDialog(s)), button(`Edit ${s.code}`, {}, () => void editStockDialog(s)));
        grid.append(card);
    }
    const receiveBtn = button('Receive roll', { class: 'tomato' }, () => void receiveRollDialog());
    screenGroup(navBar(session), el('main', {}, heading(1, 'Stock shelf'), el('section', { 'aria-label': 'Stock on hand' }, summary ? el('p', {}, `${summary.rolls} rolls · ${summary.offcuts} offcuts · ${screenM2(summary.on_hand_mm2)} m² (${screenFt2(summary.on_hand_mm2)} ft²) on hand`) : ''), receiveBtn, grid));
}
async function receiveRollDialog() {
    const cloths = (await getJson('/api/cloths'))?.items ?? [];
    const cloth = select('Cloth', 'cloth_code', cloths.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` })));
    const lot = field('Lot', 'lot');
    const length = field('Length (mm)', 'length_mm', { type: 'number' });
    const shelf = field('Shelf location', 'shelf_location');
    const dlg = openDialog('Receive roll', [heading(2, 'Receive roll'), cloth.wrap, lot.wrap, length.wrap, shelf.wrap], async (form) => {
        clearErrors(form);
        announce('status', 'Saving...');
        const res = await request('POST', '/api/rolls', {
            cloth_code: cloth.input.value,
            lot: lot.input.value,
            length_mm: Number(length.input.value),
            shelf_location: shelf.input.value,
        });
        if (res.status === 201) {
            const stock = (await res.json());
            announce('status', `Roll ${stock.code} received.`);
            dlg.close();
            location.reload();
        }
        else {
            errorWithField(form, (await res.json()));
        }
    });
    location.hash;
    setTimeout(() => {
        const newCard = [...document.querySelectorAll('.card')].find((c) => c.firstChild?.textContent === '');
        void newCard;
    }, 0);
}
async function countDialog(stock) {
    const counted = field('Counted length (mm)', 'counted_length_mm', { type: 'number', value: String(stock.remaining_mm) });
    const reason = field('Reason', 'reason');
    openDialog('Shelf count', [heading(2, 'Shelf count'), counted.wrap, reason.wrap], async (form) => {
        clearErrors(form);
        announce('status', 'Saving...');
        const res = await request('POST', `/api/stock/${stock.code}/counts`, {
            counted_length_mm: Number(counted.input.value),
            reason: reason.input.value,
        });
        if (res.status === 200) {
            const updated = (await res.json());
            const diff = stock.remaining_mm - Number(counted.input.value);
            void diff;
            void updated;
            announce('status', 'Saved.');
            location.reload();
        }
        else {
            errorWithField(form, (await res.json()));
        }
    });
}
async function editStockDialog(stock) {
    const shelf = field('Shelf location', 'shelf_location', { value: stock.shelf_location });
    const note = field('Note', 'note', { value: stock.note });
    openDialog(`Edit ${stock.code}`, [heading(2, `Edit ${stock.code}`), shelf.wrap, note.wrap], async (form) => {
        clearErrors(form);
        const res0 = await fetch(`/api/stock/${stock.code}`);
        const revision = res0.headers.get('etag') ?? '"1"';
        const res = await request('PATCH', `/api/stock/${stock.code}`, {
            shelf_location: shelf.input.value,
            note: note.input.value,
        });
        void revision;
        if (res.status === 200) {
            announce('status', 'Saved.');
            location.reload();
        }
        else if (res.status === 428) {
            errorFor(form, 'Reload before saving.');
        }
        else if (res.status === 412) {
            errorFor(form, 'Someone saved this first. Reload to see their change.');
        }
        else {
            errorWithField(form, (await res.json()));
        }
    });
}
// ---------------------------------------------------------------------------
// Ledger
async function renderLedger() {
    const session = await requireSession();
    if (!session)
        return;
    document.title = 'Cloth ledger — Boltrope';
    const url = new URL(location.href);
    const stock = url.searchParams.get('stock') ?? '';
    const cursor = url.searchParams.get('cursor') ?? '';
    const stocks = (await getJson('/api/stock'))?.items ?? [];
    const filter = select('Stock', 'stock', [{ value: '', label: 'All stock' }, ...stocks.map((s) => ({ value: s.code, label: s.code }))], stock);
    const table = el('table', { 'aria-label': 'Ledger lines' });
    table.append(el('thead', {}, el('tr', {}, ...['Line', 'Posted', 'Account', 'Stock', 'Drawing', 'Amount', 'Actor', 'Reason'].map((h) => el('th', {}, h)))));
    const body = el('tbody');
    table.append(body);
    const footer = el('section', { 'aria-label': 'Ledger footer' });
    screenGroup(navBar(session), el('main', {}, heading(1, 'Cloth ledger'), filter.wrap, el('div', { style: 'display:flex;gap:12px' }, button('Older lines', {}, () => void loadPage('older')), button('Newest lines', {}, () => void loadPage('newest'))), table, footer));
    let nextCursor = null;
    let requestSeq = 0;
    async function loadPage(dir) {
        const seq = ++requestSeq;
        const query = new URLSearchParams();
        if (stock)
            query.set('stock', stock);
        if (dir === 'older' && nextCursor)
            query.set('cursor', nextCursor);
        else if (dir === 'same' && cursor)
            query.set('cursor', cursor);
        const res = await request('GET', `/api/ledger?${query.toString()}`);
        if (seq !== requestSeq)
            return;
        if (res.status === 422) {
            const errBody = (await res.json());
            const fields = (errBody['fields'] ?? {});
            announce('alert', fields['cursor'] ?? String(errBody['message'] ?? ''));
            url.searchParams.delete('cursor');
            history.replaceState(null, '', url.pathname + (stock ? `?stock=${stock}` : ''));
            await loadPage('newest');
            return;
        }
        const data = (await res.json());
        nextCursor = data.next_cursor;
        body.replaceChildren();
        data.items.forEach((row, i) => {
            const amount = Number(row['amount_mm2']);
            const sign = amount < 0 ? '-' : '';
            const tr = el('tr', { class: 'row-in' }, el('td', {}, String(row['line_id'])), el('td', {}, ts(String(row['posted_at']))), el('td', {}, String(row['account'])), el('td', {}, String(row['stock_code'])), el('td', {}, String(row['drawing_code'] ?? '')), el('td', { class: 'num' }, `${sign}${screenM2(Math.abs(amount))} m² (${screenFt2(Math.abs(amount))} ft²)`), el('td', {}, String(row['actor_email'])), el('td', {}, String(row['reason'] ?? '')));
            tr.style.animationDelay = `${Math.min(i, 10) * 30}ms`;
            body.append(tr);
        });
        const remaining = data.footer.remaining_mm;
        footer.replaceChildren(remaining !== null ? el('p', { class: 'poster', style: 'font-size:36px' }, `${screenInt(remaining)} mm (${data.footer.remaining_in} in)`) : '', el('p', {}, `${screenM2(data.footer.on_hand_mm2)} m² (${screenFt2(data.footer.on_hand_mm2)} ft²) on hand · ${data.footer.offcut_count} offcuts · ${data.footer.lines} lines`));
        if (dir === 'older' && nextCursor) {
            url.searchParams.set('cursor', nextCursor);
            history.pushState(null, '', `${url.pathname}?${url.searchParams.toString()}`);
        }
        else if (dir === 'newest') {
            url.searchParams.delete('cursor');
            history.pushState(null, '', `${url.pathname}${stock ? `?stock=${stock}` : ''}`);
        }
    }
    filter.input.addEventListener('change', () => {
        const params = new URLSearchParams();
        if (filter.input.value)
            params.set('stock', filter.input.value);
        history.pushState(null, '', `/ledger${params.toString() ? `?${params.toString()}` : ''}`);
        location.reload();
    });
    window.addEventListener('popstate', () => location.reload());
    await loadPage(cursor ? 'same' : 'newest');
}
// ---------------------------------------------------------------------------
// Console
async function renderConsole() {
    const session = await requireSession();
    if (!session)
        return;
    const url = new URL(location.href);
    const tab = url.searchParams.get('tab') ?? 'submissions';
    const season = url.searchParams.get('season') ?? String(new Date().getUTCFullYear());
    document.title = 'Console — Boltrope';
    const tabs = el('div', { role: 'tablist', style: 'display:flex;gap:12px;flex-wrap:wrap' });
    for (const name of ['submissions', 'audit', 'standing', 'roles', 'export']) {
        const b = button(name[0].toUpperCase() + name.slice(1), { role: 'tab' }, () => {
            history.pushState(null, '', `/console?tab=${name}${name === 'standing' ? `&season=${season}` : ''}`);
            location.reload();
        });
        if (name === tab)
            b.setAttribute('aria-selected', 'true');
        tabs.append(b);
    }
    const main = el('main', {}, heading(1, 'Console'), tabs);
    screenGroup(navBar(session), main);
    if (tab === 'submissions')
        await consoleSubmissions();
    else if (tab === 'audit')
        await consoleAudit();
    else if (tab === 'standing')
        await consoleStanding(season);
    else if (tab === 'roles')
        await consoleRoles();
    else
        await consoleExport();
}
async function consoleSubmissions() {
    const pending = ((await getJson('/api/submissions?status=pending'))?.items ?? []);
    const decided = ((await getJson('/api/submissions'))?.items ?? []).filter((s) => s.status !== 'pending');
    const pendingTable = el('table', { 'aria-label': 'Pending submissions' });
    const heads = ['Select', 'Submission', 'Owner', 'Boat', 'Dimension', 'Figure', 'Measured on', 'Submitted', 'Note', 'Result'];
    pendingTable.append(el('thead', {}, el('tr', {}, ...heads.map((h) => el('th', {}, h)))));
    const pendingBody = el('tbody');
    const checks = new Map();
    for (const s of pending) {
        const check = el('input', { type: 'checkbox', 'aria-label': `Select ${s.id}` });
        checks.set(s.id, check);
        pendingBody.append(el('tr', {}, el('td', {}, check), el('td', {}, s.id), el('td', {}, s.submitted_by.display_name), el('td', {}, s.boat_code), el('td', {}, s.dimension), el('td', {}, `${s.as_submitted} · ${screenInt(s.value_mm)} mm (${screenInches(s.value_mm)} in)`), el('td', {}, s.measured_on), el('td', {}, ts(s.submitted_at)), el('td', {}, s.note), el('td', { 'data-result': s.id })));
    }
    pendingTable.append(pendingBody);
    const resultsCell = (id) => pendingBody.querySelector(`td[data-result="${id}"]`);
    const acceptBtn = button('Accept selected', { class: 'tomato' }, async () => {
        const ids = [...checks.entries()].filter(([, c]) => c.checked).map(([id]) => id);
        if (!ids.length)
            return;
        announce('status', 'Saving...');
        const res = await request('POST', '/api/admin/submissions/decisions', {
            decisions: ids.map((id) => ({ id, decision: 'accept' })),
        });
        const body = (await res.json());
        reportBulk(body.results, resultsCell);
    });
    const rejectBtn = button('Reject selected', {}, () => {
        const reason = field('Reason', 'reason');
        openDialog('Reject submissions', [heading(2, 'Reject submissions'), reason.wrap], async (form) => {
            clearErrors(form);
            const ids = [...checks.entries()].filter(([, c]) => c.checked).map(([id]) => id);
            if (!ids.length)
                return;
            const res = await request('POST', '/api/admin/submissions/decisions', {
                decisions: ids.map((id) => ({ id, decision: 'reject', reason: reason.input.value })),
            });
            const body = (await res.json());
            reportBulk(body.results, resultsCell);
        });
    });
    const decidedTable = el('table', { 'aria-label': 'Decided submissions' });
    decidedTable.append(el('thead', {}, el('tr', {}, ...['Submission', 'Owner', 'Boat', 'Dimension', 'Figure', 'Status', 'Decided', 'Reason', 'Action'].map((h) => el('th', {}, h)))));
    const decidedBody = el('tbody');
    for (const s of decided) {
        const cells = [
            el('td', {}, s.id),
            el('td', {}, s.submitted_by.display_name),
            el('td', {}, s.boat_code),
            el('td', {}, s.dimension),
            el('td', {}, `${s.as_submitted} · ${screenInt(s.value_mm)} mm (${screenInches(s.value_mm)} in)`),
            el('td', {}, statusChip(s.status)),
            el('td', {}, s.decided_at ? ts(s.decided_at) : ''),
            el('td', {}, s.reason ?? ''),
        ];
        const action = el('td', {});
        if (s.status === 'accepted') {
            action.append(button(`Reverse ${s.id}`, {}, () => {
                const reason = field('Reason', 'reason');
                openDialog('Reverse submission', [heading(2, 'Reverse submission'), reason.wrap], async (form) => {
                    const res = await request('POST', `/api/submissions/${s.id}/reverse`, { reason: reason.input.value });
                    if (res.status === 200) {
                        announce('status', `Submission ${s.id} reversed.`);
                        location.reload();
                    }
                    else {
                        errorWithField(form, (await res.json()));
                    }
                });
            }));
        }
        cells.push(action);
        decidedBody.append(el('tr', {}, ...cells));
    }
    decidedTable.append(decidedBody);
    app.querySelector('main')?.append(el('p', {}, `${pending.length} pending`), acceptBtn, rejectBtn, pending.length === 0 ? el('div', { class: 'empty-state' }, el('p', { class: 'display' }, 'Every submission has been decided.')) : pendingTable, heading(2, 'Decided'), decidedTable);
}
function reportBulk(results, cellOf) {
    const copy = {
        already_decided: 'Already decided.',
        not_found: 'No such submission.',
        reason_required: 'Give a reason.',
        invalid_decision: 'Choose accept or reject.',
    };
    let applied = 0;
    let refused = 0;
    for (const r of results) {
        if (r.outcome === 'applied')
            applied += 1;
        else {
            refused += 1;
            const cell = cellOf(r.id);
            if (cell)
                cell.textContent = copy[r.reason ?? ''] ?? '';
        }
    }
    announce('status', `${applied} applied, ${refused} refused.`);
}
async function consoleAudit() {
    const table = el('table', { 'aria-label': 'Audit trail' });
    table.append(el('thead', {}, el('tr', {}, ...['When', 'Actor', 'Action', 'Target', 'Before', 'After', 'Reason'].map((h) => el('th', {}, h)))));
    const body = el('tbody');
    table.append(body);
    const load = async (cursor) => {
        const res = await request('GET', `/api/admin/audit${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
        const data = (await res.json());
        body.replaceChildren();
        for (const row of data.items) {
            body.append(el('tr', {}, el('td', {}, ts(String(row['at']))), el('td', {}, String(row['actor_email'])), el('td', {}, String(row['action'])), el('td', {}, String(row['target'])), el('td', {}, JSON.stringify(row['before'] ?? '')), el('td', {}, JSON.stringify(row['after'] ?? '')), el('td', {}, String(row['reason'] ?? ''))));
        }
        return data.next_cursor;
    };
    let next = await load();
    app.querySelector('main')?.append(table, button('Older entries', {}, async () => {
        if (next)
            next = await load(next);
    }));
}
async function consoleStanding(season) {
    const seasonsRes = await getJson('/api/submissions');
    void seasonsRes;
    const data = await getJson(`/api/admin/standing?season=${season}`);
    announce('status', data ? `${data.items.length === 1 ? '1 owner' : `${data.items.length} owners`} in season ${data.season}.` : '');
    const table = el('table', { 'aria-label': 'Tape standing' });
    table.append(el('thead', {}, el('tr', {}, ...['Rank', 'Owner', 'Counted', 'Accepted', 'Rejected', 'Reversed', 'Streak', 'Standing'].map((h) => el('th', {}, h)))));
    const body = el('tbody');
    for (const row of data?.items ?? []) {
        body.append(el('tr', {}, el('td', {}, String(row.rank)), el('td', {}, row.owner_name), el('td', {}, String(row.counted)), el('td', {}, String(row.accepted)), el('td', {}, String(row.rejected)), el('td', {}, String(row.reversed)), el('td', {}, String(row.streak)), el('td', {}, statusChip(row.standing === 'True tape' ? 'issued' : row.standing === 'Steady tape' ? 'held' : 'measuring'))));
    }
    table.append(body);
    app.querySelector('main')?.append(table);
}
async function consoleRoles() {
    const data = await getJson('/api/admin/roles');
    const table = el('table', { 'aria-label': 'Role abilities' });
    table.append(el('thead', {}, el('tr', {}, ...['Ability', 'Sailmaker', 'Loft hand', 'Yacht owner'].map((h) => el('th', {}, h)))));
    const body = el('tbody');
    for (const row of data?.items ?? []) {
        body.append(el('tr', {}, el('td', {}, row.ability), el('td', {}, row.sailmaker), el('td', {}, row['loft-hand']), el('td', {}, row['yacht-owner'])));
    }
    table.append(body);
    app.querySelector('main')?.append(table);
}
async function consoleExport() {
    const a = el('a', { href: '/api/exports/ledger.csv' }, 'Download ledger CSV');
    app.querySelector('main')?.append(a);
}
// ---------------------------------------------------------------------------
// Rule sets and accounts
async function renderRulesets() {
    const session = await requireSession();
    if (!session)
        return;
    document.title = 'Rule sets — Boltrope';
    const rulesets = (await getJson('/api/rulesets'))?.items ?? [];
    const table = el('table', { 'aria-label': 'Rule sets' });
    table.append(el('thead', {}, el('tr', {}, ...['Version', 'Effective at', 'Overlap', 'Roach', 'Tolerance', 'Min offcut width', 'Min offcut length', 'Action'].map((h) => el('th', {}, h)))));
    const body = el('tbody');
    for (const r of rulesets) {
        const actionCell = el('td', {});
        if (new Date(r.effective_at).getTime() > Date.now()) {
            actionCell.append(button(`Edit v${r.version}`, {}, () => void editRulesetDialog(r)));
        }
        body.append(el('tr', {}, el('td', {}, `v${r.version}${r.current ? ' (current)' : ''}`), el('td', {}, ts(r.effective_at)), el('td', {}, String(r.seam_overlap_mm)), el('td', {}, String(r.roach_permille)), el('td', {}, String(r.tolerance_mm)), el('td', {}, String(r.min_offcut_width_mm)), el('td', {}, String(r.min_offcut_length_mm)), actionCell));
    }
    table.append(body);
    screenGroup(navBar(session), el('main', {}, heading(1, 'Rule sets'), button('New rule set', { class: 'tomato' }, () => void newRulesetDialog()), table));
}
function rulesetFields(rs) {
    const fields = [
        field('Seam overlap (mm)', 'seam_overlap_mm', { type: 'number', value: rs ? String(rs.seam_overlap_mm) : '' }),
        field('Roach (permille)', 'roach_permille', { type: 'number', value: rs ? String(rs.roach_permille) : '' }),
        field('Tolerance (mm)', 'tolerance_mm', { type: 'number', value: rs ? String(rs.tolerance_mm) : '' }),
        field('Minimum offcut width (mm)', 'min_offcut_width_mm', { type: 'number', value: rs ? String(rs.min_offcut_width_mm) : '' }),
        field('Minimum offcut length (mm)', 'min_offcut_length_mm', { type: 'number', value: rs ? String(rs.min_offcut_length_mm) : '' }),
        field('Effective at', 'effective_at', { type: 'datetime-local', step: '1' }),
    ];
    return fields.map((f) => f.wrap);
}
async function newRulesetDialog() {
    const fields = rulesetFields();
    openDialog('New rule set', [heading(2, 'New rule set'), ...fields], async (form) => {
        const values = readRulesetFields(form);
        const res = await request('POST', '/api/rulesets', { ...values });
        if (res.status === 201) {
            const rs = (await res.json());
            announce('status', `Rule set v${rs.version} saved.`);
            location.reload();
        }
        else {
            errorWithField(form, (await res.json()));
        }
    });
}
async function editRulesetDialog(rs) {
    const fields = rulesetFields(rs);
    const effectiveAtField = fields[5].querySelector('input');
    effectiveAtField.value = new Date(rs.effective_at).toISOString().slice(0, 19);
    openDialog('Edit rule set', [heading(2, 'Edit rule set'), ...fields], async (form) => {
        const values = readRulesetFields(form);
        const res0 = await fetch('/api/rulesets');
        void res0;
        const res = await request('PATCH', `/api/rulesets/${rs.version}`, { ...values });
        if (res.status === 200) {
            announce('status', `Rule set v${rs.version} saved.`);
            location.reload();
        }
        else {
            errorWithField(form, (await res.json()));
        }
    });
}
function readRulesetFields(form) {
    const get = (name) => form.querySelector(`[name="${name}"]`).value;
    return {
        seam_overlap_mm: Number(get('seam_overlap_mm')),
        roach_permille: Number(get('roach_permille')),
        tolerance_mm: Number(get('tolerance_mm')),
        min_offcut_width_mm: Number(get('min_offcut_width_mm')),
        min_offcut_length_mm: Number(get('min_offcut_length_mm')),
        effective_at: `${get('effective_at').replace(' ', 'T')}Z`,
    };
}
async function renderAccounts() {
    const session = await requireSession();
    if (!session)
        return;
    document.title = 'Accounts — Boltrope';
    const accounts = (await getJson('/api/accounts'))?.items ?? [];
    const table = el('table', { 'aria-label': 'Accounts' });
    table.append(el('thead', {}, el('tr', {}, ...['Account', 'Email', 'Role', 'Action'].map((h) => el('th', {}, h)))));
    const body = el('tbody');
    for (const a of accounts) {
        body.append(el('tr', {}, el('td', {}, a.id), el('td', {}, a.email), el('td', {}, a.role), el('td', {}, button(`Edit ${a.email}`, {}, () => void editAccountDialog(a)), button(`Delete ${a.email}`, {}, async () => {
            const res = await request('DELETE', `/api/accounts/${a.id}`);
            if (res.status === 204) {
                announce('status', 'Saved.');
                location.reload();
            }
            else
                announce('alert', String((await res.json())['message'] ?? ''));
        }))));
    }
    table.append(body);
    screenGroup(navBar(session), el('main', {}, heading(1, 'Accounts'), button('New account', { class: 'tomato' }, () => void newAccountDialog()), table));
}
async function editAccountDialog(account) {
    const name = field('Display name', 'display_name', { value: account.display_name });
    openDialog('Edit account', [heading(2, 'Edit account'), name.wrap], async (form) => {
        const res = await request('PATCH', `/api/accounts/${account.id}`, { display_name: name.input.value });
        if (res.status === 200) {
            announce('status', 'Saved.');
            location.reload();
        }
        else {
            errorWithField(form, (await res.json()));
        }
    });
}
async function newAccountDialog() {
    const name = field('Display name', 'display_name');
    const email = field('Email', 'email', { type: 'email' });
    const password = field('Password', 'password', { type: 'password' });
    const role = select('Role', 'role', [{ value: 'yacht-owner', label: 'Yacht owner' }, { value: 'loft-hand', label: 'Loft hand' }]);
    openDialog('New account', [heading(2, 'New account'), name.wrap, email.wrap, password.wrap, role.wrap], async (form) => {
        const res = await request('POST', '/api/accounts', {
            display_name: name.input.value,
            email: email.input.value,
            password: password.input.value,
            role: role.input.value,
        });
        if (res.status === 201) {
            const account = (await res.json());
            announce('status', `Account created for ${account.email}.`);
            location.reload();
        }
        else {
            errorWithField(form, (await res.json()));
        }
    });
}
// ---------------------------------------------------------------------------
// Owner screens
async function renderOwner() {
    const session = await requireSession();
    if (!session)
        return;
    document.title = 'My boats — Boltrope';
    const boats = (await getJson('/api/boats'))?.items ?? [];
    const submissions = (await getJson('/api/submissions'))?.items ?? [];
    const grants = (await getJson('/api/my/cut-sheets'))?.items ?? [];
    const submitSection = el('section', {});
    for (const boat of boats) {
        submitSection.append(el('h3', {}, `${boat.code} · ${boat.name}`), button('Submit measurement', {}, () => void submitMeasurementDialog(boat.code)));
    }
    const subTable = el('table', { 'aria-label': 'My submissions' });
    subTable.append(el('thead', {}, el('tr', {}, ...['Submission', 'Boat', 'Dimension', 'Figure', 'Measured on', 'Status'].map((h) => el('th', {}, h)))));
    const subBody = el('tbody');
    for (const s of submissions) {
        subBody.append(el('tr', {}, el('td', {}, s.id), el('td', {}, s.boat_code), el('td', {}, s.dimension), el('td', {}, `${s.as_submitted} · ${screenInt(s.value_mm)} mm (${screenInches(s.value_mm)} in)`), el('td', {}, s.measured_on), el('td', {}, statusChip(s.status))));
    }
    subTable.append(subBody);
    const sheetsHeading = heading(2, 'Cut sheets');
    sheetsHeading.id = 'sheets';
    const sheetList = el('ul', {});
    for (const g of grants) {
        sheetList.append(el('li', {}, link(`Open cut sheet ${g.drawing_code}`, `/sheets/${g.id}`)));
    }
    screenGroup(navBar(session), el('main', {}, heading(1, 'My boats'), boats.length === 0 ? el('div', { class: 'empty-state' }, el('p', { class: 'display' }, 'No boat is on your account yet.')) : submitSection, heading(2, 'My submissions'), subTable, sheetsHeading, grants.length === 0 ? el('div', { class: 'empty-state' }, el('p', { class: 'display' }, 'No cut sheet has been shared with you yet.')) : sheetList));
}
async function submitMeasurementDialog(boatCode) {
    const dimension = select('Dimension', 'dimension', ['I', 'J', 'P', 'E', 'LL', 'LP'].map((d) => ({ value: d, label: d })));
    const value = field('Measured length', 'value_text');
    const unit = select('Unit', 'unit', [{ value: 'mm', label: 'mm' }, { value: 'in', label: 'in' }]);
    const on = field('Measured on', 'measured_on', { type: 'date' });
    const note = field('Note', 'note');
    openDialog('Submit measurement', [heading(2, 'Submit measurement'), dimension.wrap, value.wrap, unit.wrap, on.wrap, note.wrap], async (form) => {
        clearErrors(form);
        announce('status', 'Sending to the loft...');
        const body = {
            dimension: dimension.input.value,
            measured_on: on.input.value,
            note: note.input.value,
        };
        if (unit.input.value === 'mm')
            body['value_mm'] = value.input.value;
        else
            body['value_in'] = value.input.value;
        const res = await request('POST', `/api/boats/${boatCode}/submissions`, body);
        if (res.status === 201) {
            announce('status', 'Submission sent to the loft.');
            location.reload();
        }
        else if (res.status === 429) {
            const retryAfter = res.headers.get('retry-after') ?? '1';
            errorFor(value.wrap, `Too many requests from this account. Try again in ${retryAfter} seconds.`);
            announce('alert', `Too many requests from this account. Try again in ${retryAfter} seconds.`);
        }
        else {
            errorWithField(form, (await res.json()));
        }
    });
}
async function renderSheetViewer(grantId) {
    const session = await requireSession();
    if (!session)
        return;
    document.title = 'Cut sheet — Boltrope';
    const grant = await getJson(`/api/grants/${grantId}`);
    const imgWrap = el('div', { class: 'panel' });
    const accountRegion = el('section', { 'aria-label': 'Sail account' });
    const build = async () => {
        const grantNow = await getJson(`/api/grants/${grantId}`);
        if (!grantNow || grantNow.status !== 'granted') {
            imgWrap.replaceChildren();
            accountRegion.replaceChildren();
            screenGroup(navBar(session), el('main', { class: 'field-black' }, heading(1, `Cut sheet ${grant?.drawing_code ?? ''}`), el('p', {}, 'That cut sheet is not shared with you.')));
            return false;
        }
        const account = await getJson(`/api/drawings/${grantNow.drawing_code}/account`);
        imgWrap.replaceChildren(heading(1, `Cut sheet ${grantNow.drawing_code}`), el('img', { alt: `Cut sheet ${grantNow.drawing_code}`, src: `/api/grants/${grantId}/cut-sheet`, style: 'width:100%;max-width:900px' }));
        if (account)
            accountRegion.replaceChildren(sailAccountBody(account, false));
        screenGroup(navBar(session), el('main', {}, imgWrap, accountRegion));
        return true;
    };
    const alive = await build();
    if (alive) {
        window.setInterval(async () => {
            const ok = await build();
            if (!ok)
                announce('alert', 'That cut sheet is not shared with you.');
        }, 5000);
    }
}
// ---------------------------------------------------------------------------
// Router and not-found
function renderNotFound() {
    document.title = 'Not found — Boltrope';
    screenGroup(el('main', { class: 'field-black' }, heading(1, 'That page is not in the loft.')));
}
async function route() {
    const path = location.pathname;
    if (path === '/') {
        renderLanding();
        return;
    }
    if (path === '/signin') {
        await renderSignIn();
        return;
    }
    if (path === '/loft') {
        await renderLoft();
        return;
    }
    let m = /^\/boats\/([^/]+)$/.exec(path);
    if (m) {
        await renderBoat(m[1]);
        return;
    }
    m = /^\/drawings\/([^/]+)$/.exec(path);
    if (m) {
        await renderDrawingOverview(m[1]);
        return;
    }
    m = /^\/drawings\/([^/]+)\/(measure|draw|nest|confirm)$/.exec(path);
    if (m) {
        const [, code, step] = m;
        const drawing = await getJson(`/api/drawings/${code}`);
        if (!drawing) {
            renderNotFound();
            return;
        }
        if (step !== drawing.step && !(step === 'measure' && drawing.step === 'draw' || step === 'measure' && drawing.step === 'nest' || step === 'measure' && drawing.step === 'confirm')) {
            announce('alert', `Finish the ${drawing.step[0].toUpperCase()}${drawing.step.slice(1)} step first.`);
            history.replaceState(null, '', `/drawings/${code}/${drawing.step}`);
        }
        if (step === 'measure') {
            await renderMeasureStep(code);
            return;
        }
        if (step === 'draw') {
            await renderDrawStep(code);
            return;
        }
        if (step === 'nest') {
            await renderNest(code, false);
            return;
        }
        await renderConfirmStep(code);
        return;
    }
    if (path === '/floor') {
        await renderFloor();
        return;
    }
    m = /^\/floor\/([^/]+)$/.exec(path);
    if (m) {
        await renderNest(m[1], true);
        return;
    }
    if (path === '/stock') {
        await renderStock();
        return;
    }
    if (path === '/ledger') {
        await renderLedger();
        return;
    }
    if (path === '/console') {
        await renderConsole();
        return;
    }
    if (path === '/rulesets') {
        await renderRulesets();
        return;
    }
    if (path === '/accounts') {
        await renderAccounts();
        return;
    }
    if (path === '/owner') {
        await renderOwner();
        return;
    }
    m = /^\/sheets\/([^/]+)$/.exec(path);
    if (m) {
        await renderSheetViewer(m[1]);
        return;
    }
    renderNotFound();
}
async function renderMeasureStep(code) {
    const session = await requireSession();
    if (!session)
        return;
    const drawing = await getJson(`/api/drawings/${code}`);
    if (!drawing) {
        renderNotFound();
        return;
    }
    document.title = `Measure ${drawing.code} — Boltrope`;
    const used = drawing.sail === 'mainsail' ? ['P', 'E'] : ['LL', 'LP'];
    const table = el('table', { 'aria-label': 'Used dimensions' });
    table.append(el('thead', {}, el('tr', {}, el('th', {}, 'Dimension'), el('th', {}, 'Value'))));
    const boat = await getJson(`/api/boats/${drawing.boat_code}`);
    const body = el('tbody');
    for (const key of used) {
        const dim = boat?.dimensions.find((d) => d.key === key);
        body.append(el('tr', {}, el('td', {}, key), el('td', { class: 'num' }, dim && dim.value_mm !== null ? `${screenInt(dim.value_mm)} mm (${screenInches(dim.value_mm)} in)` : ''), el('td', {}, dim ? statusChip(dim.status === 'remeasure' ? 'remeasure' : 'measured') : '')));
    }
    table.append(body);
    screenGroup(navBar(session), el('main', {}, heading(1, `Measure ${drawing.code}`), stepsRail(code, 'measure'), button('Record measurement', { class: 'tomato' }, () => void recordMeasurementDialog(drawing.boat_code, used)), table));
    app.querySelector('h1').focus();
}
void route();
export {};
