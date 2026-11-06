// The exhibit inspector: provenance, preview and redaction regions, derivatives, state actions and custody.

import {
  api, claimFile, clearFieldError, CONNECTION_LOST, ConnectionLost, digestLine, field, figure, h, heldMarker, icon, refusalCopy,
  registerUnsaved, ruledTable, saveBlob, session, setFieldError, syncRows, whenSignedIn,
} from '../core.js';
import { stepUp } from '../dialogs.js';
import { actionStatus, docketPanes, navigate, watchCompartment } from '../shell.js';
import { renderDocket } from './docket.js';

const CHECK_MS = 4000;
const PAGE_UNITS = 1000;
const NEW_REGION = { x: 100, y: 100, w: 200, h: 100 };
const KEY_STEP = 10;
const MIN_SIZE = 10;
const READABLE = ['cleared', 'held', 'disposal proposed'];
const PREVIEW_OUTAGE = 'Preview unavailable. Exhibit storage is unreachable.';
const DOWNLOAD_OUTAGE = 'Download unavailable. Exhibit storage is unreachable. Your grant is still unused.';
const NARROWED = 'Your access to this compartment has changed to derivatives only.';

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
const regionBody = ({ page, x, y, w, h: height }) => ({ page, x, y, w, h: height });
const regionKey = (region) => JSON.stringify(regionBody(region));
const canonicalSet = (regions) => JSON.stringify(regions.map(regionKey).sort());
const regionCopy = (n, { x, y, w, h: height }) => `Region ${n} at ${x}, ${y}, size ${w} by ${height}.`;

