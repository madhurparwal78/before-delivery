// Grading rules: add, edit, delete, and reorder by pointer or keyboard with a live Preview of every level.
import { announceExposure, app } from './app.js';
import { FAILED, Latest, call, errorCode, errorMessage, failedWithoutBody, get, listedHoldings } from './api.js';
import {
  LEVELS, LEVEL_LABEL, announce, busy, clearFieldErrors, h, icon, levelBadge, nextId, openDialog, setText, showAlert,
  showFieldErrors, syncKeyed,
} from './dom.js';

const PREVIEW_EVERY_MS = 150;
const REFUSED = 'The rules changed in another window. The order was not saved.';
const RULE_LABELS = { data_kind: 'Data kind', company_contains: 'Company contains', level: 'Level', priority: 'Priority' };

export function mountRules(main) {
  let alive = true;
  let rules = [];
  let holdings = [];
  let savedScore = 0;
  let lift = null;
  let pendingRedraw = false;
  const preview = new Latest();
  document.title = 'Rules · Strongroom Ledger';

  const list = h('ul', { class: 'rules', role: 'list', 'aria-label': 'Rules' });
  const orderStatus = h('p', { class: 'sr-only', role: 'status', 'aria-label': 'Rule order' });
  const alerts = h('div', { class: 'alert-slot' });
  const addRule = h('button', { type: 'button', class: 'button button-secondary', onclick: () => openRuleDialog(null, addRule) },
    icon('plus'), h('span', { text: 'Add rule' }));
  const previewBody = h('tbody', {});
  const projected = h('p', { class: 'projected-line' });
  const projectedNumber = h('span', { class: 'projected-number' });
  projected.append('Projected score ', projectedNumber, ' ');
  const previewRegion = h('section', { class: 'preview', 'aria-label': 'Preview' },
    projected,
    h('h2', { class: 'section-label', text: 'Levels under this order' }),
    h('table', { class: 'compact', 'aria-label': 'Preview levels' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Company' }), h('th', { scope: 'col', text: 'Data kind' }), h('th', { scope: 'col', text: 'Level' }))),
      previewBody));
  main.replaceChildren(h('div', { class: 'screen screen-rules' },
    h('div', { class: 'layout layout-rules', hidden: true },
      previewRegion,
      h('section', { class: 'rules-pane', 'aria-labelledby': 'rules-title' },
        h('div', { class: 'pane-head' }, h('div', {}, h('h1', { class: 'page-title', id: 'rules-title', text: 'Grading rules' }),
          h('p', { class: 'lede', text: 'The lowest priority number that matches decides a holding’s level. Drag a rule, or focus its handle and press Space.' })), addRule),
        alerts, list, orderStatus))));

  // ---------------------------------------------------------------- rendering

  function renderRules(ordered) {
    syncKeyed(list, ordered, (r) => r.id, createRule, updateRule);
  }

  function createRule(rule) {
    const handle = h('button', { type: 'button', class: 'handle' }, icon('grip'));
    const editButton = h('button', { type: 'button', class: 'button button-quiet', onclick: () => openRuleDialog(currentRule(ruleRow), editButton) },
      icon('edit'), h('span', { class: 'button-text', text: 'Edit' }));
    const deleteButton = h('button', { type: 'button', class: 'button button-quiet button-danger-text', onclick: () => deleteRule(currentRule(ruleRow)) },
      icon('trash'), h('span', { class: 'button-text', text: 'Delete' }));
    const ruleRow = h('li', { class: 'rule' }, handle,
      h('span', { class: 'rule-priority' }), h('span', { class: 'rule-label' }),
      h('span', { class: 'rule-actions' }, editButton, deleteButton));
    ruleRow.dataset.id = rule.id;
    handle.addEventListener('keydown', (event) => keyMove(event, ruleRow));
    handle.addEventListener('pointerdown', (event) => pointerLift(event, ruleRow));
    return ruleRow;
  }

  function updateRule(el, rule) {
    const [handle, priority, label, actions] = el.children;
    handle.setAttribute('aria-label', `Move rule: ${rule.label}`);
    setText(priority, String(rule.priority));
    priority.setAttribute('aria-label', `Priority ${rule.priority}`);
    setText(label, rule.label);
    actions.children[0].setAttribute('aria-label', `Edit rule: ${rule.label}`);
    actions.children[1].setAttribute('aria-label', `Delete rule: ${rule.label}`);
  }

  function currentRule(ruleRow) {
    return rules.find((r) => r.id === ruleRow.dataset.key);
  }

  function renderPreview(levels, score) {
    const levelOf = new Map(levels.map((x) => [x.holding_id, x.level]));
    syncKeyed(previewBody, holdings, (x) => x.id, () => h('tr', {}, h('td', {}), ' ', h('td', {}), ' ', h('td', {})), (el, x) => {
      const [company, kind, level] = el.children;
      setText(company, x.company);
      setText(kind, app.kindLabel[x.data_kind]);
      const now = levelOf.get(x.id) || x.level;
      if (level.dataset.level !== now) {
        level.dataset.level = now;
        level.replaceChildren(levelBadge(now));
      }
    });
    setText(projectedNumber, String(score));
  }

  function showSaved() {
    renderPreview(holdings.map((x) => ({ holding_id: x.id, level: x.level })), savedScore);
  }

  async function load() {
    const [ruleAnswer, listing] = await Promise.all([get('/api/rules'), get('/api/holdings')]);
    if (!alive || ruleAnswer.status !== 200 || listing.status !== 200) return;
    rules = ruleAnswer.body.rules;
    holdings = listedHoldings(listing.body);
    savedScore = listing.body.exposure.score;
    if (!lift) {
      renderRules(rules);
      showSaved();
    }
    main.querySelector('.layout-rules').hidden = false;
  }

  // ---------------------------------------------------------------- reorder

  const ruleRows = () => [...list.children];
  const orderNow = () => ruleRows().map((el) => el.dataset.key);
  const position = (ruleRow) => ruleRows().indexOf(ruleRow) + 1;
  let lastPreviewAt = -Infinity;
  let previewTimer = 0;

  function schedulePreview() {
    clearTimeout(previewTimer);
    const wait = lastPreviewAt + PREVIEW_EVERY_MS - performance.now();
    if (wait <= 0) runPreview();
    else previewTimer = setTimeout(runPreview, wait);
  }

  async function runPreview() {
    lastPreviewAt = performance.now();
    const answer = await preview.run('POST', '/api/rules/preview', { rule_ids: orderNow() });
    if (answer?.status === 200 && lift) renderPreview(answer.body.levels, answer.body.score);
  }

  /** Moves the lifted rule by moving its neighbours, so the focused handle never leaves the document. */
  function shift(ruleRow, delta) {
    if (delta < 0 && ruleRow.previousElementSibling) ruleRow.after(ruleRow.previousElementSibling);
    else if (delta > 0 && ruleRow.nextElementSibling) ruleRow.before(ruleRow.nextElementSibling);
    else return false;
    return true;
  }

  function begin(ruleRow, mode) {
    lift = { ruleRow, mode, start: orderNow(), label: currentRule(ruleRow).label };
    ruleRow.classList.add('lifted');
    list.classList.add('reordering');
  }

  function finish() {
    clearTimeout(previewTimer);
    lift?.ruleRow.classList.remove('lifted');
    list.classList.remove('reordering');
    lift = null;
  }

  function cancelMove(announceIt = true) {
    if (!lift) return;
    const { ruleRow, start } = lift;
    preview.cancel();
    finish();
    const byId = new Map(ruleRows().map((el) => [el.dataset.key, el]));
    for (const id of start) list.append(byId.get(id));
    ruleRow.querySelector('.handle').focus();
    showSaved();
    if (announceIt) announce(orderStatus, 'Move cancelled.');
    flushRedraw();
  }

  async function drop() {
    const { ruleRow, label } = lift;
    const order = orderNow();
    const changed = order.join() !== lift.start.join();
    preview.cancel();
    finish();
    announce(orderStatus, `Dropped ${label}. Position ${position(ruleRow)} of ${order.length}.`);
    const handle = ruleRow.querySelector('.handle');
    if (!changed) {
      showSaved();
      flushRedraw();
      return;
    }
    const answer = await call('PUT', '/api/rules/order', { rule_ids: order });
    if (!alive) return;
    if (answer.status === 200) {
      rules = answer.body.rules;
      renderRules(rules);
      announceExposure(`Rule order saved. Exposure score ${answer.body.exposure.score}.`);
      await load();
    } else if (answer.status === 401) {
      app.sessionEnded();
      return;
    } else {
      showAlert(alerts, REFUSED);
      await load();
      renderRules(rules);
      showSaved();
    }
    if (document.contains(handle)) handle.focus();
  }

  function keyMove(event, ruleRow) {
    const handle = event.currentTarget;
    if (!lift && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault();
      begin(ruleRow, 'keyboard');
      announce(orderStatus, `Picked up ${lift.label}. Position ${position(ruleRow)} of ${ruleRows().length}.`);
      return;
    }
    if (!lift || lift.ruleRow !== ruleRow || lift.mode !== 'keyboard') return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (shift(ruleRow, event.key === 'ArrowUp' ? -1 : 1)) {
        handle.focus();
        announce(orderStatus, `Position ${position(ruleRow)} of ${ruleRows().length}.`);
        schedulePreview();
      }
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      drop();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelMove();
    }
  }

  function pointerLift(event, ruleRow) {
    if (lift || event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.focus();
    begin(ruleRow, 'pointer');
    announce(orderStatus, `Picked up ${lift.label}. Position ${position(ruleRow)} of ${ruleRows().length}.`);
    const move = (moveEvent) => {
      const y = moveEvent.clientY;
      let moved = false;
      for (;;) {
        const prev = ruleRow.previousElementSibling;
        const next = ruleRow.nextElementSibling;
        if (prev && y < midpoint(prev)) moved = shift(ruleRow, -1) || moved;
        else if (next && y > midpoint(next)) moved = shift(ruleRow, 1) || moved;
        else break;
      }
      if (moved) {
        announce(orderStatus, `Position ${position(ruleRow)} of ${ruleRows().length}.`);
        schedulePreview();
      }
    };
    const end = (endEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('keydown', escape, true);
      if (!lift) return;
      const box = list.getBoundingClientRect();
      const inside = endEvent.type === 'pointerup' && endEvent.clientX >= box.left && endEvent.clientX <= box.right
        && endEvent.clientY >= box.top && endEvent.clientY <= box.bottom;
      if (inside) drop();
      else cancelMove();
    };
    const escape = (keyEvent) => {
      if (keyEvent.key !== 'Escape' || !lift) return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('keydown', escape, true);
      cancelMove();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('keydown', escape, true);
  }

  function midpoint(el) {
    const box = el.getBoundingClientRect();
    return box.top + box.height / 2;
  }

  function flushRedraw() {
    if (pendingRedraw) {
      pendingRedraw = false;
      load();
    }
  }

  // ---------------------------------------------------------------- add, edit, delete

  function openRuleDialog(rule, opener) {
    const id = nextId('rule');
    const kind = h('select', { id: `${id}-kind`, class: 'select', 'data-field': 'data_kind' },
      h('option', { value: 'any', text: 'Any kind' }), app.kinds.map((k) => h('option', { value: k.code, text: k.label })));
    kind.value = rule?.data_kind || 'any';
    const contains = h('input', { id: `${id}-contains`, class: 'input', type: 'text', 'data-field': 'company_contains', value: rule?.company_contains || '', autocomplete: 'off' });
    const level = h('select', { id: `${id}-level`, class: 'select', 'data-field': 'level' }, LEVELS.map((lv) => h('option', { value: lv, text: LEVEL_LABEL[lv] })));
    level.value = rule?.level || 'critical';
    const priority = h('input', { id: `${id}-priority`, class: 'input input-mono', type: 'number', min: '1', max: '999', step: '1', 'data-field': 'priority', value: rule ? String(rule.priority) : '' });
    const save = h('button', { type: 'submit', class: 'button button-primary', text: 'Save rule' });
    const summary = h('div', { class: 'summary-slot' });
    const dialogAlerts = h('div', { class: 'alert-slot' });
    const field = (input, label, hint) => h('div', { class: 'field' }, h('label', { class: 'field-label', for: input.id, text: label }), input,
      hint ? h('p', { class: 'hint', text: hint }) : null);
    const form = h('form', { class: 'dialog-form', novalidate: true }, summary, dialogAlerts,
      field(kind, 'Data kind'), field(contains, 'Company contains', 'Leave empty to match every company.'), field(level, 'Level'),
      field(priority, 'Priority', rule ? null : 'Leave empty to place it last.'),
      h('div', { class: 'actions' }, save, h('button', { type: 'button', class: 'button button-secondary', text: 'Cancel', onclick: () => handle.close() })));
    const version = rule?.version;
    const opened = () => (rule ? list.querySelector(`li[data-key="${rule.id}"] .rule-actions button`) || opener : opener);
    const handle = openDialog({ title: rule ? 'Edit rule' : 'Add rule', opener: opened, content: form });
    let saving = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (saving) return;
      saving = true;
      busy(save, true);
      dialogAlerts.replaceChildren();
      const body = { data_kind: kind.value, company_contains: contains.value, level: level.value };
      if (priority.value.trim() !== '') body.priority = Number(priority.value);
      const answer = rule ? await call('PATCH', `/api/rules/${rule.id}`, { version, ...body }) : await call('POST', '/api/rules', body);
      saving = false;
      busy(save, false);
      if (answer.status === 200 || answer.status === 201) {
        await load();
        handle.close();
        announceExposure(`Rules updated. Exposure score ${answer.body.exposure.score}.`);
      } else if (answer.status === 401) {
        app.sessionEnded();
      } else if (errorCode(answer) === 'stale_version') {
        clearFieldErrors(form, summary);
        showAlert(dialogAlerts, errorMessage(answer), { focus: true });
      } else if (answer.status === 422) {
        showFieldErrors(form, summary, answer.body.error.fields || {}, RULE_LABELS);
      } else {
        showAlert(dialogAlerts, failedWithoutBody(answer) ? FAILED : errorMessage(answer) || FAILED, { focus: true });
      }
    });
  }

  async function deleteRule(rule) {
    const answer = await call('DELETE', `/api/rules/${rule.id}`);
    if (answer.status === 204) {
      await load();
      const score = await get('/api/exposure');
      if (score.status === 200) announceExposure(`Rules updated. Exposure score ${score.body.score}.`);
      addRule.focus();
    } else if (answer.status === 401) {
      app.sessionEnded();
    } else {
      showAlert(alerts, failedWithoutBody(answer) ? FAILED : errorMessage(answer) || FAILED);
    }
  }

  load();
  return {
    live(change) {
      if (lift?.mode === 'keyboard' && change.type.startsWith('rule.')) {
        cancelMove();
        load();
      } else if (lift) {
        pendingRedraw = true;
      } else {
        load();
      }
    },
    destroy() {
      alive = false;
      preview.cancel();
      clearTimeout(previewTimer);
    },
  };
}
