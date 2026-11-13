// One holding, the breaches list and one breach, plus the Add / Edit holding dialog they share with the ledger.
import { announceExposure, app, notFound } from './app.js';
import { FAILED, Latest, call, errorCode, errorMessage, failedWithoutBody, get } from './api.js';
import {
  LEVEL_LABEL, busy, clearFieldErrors, h, icon, levelBadge, nextId, openDialog, setText, showAlert,
  showFieldErrors, syncKeyed,
} from './dom.js';

const HOLDING_LABELS = { company: 'Company', data_kind: 'Data kind', value: 'Value', notes: 'Notes' };

async function currentScore() {
  const answer = await get('/api/exposure');
  return answer.status === 200 ? answer.body.score : null;
}

// --------------------------------------------------------------------------- Add / Edit holding

export function openHoldingDialog({ mode, holding = null, opener, saved, draft = null }) {
  const id = nextId('holding');
  const values = draft?.fields || (holding ? { company: holding.company, data_kind: holding.data_kind, value: holding.value, notes: holding.notes }
    : { company: '', data_kind: '', value: '', notes: '' });
  const version = draft?.version ?? holding?.version;
  const company = h('input', { id: `${id}-company`, class: 'input', type: 'text', 'data-field': 'company', value: values.company, autocomplete: 'off' });
  const kind = h('select', { id: `${id}-kind`, class: 'select', 'data-field': 'data_kind' },
    h('option', { value: '', text: 'Choose a data kind' }), app.kinds.map((k) => h('option', { value: k.code, text: k.label })));
  kind.value = values.data_kind;
  const value = h('input', { id: `${id}-value`, class: 'input input-mono', type: 'text', 'data-field': 'value', value: values.value, autocomplete: 'off', spellcheck: 'false' });
  const notes = h('textarea', { id: `${id}-notes`, class: 'input textarea', 'data-field': 'notes', rows: '3' });
  notes.value = values.notes;
  const save = h('button', { type: 'submit', class: 'button button-primary', text: 'Save holding' });
  const summary = h('div', { class: 'summary-slot' });
  const alerts = h('div', { class: 'alert-slot' });
  const field = (input, label) => h('div', { class: 'field' }, h('label', { class: 'field-label', for: input.id, text: label }), input);
  const form = h('form', { class: 'dialog-form', novalidate: true },
    summary, alerts, field(company, 'Company'), field(kind, 'Data kind'), field(value, 'Value'), field(notes, 'Notes'),
    h('div', { class: 'actions' }, save, h('button', { type: 'button', class: 'button button-secondary', text: 'Cancel', onclick: () => handle.close() })));
  const handle = openDialog({
    title: mode === 'add' ? 'Add holding' : 'Edit holding', opener, content: form,
    initialFocus: () => (draft ? save : company),
  });
  if (draft) announceDraft();
  let saving = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    busy(save, true);
    alerts.replaceChildren();
    const fields = { company: company.value, data_kind: kind.value, value: value.value, notes: notes.value };
    const body = { ...fields };
    if (!body.data_kind) delete body.data_kind;
    const answer = mode === 'add' ? await call('POST', '/api/holdings', body)
      : await call('PATCH', `/api/holdings/${holding.id}`, { version, ...body });
    saving = false;
    busy(save, false);
    if (answer.status === 200 || answer.status === 201) {
      handle.close();
      announceExposure(`Holding saved. Exposure score ${answer.body.exposure.score}.`);
      saved?.(answer.body);
    } else if (answer.status === 401) {
      app.sessionEnded({ kind: mode === 'add' ? 'holding-add' : 'holding-edit', fields, version });
    } else if (answer.status === 422) {
      showFieldErrors(form, summary, answer.body.error.fields || {}, HOLDING_LABELS);
    } else {
      showAlert(alerts, failedWithoutBody(answer) ? FAILED : errorMessage(answer) || FAILED, { focus: true });
    }
  });
  clearFieldErrors(form, summary);
  return handle;
}