// ---- preview and redaction ---------------------------------------------------------------------------
function redactionPanel(screen, exhibit, { onRendered, onUnavailable }) {
  const base = `/api/exhibits/${exhibit.id}`;
  let page = 1;
  let regions = [];
  let saved = [];
  let marksVersion = exhibit.marks_version;
  let versionSeen = exhibit.marks_version;
  let bitmap = null;
  let previewRun = 0;
  let saving = false;
  let drag = null;
  const views = new Map();

  const status = h('div', { role: 'status', 'aria-label': 'Redaction status', class: 'status-line redaction-status' });
  const say = (copy, kind = '') => {
    status.className = `status-line redaction-status ${kind}`.trim();
    if (kind === 'refusal') status.replaceChildren(icon('refuse'), document.createTextNode(copy));
    else if (kind === 'success') status.replaceChildren(icon('check'), document.createTextNode(copy));
    else status.textContent = copy;
  };

  const canvas = h('canvas', { role: 'img', class: 'preview-canvas' });
  const draft = h('div', { class: 'region-draft', hidden: true });
  const stage = h('div', { class: 'preview-stage' }, canvas, draft);
  const previous = h('button', { type: 'button', class: 'btn', onclick: () => turn(page - 1) }, 'Previous page');
  const next = h('button', { type: 'button', class: 'btn', onclick: () => turn(page + 1) }, 'Next page');
  const pageWord = h('span', { class: 'mono page-word' });
  const add = h('button', { type: 'button', class: 'btn', onclick: addRegion }, 'Add region');
  const save = h('button', { type: 'button', class: 'btn', onclick: () => saveMarks() }, 'Save marks');
  const render = h('button', { type: 'button', class: 'btn', onclick: renderDerivative }, 'Render derivative');
  const findBox = h('input', { type: 'text', autocomplete: 'off' });
  const findForm = h('form', { class: 'find-form', novalidate: true, onsubmit: markMatches },
    field('Find text', findBox), h('button', { type: 'submit', class: 'btn' }, 'Mark matches'));
  const element = h('div', { role: 'group', 'aria-label': 'Redaction regions', class: 'redaction' },
    h('h3', {}, 'Preview and redaction'),
    h('div', { class: 'preview-nav' }, previous, pageWord, next),
    stage,
    status,
    h('div', { class: 'button-row' }, add, save, render),
    findForm);

  const unsaved = () => canonicalSet(regions) !== canonicalSet(saved);
  const shownRegions = () => regions.filter((region) => region.page === page);
  const announce = (region) => say(regionCopy(shownRegions().indexOf(region) + 1, region));

  // ---- region views: the hit box takes the keyboard, its child draws the exact 2 pixel outline.
  function createView(region) {
    const button = h('button', {
      type: 'button',
      class: 'region-box',
      onkeydown: (event) => keyOnRegion(event, region),
      onpointerdown: (event) => startDrag(event, 'move', region),
    }, h('span', { class: 'region-outline' }));
    const handle = h('div', { class: 'region-handle', 'aria-hidden': 'true', onpointerdown: (event) => startDrag(event, 'resize', region) });
    const layer = h('div', { class: 'region-layer' }, button, handle);
    stage.append(layer);
    return { layer, button, handle };
  }

  function drawRegions() {
    const shown = shownRegions();
    for (const [region, view] of views) {
      if (!shown.includes(region)) {
        view.layer.remove();
        views.delete(region);
      }
    }
    shown.forEach((region, index) => {
      if (!views.has(region)) views.set(region, createView(region));
      const { layer, button, handle } = views.get(region);
      for (const name of ['x', 'y', 'w', 'h']) layer.style.setProperty(`--${name}`, region[name]);
      layer.style.setProperty('--order', index + 1);
      button.setAttribute('aria-label', `Region ${index + 1}`);
      button.firstElementChild.setAttribute('data-region-number', String(index + 1));
      handle.setAttribute('data-region-handle', String(index + 1));
    });
  }

  function addRegion() {
    const region = { page, ...NEW_REGION };
    regions.push(region);
    drawRegions();
    views.get(region).button.focus();
    announce(region);
  }

  function keyOnRegion(event, region) {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      const n = shownRegions().indexOf(region) + 1;
      regions = regions.filter((other) => other !== region);
      drawRegions();
      add.focus();
      say(`Region ${n} removed.`);
      return;
    }
    const delta = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP] }[event.key];
    if (!delta) return;
    event.preventDefault();
    if (event.shiftKey) {
      region.w = clamp(region.w + delta[0], Math.min(region.w, MIN_SIZE), PAGE_UNITS - region.x);
      region.h = clamp(region.h + delta[1], Math.min(region.h, MIN_SIZE), PAGE_UNITS - region.y);
    } else {
      region.x = clamp(region.x + delta[0], 0, PAGE_UNITS - region.w);
      region.y = clamp(region.y + delta[1], 0, PAGE_UNITS - region.h);
    }
    drawRegions();
    announce(region);
  }

  // ---- pointer and touch: every drag is captured by the stage, so a refresh never interrupts it.
  function pointIn(event) {
    const box = stage.getBoundingClientRect();
    return {
      x: clamp((event.clientX - box.left) / box.width * PAGE_UNITS, 0, PAGE_UNITS),
      y: clamp((event.clientY - box.top) / box.height * PAGE_UNITS, 0, PAGE_UNITS),
    };
  }

  function startDrag(event, mode, region = null) {
    if (drag || !event.isPrimary || event.button) return;
    event.preventDefault();
    event.stopPropagation();
    stage.setPointerCapture(event.pointerId);
    if (region) views.get(region).button.focus({ preventScroll: true });
    drag = { mode, region, pointer: event.pointerId, start: pointIn(event), before: region && { ...region }, changed: false };
  }

  function draftBox(start, point) {
    const left = Math.floor(Math.min(start.x, point.x));
    const top = Math.floor(Math.min(start.y, point.y));
    return { x: left, y: top, w: Math.ceil(Math.max(start.x, point.x)) - left, h: Math.ceil(Math.max(start.y, point.y)) - top };
  }

  stage.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const point = pointIn(event);
    const dx = Math.round(point.x - drag.start.x);
    const dy = Math.round(point.y - drag.start.y);
    drag.changed ||= dx !== 0 || dy !== 0;
    if (drag.mode === 'draw') {
      const box = draftBox(drag.start, point);
      for (const name of ['x', 'y', 'w', 'h']) draft.style.setProperty(`--${name}`, box[name]);
      draft.hidden = false;
      return;
    }
    const { region, before } = drag;
    if (drag.mode === 'move') {
      region.x = clamp(before.x + dx, 0, PAGE_UNITS - region.w);
      region.y = clamp(before.y + dy, 0, PAGE_UNITS - region.h);
    } else {
      region.w = clamp(before.w + dx, Math.min(before.w, MIN_SIZE), PAGE_UNITS - region.x);
      region.h = clamp(before.h + dy, Math.min(before.h, MIN_SIZE), PAGE_UNITS - region.y);
    }
    drawRegions();
  });

  function finishDraw(event, finished) {
    const box = draftBox(finished.start, pointIn(event));
    if (Math.max(box.w, box.h) < MIN_SIZE) return;
    const w = Math.max(box.w, MIN_SIZE);
    const height = Math.max(box.h, MIN_SIZE);
    const region = { page, x: Math.min(box.x, PAGE_UNITS - w), y: Math.min(box.y, PAGE_UNITS - height), w, h: height };
    regions.push(region);
    drawRegions();
    views.get(region).button.focus({ preventScroll: true });
    announce(region);
  }

  stage.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const finished = drag;
    drag = null;
    draft.hidden = true;
    if (finished.mode === 'draw') finishDraw(event, finished);
    else if (finished.changed) announce(finished.region);
  });

  stage.addEventListener('pointercancel', (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    if (drag.before) Object.assign(drag.region, drag.before);
    drag = null;
    draft.hidden = true;
    drawRegions();
  });

  canvas.addEventListener('pointerdown', (event) => startDrag(event, 'draw'));

  // ---- the preview: only the newest requested page is ever painted or announced.
  function paint() {
    const width = stage.clientWidth;
    if (!bitmap || !width) return;
    const ratio = window.devicePixelRatio;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(width * ratio * bitmap.height / bitmap.width);
    if (canvas.dataset.painted === String(previewRun) && canvas.width === pixelWidth && canvas.height === pixelHeight) return;
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, pixelWidth, pixelHeight);
    canvas.dataset.painted = String(previewRun);
  }

  function pageChanged() {
    canvas.setAttribute('aria-label', `Exhibit preview page ${page}`);
    pageWord.textContent = `Page ${page} of ${exhibit.page_count}`;
    previous.setAttribute('aria-disabled', String(page === 1));
    next.setAttribute('aria-disabled', String(page === exhibit.page_count));
    bitmap?.close();
    bitmap = null;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    if (drag) {
      drag = null;
      draft.hidden = true;
    }
    drawRegions();
  }

  async function loadPreview() {
    previewRun += 1;
    const run = previewRun;
    const shownPage = page;
    say('Loading preview.');
    try {
      const grant = await api('POST', `${base}/preview-grants`, { body: { page: shownPage }, signal: screen.signal });
      if (run !== previewRun) return;
      if (grant.status === 401) {
        await whenSignedIn();
        if (run === previewRun) loadPreview();
        return;
      }
      if (grant.error === 'not_previewable' || grant.error === 'exhibit_not_cleared') {
        onUnavailable();
        return;
      }
      if (!grant.ok) {
        say(grant.status === 503 ? PREVIEW_OUTAGE : refusalCopy(grant), 'refusal');
        return;
      }
      const file = await claimFile(grant.data.token);
      if (run !== previewRun) return;
      if (!file.ok) {
        say(file.status === 503 ? PREVIEW_OUTAGE : refusalCopy({}), 'refusal');
        return;
      }
      const image = await createImageBitmap(file.blob);
      if (run !== previewRun) {
        image.close();
        return;
      }
      bitmap = image;
      stage.style.setProperty('--aspect', image.height / image.width);
      paint();
      say('Preview loaded.');
    } catch (error) {
      if (error.name === 'AbortError' || run !== previewRun) return;
      if (!(error instanceof ConnectionLost) && error.name !== 'InvalidStateError') throw error;
      say(PREVIEW_OUTAGE, 'refusal');
    }
  }

  function turn(target) {
    if (target < 1 || target > exhibit.page_count) return;
    page = target;
    pageChanged();
    loadPreview();
  }

  // ---- saving, rendering, finding
  function refuse(answer) {
    if (answer.error === 'exhibit_not_cleared') {
      say('');
      actionStatus(refusalCopy(answer), 'refusal');
    } else say(refusalCopy(answer), 'refusal');
  }

  async function readSaved() {
    const answer = await api('GET', `${base}/redactions`, { background: true, signal: screen.signal });
    if (answer.ok) saved = answer.data.regions;
    return answer;
  }

  // A save answered 401 is resent once after sign-in, with the same regions and the same marks_version.
  async function saveMarks() {
    if (saving) return;
    saving = true;
    say('Saving marks.');
    const body = { regions: regions.map(regionBody), marks_version: marksVersion };
    const send = () => api('PUT', `${base}/redactions`, { body, signal: screen.signal });
    try {
      let answer = await send();
      if (answer.status === 401) {
        await whenSignedIn();
        answer = await send();
      }
      if (answer.ok) {
        saved = answer.data.regions;
        marksVersion = answer.data.marks_version;
        versionSeen = marksVersion;
        say('Marks saved.', 'success');
      } else if (answer.error === 'stale_marks') {
        marksVersion = answer.data.marks_version;
        versionSeen = marksVersion;
        say(refusalCopy(answer), 'refusal');
        await readSaved();
      } else if (answer.errors) {
        say(answer.errors.regions ?? answer.errors.marks_version, 'refusal');
      } else if (answer.status !== 401) refuse(answer);
    } catch (error) {
      if (!(error instanceof ConnectionLost)) throw error;
      say(CONNECTION_LOST);
    } finally {
      saving = false;
    }
  }

  async function renderDerivative() {
    if (unsaved()) {
      say('Save your marks before rendering.', 'refusal');
      return;
    }
    say('Rendering.');
    try {
      const answer = await api('POST', `${base}/derivatives`, { body: {}, signal: screen.signal });
      if (answer.ok) {
        say(`Rendered ${answer.data.id}.`, 'success');
        onRendered();
      } else if (answer.status === 503) say('Not rendered. Exhibit storage is unreachable.', 'refusal');
      else if (answer.status !== 401) refuse(answer);
    } catch (error) {
      if (!(error instanceof ConnectionLost)) throw error;
      say(CONNECTION_LOST);
    }
  }

  async function markMatches(event) {
    event.preventDefault();
    clearFieldError(findBox);
    say('Finding matches.');
    try {
      const answer = await api('POST', `${base}/redactions/find`, { body: { text: findBox.value }, signal: screen.signal });
      if (answer.ok) {
        const have = new Set(regions.map(regionKey));
        const fresh = answer.data.matches.filter((match) => !have.has(regionKey(match)));
        regions.push(...fresh.map(regionBody));
        drawRegions();
        if (answer.data.matches.length) say(`Added ${fresh.length} regions. Save your marks to keep them.`);
        else say('No matches found. A scanned page may still hold this text.');
      } else if (answer.status === 503) say('Find unavailable. Exhibit storage is unreachable.', 'refusal');
      else if (answer.errors?.text) {
        setFieldError(findBox, answer.errors.text);
        say(answer.errors.text, 'refusal');
        findBox.focus();
      } else if (answer.status !== 401) refuse(answer);
    } catch (error) {
      if (!(error instanceof ConnectionLost)) throw error;
      say(CONNECTION_LOST);
    }
  }

  const forgetUnsaved = registerUnsaved(unsaved);
  screen.onCleanup(forgetUnsaved);
  const stopSizing = screen.every(1000, paint, { now: false });

  pageChanged();
  say('Loading preview.');
  (async () => {
    const answer = await readSaved().catch((error) => {
      if (error instanceof ConnectionLost || error.name === 'AbortError') return null;
      throw error;
    });
    if (answer?.ok) {
      marksVersion = answer.data.marks_version;
      versionSeen = marksVersion;
      regions = [...answer.data.regions, ...regions];
      drawRegions();
    }
    await loadPreview();
  })();

  return {
    element,
    // Another person's save changes what counts as saved, never the working regions.
    noteVersion(version) {
      if (version === versionSeen) return;
      versionSeen = version;
      readSaved();
    },
    teardown() {
      previewRun += 1;
      stopSizing();
      forgetUnsaved();
      bitmap?.close();
      bitmap = null;
      element.remove();
    },
  };
}

