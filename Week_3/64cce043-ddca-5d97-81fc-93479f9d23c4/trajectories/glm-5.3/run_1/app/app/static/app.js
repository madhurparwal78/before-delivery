/* Strongroom Ledger front end: screens, live updates, and the blast preview. */

(() => {
  'use strict';

  // --- Shared state ---------------------------------------------------------

  const S = {
    role: null,            // 'owner' | 'contact'
    kinds: [], levels: [],
    route: location.pathname,
    exposure: null,
    committedScore: null,
    stream: null,
    streamStopped: false,
    touchedIds: new Set(),   // holdings lit by the breach preview
    breachForm: null,        // open Log breach form state
    rulesDraftOrder: null,   // rule order while dragging
    searchSeq: 0,            // latest-input-wins guard
    draftKey: 'strongroom_draft',
  };
  window.SR = S;

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, attrs = {}, text = null) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    if (text !== null) node.textContent = text;
    return node;
  };

  const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  async function api(path, options = {}) {
    const opts = { credentials: 'same-origin', headers: {}, ...options };
    if (opts.body !== undefined && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    if (opts.idempotencyKey) {
      opts.headers['Idempotency-Key'] = opts.idempotencyKey;
      delete opts.idempotencyKey;
    }
    const resp = await fetch(path, opts);
    let data = null;
    const type = resp.headers.get('content-type') || '';
    if (type.includes('application/json')) data = await resp.json().catch(() => null);
    return { resp, data, status: resp.status };
  }

  function announce(statusId, text) {
    const node = document.getElementById(statusId);
    if (!node) return;
    node.textContent = '';
    requestAnimationFrame(() => { node.textContent = text; });
  }

  function showAlert(text, { error = true } = {}) {
    const holder = $('#alerts');
    if (!holder) return null;
    const box = el('div', { class: `alert ${error ? 'error' : ''}`, role: 'alert', text });
    holder.prepend(box);
    setTimeout(() => box.remove(), 10000);
    return box;
  }

  function fieldLabel(name) {
    const labels = {
      company: 'Company', data_kind: 'Data kind', value: 'Value', notes: 'Notes',
      announced_on: 'Announced on', data_kinds: 'Data kinds', priority: 'Priority',
      company_contains: 'Company contains', level: 'Level', q: 'Search',
      contact_name: 'Contact name', contact_email: 'Contact email',
      duration: 'Duration', levels: 'Levels shown', current_password: 'Current password',
      new_password: 'New password', version: 'Version', rule_ids: 'Rule order',
      breach_id: 'Breach', idempotency_key: 'Request',
    };
    return labels[name] || name;
  }

  function fieldErrorSummary(fields, form) {
    let box = form.querySelector('.error-summary');
    if (box) box.remove();
    box = el('div', { class: 'error-summary', role: 'alert', tabindex: '-1' });
    box.appendChild(el('h3', { text: 'Check these fields' }));
    const ul = el('ul');
    for (const [field, message] of Object.entries(fields || {})) {
      const li = el('li');
      const a = el('a', { href: '#', text: `${fieldLabel(field)}: ${message}` });
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const target = form.querySelector(`[name="${field}"]`);
        if (target) target.focus();
      });
      li.appendChild(a);
      ul.appendChild(li);
    }
    box.appendChild(ul);
    form.prepend(box);
    return box;
  }

  function clearFieldErrors(form) {
    form.querySelectorAll('.field-error').forEach((n) => n.remove());
    const box = form.querySelector('.error-summary');
    if (box) box.remove();
    form.querySelectorAll('[name]').forEach((n) => n.removeAttribute('aria-invalid'));
  }

  function showFieldErrors(form, fields) {
    clearFieldErrors(form);
    for (const [name, message] of Object.entries(fields || {})) {
      const input = form.querySelector(`[name="${name}"]`);
      if (input) {
        input.setAttribute('aria-invalid', 'true');
        const err = el('div', { class: 'field-error', text: message });
        if (input.type === 'checkbox' || input.closest('[role="group"]')) {
          const group = input.closest('[role="group"]');
          if (group) group.appendChild(err);
        } else {
          input.insertAdjacentElement('afterend', err);
        }
      }
    }
    fieldErrorSummary(fields, form);
    const firstLink = form.querySelector('.error-summary a');
    if (firstLink) firstLink.focus();
  }

  // --- Score numeral ----------------------------------------------------------

  let countTimer = null;

  function setScoreNumber(value, { animate = true } = {}) {
    const node = $('#score-num');
    if (!node) return;
    const target = Math.max(0, Math.round(Number(value) || 0));
    if (REDUCED() || !animate) {
      node.textContent = String(target);
      return;
    }
    if (countTimer) cancelAnimationFrame(countTimer);
    const from = Number(String(node.textContent).replace(/\D/g, '')) || 0;
    if (from === target) { node.textContent = String(target); return; }
    const start = performance.now();
    const DURATION = 420;
    const step = (now) => {
      const t = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = String(Math.round(from + (target - from) * eased));
      if (t < 1) countTimer = requestAnimationFrame(step);
      else node.textContent = String(target);
    };
    countTimer = requestAnimationFrame(step);
  }

  function showPreviewTag(show) {
    const tag = $('#preview-tag');
    if (tag) tag.hidden = !show;
  }

  function syncBandScore(value) {
    const bandScore = $('#band-score');
    const bandName = $('#band-name-band');
    if (bandScore) bandScore.textContent = String(Math.max(0, Math.round(Number(value) || 0)));
    if (bandName && S.exposure) bandName.textContent = S.exposure.band;
  }

  function renderExposure(exposure, { announceAs = null, animate = true } = {}) {
    if (!exposure) return;
    S.exposure = exposure;
    S.committedScore = exposure.score;
    setScoreNumber(exposure.score, { animate });
    const band = $('#band-name');
    if (band) band.textContent = exposure.band;
    syncBandScore(exposure.score);
    if (announceAs) announce('exposure-updates', `${announceAs} Exposure score ${exposure.score}.`);
  }

  // --- Live stream ------------------------------------------------------------

  function startStream(onChange, onAccessEnded) {
    stopStream();
    if (S.streamStopped) return;
    const source = new EventSource('/api/events');
    S.stream = source;
    source.addEventListener('change', (e) => {
      const data = JSON.parse(e.data || '{}');
      onChange?.(data);
    });
    source.addEventListener('access-ended', () => {
      source.close();
      onAccessEnded?.();
    });
    source.onerror = () => {
      source.close();
      // The screen stops reconnecting its stream after a background 401.
      if (S.streamStopped) return;
      setTimeout(() => { if (!S.streamStopped) startStream(onChange, onAccessEnded); }, 2000);
    };
  }

  function stopStream() {
    if (S.stream) { S.stream.close(); S.stream = null; }
  }

  // --- Status check (outage banner) ---------------------------------------------

  async function checkStatus() {
    const { data } = await api('/api/status');
    const banner = $('#outage-banner');
    if (!banner) return data;
    const down = data && data.identity === 'down';
    banner.hidden = !down;
    return data;
  }

  function scheduleStatusChecks() {
    checkStatus();
    setInterval(checkStatus, 30000);
  }

  // --- Draft after an expired session ---------------------------------------------

  function storeDraft(kind, payload) {
    const draft = {
      kind,
      payload,
      path: location.pathname + location.search,
      email: S.me ? S.me.email : null,
      savedAt: Date.now(),
    };
    try { sessionStorage.setItem(S.draftKey, JSON.stringify(draft)); } catch (e) { /* ignore */ }
  }

  function loadDraft() {
    try {
      const raw = sessionStorage.getItem(S.draftKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function discardDraft() {
    try { sessionStorage.removeItem(S.draftKey); } catch (e) { /* ignore */ }
  }

  function remainingText(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
    if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  window.Strongroom = { S, api, el, $, announce, showAlert, setScoreNumber, showPreviewTag,
    syncBandScore, renderExposure, startStream, stopStream, checkStatus, scheduleStatusChecks,
    storeDraft, loadDraft, discardDraft, remainingText, fieldLabel, showFieldErrors, clearFieldErrors, REDUCED };
})();