function announceDraft() {
  setText(app.draftStatus, '');
  setText(app.draftStatus, 'Your session ended. Your unsaved entries were kept; check them and save again.');
}

/** An alert dialog whose confirm button turns disabled on the first press, so a double click sends one request. */
function confirmDialog({ title, text, confirm, opener, act }) {
  const yes = h('button', { type: 'button', class: 'button button-danger', text: confirm });
  const keep = h('button', { type: 'button', class: 'button button-secondary', text: 'Keep', onclick: () => handle.close() });
  const alerts = h('div', { class: 'alert-slot' });
  const handle = openDialog({
    title, role: 'alertdialog', opener,
    content: h('div', { class: 'dialog-form' }, h('p', { class: 'dialog-text', text }), alerts, h('div', { class: 'actions' }, keep, yes)),
    initialFocus: () => keep,
  });
  yes.addEventListener('click', async () => {
    if (yes.disabled) return;
    busy(yes, true);
    const failure = await act(handle);
    if (failure) {
      busy(yes, false);
      showAlert(alerts, failure, { focus: true });
    }
  });
  return handle;
}

// --------------------------------------------------------------------------- holding detail

export function mountHolding(main, rawId) {
  let alive = true;
  let holding = null;
  let rules = [];
  document.title = 'Holding · Strongroom Ledger';
  const title = h('h1', { class: 'page-title' });
  const facts = h('dl', { class: 'facts' });
  const graded = h('p', { class: 'graded' });
  const alerts = h('div', { class: 'alert-slot' });
  const edit = h('button', { type: 'button', class: 'button button-secondary', onclick: () => openEdit() }, icon('edit'), h('span', { text: 'Edit holding' }));
  const remove = h('button', { type: 'button', class: 'button button-danger-quiet', onclick: () => confirmDelete() }, icon('trash'), h('span', { text: 'Delete holding' }));
  // The record paints once, with its data, so nothing shifts under the pointer.
  const record = h('article', { class: 'record', hidden: true }, title, graded, facts, alerts, h('div', { class: 'actions' }, edit, remove));
  main.replaceChildren(h('div', { class: 'screen screen-record' },
    h('p', { class: 'crumb' }, h('a', { href: '/vault', text: 'Ledger' })), record));

  async function load() {
    const [answer, ruleAnswer] = await Promise.all([get(`/api/holdings/${rawId}`), get('/api/rules')]);
    if (!alive) return;
    if (answer.status === 404) {
      notFound();
      return;
    }
    if (answer.status !== 200) return;
    holding = answer.body.holding;
    if (ruleAnswer.status === 200) rules = ruleAnswer.body.rules;
    const rule = rules.find((r) => r.id === holding.rule_id);
    setText(title, `${holding.company} · ${app.kindLabel[holding.data_kind]}`);
    document.title = `${holding.company} · Strongroom Ledger`;
    setText(graded, rule ? `Graded by ${rule.label}` : 'No rule matched');
    const rows = [
      ['Company', holding.company], ['Data kind', app.kindLabel[holding.data_kind]], ['Level', levelBadge(holding.level)],
      ['Value', h('span', { class: 'value', text: holding.value })], ['Notes', holding.notes || '—'],
      ['Affected', holding.affected ? 'yes' : 'no'],
    ];
    facts.replaceChildren(...rows.flatMap(([term, detail]) => [h('dt', { text: term }), h('dd', {}, detail)]));
    record.hidden = false;
    const draft = app.takeDraft('holding-edit');
    if (draft) openEdit(draft);
  }

  function openEdit(draft = null) {
    if (!holding) return;
    openHoldingDialog({ mode: 'edit', holding, opener: edit, draft, saved: () => load() });
  }

  function confirmDelete() {
    confirmDialog({
      title: 'Delete holding?', text: 'The holding leaves the ledger, the score, every breach and the shared view.',
      confirm: 'Delete', opener: remove,
      act: async (handle) => {
        const answer = await call('DELETE', `/api/holdings/${holding.id}`);
        if (answer.status === 204 || answer.status === 404) {
          const score = await currentScore();
          handle.close();
          app.navigate('/vault');
          app.screen?.focusAddHolding?.();
          if (score !== null) announceExposure(`Holding deleted. Exposure score ${score}.`);
          return null;
        }
        if (answer.status === 401) {
          app.sessionEnded();
          return null;
        }
        return failedWithoutBody(answer) ? FAILED : errorMessage(answer);
      },
    });
  }

  load();
  return {
    live: () => load(),
    destroy() { alive = false; },
  };
}