// ---- downloads ----------------------------------------------------------------------------------------
async function download(grantPath) {
  actionStatus('Preparing download.');
  try {
    const grant = await api('POST', grantPath, { body: {} });
    if (grant.status === 401) {
      actionStatus('');
      return;
    }
    if (!grant.ok) {
      actionStatus(grant.status === 503 ? DOWNLOAD_OUTAGE : refusalCopy(grant), 'refusal');
      return;
    }
    const file = await claimFile(grant.data.token);
    if (!file.ok) {
      actionStatus(file.status === 503 ? DOWNLOAD_OUTAGE : refusalCopy({}), 'refusal');
      return;
    }
    saveBlob(file.blob, file.filename);
    actionStatus('Download started.', 'success');
  } catch (error) {
    if (!(error instanceof ConnectionLost)) throw error;
    actionStatus(CONNECTION_LOST);
  }
}

function derivativesTable(exhibitId) {
  const { table, body, row } = ruledTable('Derivatives', ['Derivative', 'Size', 'Standing', 'Digest', 'Download']);
  const empty = h('p', { class: 'no-record' }, 'No derivatives yet.');
  const standing = (item) => {
    if (item.disposed) return h('span', { class: 'state-word' }, 'Disposed');
    if (item.superseded) return h('span', { class: 'state-word' }, icon('superseded'), 'Superseded');
    return h('span', { class: 'state-word' }, 'Current');
  };
  const render = (item) => row(
    h('span', { class: 'mono' }, item.id),
    h('span', { class: 'mono' }, `${item.size} bytes`),
    standing(item),
    { wide: h('span', { class: 'digest' }, item.sha256) },
    {
      wide: item.disposed ? null : h('button', {
        type: 'button',
        class: 'btn',
        onclick: () => download(`/api/derivatives/${item.id}/download-grants`),
      }, icon('download'), h('span', {}, 'Download ', h('span', { class: 'mono' }, item.id))),
    });
  return {
    element: h('div', { class: 'derivatives' }, h('h3', {}, 'Derivatives'), table, empty),
    async refresh(signal, background = true) {
      const answer = await api('GET', `/api/exhibits/${exhibitId}/derivatives`, { background, signal });
      if (!answer.ok) return;
      empty.hidden = answer.data.derivatives.length > 0;
      syncRows(body, answer.data.derivatives, {
        key: (item) => item.id,
        signature: (item) => `${item.superseded}/${item.disposed}`,
        render,
      });
    },
  };
}

// ---- hold and disposal --------------------------------------------------------------------------------
function stateActions(exhibitId, focusPane, apply) {
  const me = session.me.id;
  const base = `/api/exhibits/${exhibitId}`;
  let openStepUp = null;

  function privileged(opener, { path, needsReason = true, pending, body = () => ({}), success, outage }) {
    openStepUp = stepUp({
      opener,
      fallback: focusPane,
      needsReason,
      pending,
      run: (proof, reason) => {
        actionStatus(pending);
        return api('POST', `${base}/${path}`, { proof, body: { ...body(), ...(needsReason ? { reason } : {}) } });
      },
      onAnswer: (answer) => {
        if (answer.ok) {
          actionStatus(success(answer.data), 'success');
          apply(answer.data);
        } else if (answer.status === 503 && outage) actionStatus(outage, 'refusal');
        else if (answer.errors?.matter_ref) {
          setFieldError(matter, answer.errors.matter_ref);
          actionStatus(answer.errors.matter_ref, 'refusal');
          matter.focus();
        } else if (answer.error === 'legal_hold') actionStatus(refusalCopy(answer), 'hold');
        else actionStatus(refusalCopy(answer, { separation: 'disposal' }), 'refusal');
      },
      onFailure: () => actionStatus(CONNECTION_LOST),
    });
  }

  const matter = h('input', { type: 'text', autocomplete: 'off' });
  const place = h('button', { type: 'submit', class: 'btn' }, 'Place hold');
  const holdForm = h('form', {
    class: 'hold-form',
    novalidate: true,
    onsubmit: (event) => {
      event.preventDefault();
      clearFieldError(matter);
      privileged(place, {
        path: 'hold',
        pending: 'Saving hold.',
        body: () => ({ matter_ref: matter.value }),
        success: () => {
          matter.value = '';
          return 'Hold placed.';
        },
      });
    },
  }, field('Hold matter', matter), place);

  const lifts = h('div', { class: 'button-row' });
  const dispose = h('button', {
    type: 'button',
    class: 'btn',
    onclick: () => privileged(dispose, {
      path: 'dispose',
      pending: 'Proposing disposal.',
      success: () => `Disposal proposed for ${exhibitId}. Another case lead must confirm it.`,
    }),
  }, 'Dispose');
  const confirm = h('button', {
    type: 'button',
    class: 'btn',
    onclick: () => privileged(confirm, {
      path: 'dispose/confirm',
      needsReason: false,
      pending: 'Disposing.',
      success: () => `Disposed ${exhibitId}.`,
      outage: 'Not disposed. Exhibit storage is unreachable.',
    }),
  }, 'Confirm disposal');
  const cancel = h('button', {
    type: 'button',
    class: 'btn',
    onclick: () => privileged(cancel, {
      path: 'dispose/cancel',
      pending: 'Cancelling disposal.',
      success: () => 'Disposal cancelled.',
    }),
  }, 'Cancel disposal');

  const liftButton = (hold) => {
    const button = h('button', {
      type: 'button',
      class: 'btn',
      onclick: () => privileged(button, {
        path: 'lift-hold',
        pending: 'Saving hold.',
        body: () => ({ hold_id: hold.id }),
        success: (exhibit) => (exhibit.holds.length ? `Hold lifted. Other holds remain: ${exhibit.holds.length}.` : 'Hold lifted.'),
      }),
    }, `Lift hold ${hold.matter_ref}`);
    return button;
  };

  const element = h('div', { class: 'state-actions stack' }, h('h3', {}, 'Hold and disposal'), holdForm, lifts, h('div', { class: 'button-row' }, dispose, confirm, cancel));
  return {
    element,
    update(exhibit) {
      holdForm.hidden = !READABLE.includes(exhibit.state);
      syncRows(lifts, exhibit.holds, { key: (hold) => hold.id, signature: (hold) => hold.matter_ref, render: liftButton });
      dispose.hidden = exhibit.state !== 'cleared';
      cancel.hidden = exhibit.state !== 'disposal proposed';
      confirm.hidden = exhibit.state !== 'disposal proposed' || exhibit.disposal_proposed_by === me;
      element.hidden = holdForm.hidden && !exhibit.holds.length && exhibit.state === 'disposed';
    },
    closeDialog() {
      openStepUp?.close({ returnFocus: false });
    },
  };
}