// --------------------------------------------------------------------------- breaches list

export function mountBreaches(main) {
  let alive = true;
  document.title = 'Breaches · Strongroom Ledger';
  const list = h('ul', { class: 'breach-list' });
  const empty = h('p', { class: 'empty', hidden: true, text: 'No breaches logged.' });
  main.replaceChildren(h('div', { class: 'screen screen-breaches' },
    h('div', { class: 'pane-head' }, h('h1', { class: 'page-title', text: 'Breaches' })),
    h('p', { class: 'lede', text: 'Newest announcement first. Log a new breach from the ledger.' }), list, empty));

  async function load() {
    const answer = await get('/api/breaches');
    if (!alive || answer.status !== 200) return;
    const breaches = answer.body.breaches;
    empty.hidden = breaches.length > 0;
    syncKeyed(list, breaches, (b) => b.id, () => h('li', { class: 'breach-item' },
      h('a', { class: 'breach-link' }), h('span', { class: 'breach-kinds' }), h('span', { class: 'breach-count' })),
    (el, b) => {
      const link = el.querySelector('a');
      link.setAttribute('href', `/vault/breaches/${b.id}`);
      link.replaceChildren(`${b.company} — `, h('span', { class: 'num', text: b.announced_on }));
      setText(el.querySelector('.breach-kinds'), b.data_kinds.map((k) => app.kindLabel[k]).join(', '));
      const n = b.affected_holding_ids.length;
      setText(el.querySelector('.breach-count'), `${n} ${n === 1 ? 'holding' : 'holdings'} touched`);
    });
  }

  load();
  return { live: () => load(), destroy() { alive = false; } };
}

// --------------------------------------------------------------------------- breach detail