// ---- the screen ------------------------------------------------------------------------------------------
function factList(pairs) {
  return h('dl', { class: 'exhibit-facts' }, pairs.flatMap(([term, value, mono]) => [
    h('dt', {}, term),
    h('dd', { class: mono ? 'mono' : '' }, value ?? 'None'),
  ]));
}

function provenanceBlock(provenance) {
  return h('div', { class: 'provenance' }, h('h3', {}, 'Provenance'), factList([
    ['Source', provenance.source],
    ['Collected by', provenance.collected_by],
    ['Collected on', provenance.collected_on, true],
    ['Capture notes', provenance.capture_notes],
  ]));
}

export async function mount(screen) {
  const panes = docketPanes(screen, 'inspector');
  let first;
  try {
    first = await api('GET', `/api/exhibits/${screen.params[0]}`, { signal: screen.signal });
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (!(error instanceof ConnectionLost)) throw error;
    panes.inspector.replaceChildren(h('p', { class: 'no-record' }, CONNECTION_LOST));
    throw error;
  }
  if (screen.stopped || first.status === 401) return;
  if (!first.ok) {
    screen.notFound();
    return;
  }
  const exhibit = first.data;
  const compartmentId = exhibit.compartment_id;
  const role = session.me.role;
  let full = exhibit.provenance !== null;

  const stateWord = h('span', { class: 'state-word' });
  const heldSlot = h('span', { class: 'held-slot' });
  const sealFailed = h('span', { class: 'refusal seal-failed', hidden: true }, icon('refuse'), 'Seal failed');
  const noticeSlot = h('div', { class: 'exhibit-notice' });
  const stack = h('div', { class: 'exhibit-sections' });
  const derivatives = derivativesTable(exhibit.id);
  const original = h('button', {
    type: 'button',
    class: 'btn download-original',
    onclick: () => download(`/api/exhibits/${exhibit.id}/download-grants`),
  }, icon('download'), 'Download original');
  const unavailable = h('p', { class: 'no-record preview-unavailable', hidden: true });

  let provenance = full ? provenanceBlock(exhibit.provenance) : null;
  let panel = null;
  let custody = [];
  const canRedact = () => full && (role === 'investigator' || role === 'case_lead');
  const actions = full && role === 'case_lead' ? stateActions(exhibit.id, () => panes.inspector.focus(), apply) : null;

  function syncPanel(current) {
    const wanted = canRedact() && READABLE.includes(current.state) && current.page_count !== null && !unavailable.dataset.final;
    if (wanted && !panel) {
      panel = redactionPanel(screen, current, {
        onRendered: () => derivatives.refresh(screen.signal, false),
        onUnavailable: () => {
          unavailable.dataset.final = 'true';
          unavailable.textContent = 'This file has no preview.';
          unavailable.hidden = false;
          syncPanel(current);
        },
      });
      unavailable.before(panel.element);
    } else if (!wanted && panel) {
      panel.teardown();
      panel = null;
    }
    panel?.noteVersion(current.marks_version);
  }

  function apply(current) {
    stateWord.textContent = current.state[0].toUpperCase() + current.state.slice(1);
    stateWord.hidden = current.holds.length > 0;
    heldSlot.replaceChildren(...(current.holds.length ? [heldMarker()] : []));
    sealFailed.hidden = current.seal_check !== 'failed';
    original.hidden = !full || !READABLE.includes(current.state);
    syncPanel(current);
    actions?.update(current);
  }

  function narrow() {
    if (!full) return;
    full = false;
    provenance?.remove();
    provenance = null;
    panel?.teardown();
    panel = null;
    unavailable.remove();
    original.remove();
    for (const surface of custody) {
      surface.stop();
      surface.element.remove();
    }
    custody = [];
    actions?.closeDialog();
    actions?.element.remove();
    noticeSlot.replaceChildren(h('div', { role: 'alert', 'aria-label': 'Access changed', class: 'access-changed' }, NARROWED));
  }

  panes.inspector.replaceChildren(h('div', { class: 'exhibit' },
    h('button', { type: 'button', class: 'btn back-to-docket', onclick: () => navigate(`/compartments/${compartmentId}`) }, icon('back'), 'Back to docket'),
    figure('Exhibit', exhibit.id),
    digestLine(exhibit.sha256),
    h('div', { class: 'exhibit-marks' }, stateWord, heldSlot, sealFailed),
    noticeSlot,
    h('h2', { class: 'exhibit-name' }, exhibit.name),
    factList([
      ['Type', exhibit.sniffed_type, true],
      ['Size', `${exhibit.size} bytes`, true],
      ['Pages', exhibit.page_count, true],
      ['Registered by', exhibit.registered_by, true],
    ]),
    stack));
  stack.append(...[provenance, unavailable, derivatives.element, original, actions?.element].filter(Boolean));
  apply(exhibit);

  if (full && (role === 'case_lead' || role === 'auditor')) {
    const { custodyFeed, custodyTable, custodyTimeline } = await import('./custody.js');
    if (screen.stopped) return;
    const feed = custodyFeed(screen, exhibit.id);
    const timeline = custodyTimeline(screen, feed);
    const table = custodyTable(screen, exhibit.id, feed);
    custody = [timeline, table];
    stack.append(timeline.element, table.element);
  }

  watchCompartment(screen, compartmentId, panes, { onNarrowed: narrow });
  screen.seedScope(full ? 'full' : 'derivatives');
  screen.every(CHECK_MS, async () => {
    const answer = await api('GET', `/api/exhibits/${exhibit.id}`, { background: true, signal: screen.signal });
    if (!answer.ok) return;
    if (answer.data.provenance === null) narrow();
    apply(answer.data);
  }, { now: false });
  screen.every(CHECK_MS, () => derivatives.refresh(screen.signal));
  await renderDocket(screen, panes, compartmentId);
}