export function mountBreach(main, rawId) {
  let alive = true;
  let breach = null;
  let version = null;
  let saving = false;
  const projection = new Latest();
  document.title = 'Breach · Strongroom Ledger';
  const title = h('h1', { class: 'page-title' });
  const meta = h('p', { class: 'lede' });
  const score = h('p', { class: 'record-score' });
  const boxes = app.kinds.map((kind) => h('input', { type: 'checkbox', class: 'checkbox', value: kind.code, id: `bk-${kind.code}` }));
  const group = h('fieldset', { class: 'kinds', 'data-field': 'data_kinds', id: 'breach-kinds' },
    h('legend', { class: 'field-label', text: 'Data kinds' }),
    h('div', { class: 'kinds-grid' }, app.kinds.map((kind, i) => h('label', { class: 'check-row', for: boxes[i].id }, boxes[i], h('span', { text: kind.label })))));
  const projected = h('p', { class: 'projected', 'aria-live': 'polite' });
  const saveKinds = h('button', { type: 'submit', class: 'button button-primary', text: 'Save kinds' });
  const removeButton = h('button', { type: 'button', class: 'button button-danger-quiet', onclick: () => confirmRemove() }, icon('trash'), h('span', { text: 'Remove breach' }));
  const summary = h('div', { class: 'summary-slot' });
  const alerts = h('div', { class: 'alert-slot' });
  const form = h('form', { class: 'kinds-form', novalidate: true, 'aria-labelledby': 'kinds-title' },
    h('h2', { class: 'section-label', id: 'kinds-title', text: 'What was exposed' }), summary, alerts, group,
    h('div', { class: 'actions actions-split' }, h('div', { class: 'actions' }, saveKinds, projected), removeButton));
  const affectedBody = h('tbody', { role: 'rowgroup' });
  const affected = h('table', { class: 'compact', 'aria-label': 'Affected holdings' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Company' }), h('th', { scope: 'col', text: 'Data kind' }), h('th', { scope: 'col', text: 'Level' }))),
    affectedBody);
  const affectedEmpty = h('p', { class: 'empty', hidden: true, text: 'This breach touches none of your holdings.' });
  const steps = h('ul', { class: 'steps', 'aria-label': 'Steps for this breach' });
  main.replaceChildren(h('div', { class: 'screen screen-record' },
    h('p', { class: 'crumb' }, h('a', { href: '/vault/breaches', text: 'Breaches' })),
    h('div', { class: 'record-grid', hidden: true },
      h('article', { class: 'record' }, title, meta, score, form),
      h('section', { class: 'record-side', 'aria-labelledby': 'affected-title' },
        h('h2', { class: 'section-label', id: 'affected-title', text: 'Holdings it touches' }), affected, affectedEmpty,
        h('h2', { class: 'section-label', text: 'Steps for this breach' }), steps))));

  const ticked = () => boxes.filter((b) => b.checked).map((b) => b.value);
  const sameAsSaved = () => breach && ticked().join() === breach.data_kinds.join();

  function setTicks(kinds) {
    for (const box of boxes) box.checked = kinds.includes(box.value);
  }

  async function load({ first = false } = {}) {
    const [answer, exposure] = await Promise.all([get(`/api/breaches/${rawId}`), get('/api/exposure')]);
    if (!alive) return;
    if (answer.status === 404) {
      notFound();
      return;
    }
    if (answer.status !== 200) return;
    breach = answer.body.breach;
    if (first) {
      version = breach.version;
      setTicks(breach.data_kinds);
    }
    setText(title, `Breach at ${breach.company}`);
    document.title = `Breach at ${breach.company} · Strongroom Ledger`;
    meta.replaceChildren('Announced on ', h('span', { class: 'num', text: breach.announced_on }));
    if (exposure.status === 200) setText(score, `Exposure score ${exposure.body.score}, ${exposure.body.band}`);
    nearby = new Map();
    affectedEmpty.hidden = answer.body.holdings.length > 0;
    affected.hidden = answer.body.holdings.length === 0;
    syncKeyed(affectedBody, answer.body.holdings, (x) => x.id, () => h('tr', {}, h('td', {}), ' ', h('td', {}), ' ', h('td', {})), (el, x) => {
      const [a, b, c] = el.children;
      setText(a, x.company);
      setText(b, app.kindLabel[x.data_kind]);
      if (c.dataset.level !== x.level) {
        c.dataset.level = x.level;
        c.replaceChildren(levelBadge(x.level));
      }
    });
    syncKeyed(steps, answer.body.steps, (x) => x.id, () => h('li', { class: 'step step-readonly' },
      h('span', { class: 'step-text' }), h('span', { class: 'step-meta' }, h('span', {}), ' · ', h('span', { class: 'step-pts' })),
      h('span', { class: 'step-state' })), (el, x) => {
      el.classList.toggle('done', x.status === 'done');
      setText(el.querySelector('.step-text'), x.text);
      setText(el.querySelector('.step-meta').firstElementChild, `${x.company} · ${LEVEL_LABEL[x.level]}`);
      setText(el.querySelector('.step-pts'), `${x.points} pts`);
      setText(el.querySelector('.step-state'), x.status === 'done' ? 'Done' : 'Open');
    });
    if (first) {
      // The page paints once its data and the projections one tick away are in, so a tick shows its score at once.
      await prefetchNearby();
      if (!alive) return;
      main.querySelector('.record-grid').hidden = false;
      const draft = app.takeDraft('breach-kinds');
      if (draft) {
        setTicks(draft.data_kinds);
        version = draft.version;
        saveKinds.focus();
        setText(app.draftStatus, 'Your session ended. Your unsaved entries were kept; check them and save again.');
        project();
      }
      return;
    }
    project();
  }

  // The server's projections one tick away from the current ticks, fetched ahead so a tick shows its score at once.
  let nearby = new Map();
  let nearbyRound = 0;
  const tickKey = (kinds) => [...kinds].sort().join();

  async function prefetchNearby() {
    nearbyRound += 1;
    const round = nearbyRound;
    const found = new Map();
    const base = new Set(ticked());
    // Unticking a logged kind is the likeliest edit, so those projections are asked for first.
    const codes = app.kinds.map((k) => k.code).sort((a, b) => Number(base.has(b)) - Number(base.has(a)));
    await Promise.all(codes.map(async (code) => {
      const kinds = base.has(code) ? [...base].filter((k) => k !== code) : [...base, code];
      const answer = await call('POST', '/api/breaches/preview', { company: breach.company, data_kinds: kinds, breach_id: breach.id });
      if (answer.status === 200) found.set(tickKey(kinds), answer.body.score);
    }));
    if (round === nearbyRound && alive) nearby = found;
  }

  async function project() {
    if (sameAsSaved()) {
      projection.cancel();
      setText(projected, '');
    } else {
      const known = nearby.get(tickKey(ticked()));
      if (known !== undefined) setText(projected, `Projected score ${known}`);
      const answer = await projection.run('POST', '/api/breaches/preview', { company: breach.company, data_kinds: ticked(), breach_id: breach.id });
      if (!answer || !alive) return;
      if (answer.status === 200) setText(projected, `Projected score ${answer.body.score}`);
    }
    prefetchNearby();
  }

  for (const box of boxes) box.addEventListener('change', () => project());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving || !breach) return;
    saving = true;
    busy(saveKinds, true);
    alerts.replaceChildren();
    const kinds = ticked();
    const answer = await call('PATCH', `/api/breaches/${breach.id}`, { version, data_kinds: kinds });
    saving = false;
    busy(saveKinds, false);
    if (answer.status === 200) {
      breach = answer.body.breach;
      version = breach.version;
      clearFieldErrors(form, summary);
      projection.cancel();
      setText(projected, '');
      announceExposure(`Breach updated. Exposure score ${answer.body.exposure.score}.`);
      load();
    } else if (answer.status === 401) {
      app.sessionEnded({ kind: 'breach-kinds', data_kinds: kinds, version });
    } else if (errorCode(answer) === 'stale_version') {
      const fresh = await get(`/api/breaches/${breach.id}`);
      if (fresh.status === 200) {
        breach = fresh.body.breach;
        version = breach.version;
        setTicks(breach.data_kinds);
      }
      projection.cancel();
      setText(projected, '');
      showAlert(alerts, errorMessage(answer), { focus: true });
      load();
    } else if (answer.status === 422) {
      showFieldErrors(form, summary, answer.body.error.fields || {}, { data_kinds: 'Data kinds' });
    } else if (answer.status === 404) {
      notFound();
    } else {
      showAlert(alerts, failedWithoutBody(answer) ? FAILED : errorMessage(answer) || FAILED, { focus: true });
    }
  });

  function confirmRemove() {
    confirmDialog({
      title: 'Remove breach?', text: 'Its touched holdings, steps and score contribution go with it.',
      confirm: 'Remove', opener: removeButton,
      act: async (handle) => {
        const answer = await call('DELETE', `/api/breaches/${breach.id}`);
        if (answer.status === 204 || answer.status === 404) {
          const now = await currentScore();
          handle.close();
          app.navigate('/vault/breaches');
          if (now !== null) announceExposure(`Breach removed. Exposure score ${now}.`);
          return null;
        }
        if (answer.status === 401) {
          app.sessionEnded();
          return null;
        }
        return failedWithoutBody(answer) ? FAILED : errorMessage(answer);
      },
    });
  }

  load({ first: true });
  return {
    live: () => load(),
    destroy() { alive = false; projection.cancel(); },
  };
}

