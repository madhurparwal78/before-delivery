/** The exhibit sheet: preview, redaction marks, derivatives, state and custody. */

import { blobDigest, claim, get, post, put, saveBlob } from './api.js';
import { announce, clear, el, heldMarker, icon, takeFocus } from './dom.js';
import { closeAllDialogs } from './dialog.js';
import { COPY, errorCode, privileged, setStatus, syncRows, table } from './ui.js';
import { mountDocket } from './screen_compartments.js';
import { mountCustody } from './custody.js';
import { go, notFoundPage, state } from './app.js';

const STEP = 10;

function canRedactFor(role) {
  return ['case_lead', 'investigator'].includes(role);
}

export default {
  async mount(context) {
    const exhibitId = context.params[0];
    const { inspector, docket, status } = context;
    const first = await get(`/api/exhibits/${encodeURIComponent(exhibitId)}`);
    if (first.status === 404) {
      notFoundPage(inspector);
      docket.append(el('p', { text: COPY.noRecord }));
      return {};
    }
    if (first.status !== 200) return {};
    let exhibit = first.body;
    const docketHandle = mountDocket(docket, exhibit.compartment_id, context, {
      figure: false,
      endedAlert: false,
      onAccessEnded: () => endAccess(),
    });
    await docketHandle.refresh(false);

    const figure = el('span', { dataset: { figure: 'true' }, text: exhibit.id });
    const digest = el('p', { class: 'digest', text: exhibit.sha256 });
    const heading = el('h1', { text: exhibit.name });
    const stateLine = el('p', { class: 'mono' });
    const provenance = el('div');
    const previewSection = el('div');
    const regionsGroup = el('div', { role: 'group', 'aria-label': 'Redaction regions' });
    const redactionStatus = el('p', {
      role: 'status',
      'aria-label': 'Redaction status',
      'aria-live': 'polite',
    });
    const derivatives = table('Derivatives', ['Derivative', 'Digest', 'Bytes', 'State', 'Get']);
    const actions = el('div');
    const custodyHost = el('div');
    const accessChanged = el('div', {
      role: 'alert',
      'aria-label': 'Access changed',
      hidden: true,
      text: COPY.accessChanged,
    });
    const accessEnded = el('div', {
      role: 'alert',
      'aria-label': 'Access ended',
      hidden: true,
      text: COPY.accessEnded,
    });
    const breakGlassTime = el('p', {
      role: 'status',
      'aria-label': 'Break-glass time',
      class: 'mono',
      hidden: true,
    });
    const body = el('div', {}, [
      el('button', {
        type: 'button',
        class: 'back-to-docket',
        text: 'Back to docket',
        on: { click: () => go(`/compartments/${exhibit.compartment_id}`) },
      }),
      figure,
      el('span', { dataset: { figureLabel: 'true' }, text: 'Exhibit' }),
      digest,
      heading,
      stateLine,
      breakGlassTime,
      accessChanged,
      provenance,
      previewSection,
      regionsGroup,
      redactionStatus,
      derivatives.node,
      actions,
      custodyHost,
    ]);
    inspector.append(body, accessEnded);

    let scope = 'full';
    let page = 1;
    let paintToken = 0;
    let working = [];
    let saved = [];
    let marksVersion = exhibit.marks_version;
    let previewSize = { width: 1, height: 1 };
    let custody = null;
    let dead = false;
    let resendMarks = false;

    const canvas = el('canvas', {
      role: 'img',
      'aria-label': `Exhibit preview page ${page}`,
      width: 600,
      height: 800,
    });
    const wrap = el('div', { class: 'preview-wrap' }, [canvas]);
    const previous = el('button', {
      type: 'button',
      text: 'Previous page',
      on: { click: () => turn(-1) },
    });
    const next = el('button', {
      type: 'button',
      text: 'Next page',
      on: { click: () => turn(1) },
    });
    const findText = el('input', { type: 'text', 'aria-label': 'Find text' });
    const findError = el('p', { class: 'field-error', hidden: true });
    const markMatches = el('button', {
      type: 'button',
      text: 'Mark matches',
      on: { click: runFind },
    });
    const addRegion = el('button', {
      type: 'button',
      text: 'Add region',
      on: { click: () => addWorkingRegion() },
    });
    const saveMarks = el('button', {
      type: 'button',
      text: 'Save marks',
      on: { click: storeMarks },
    });
    const renderButton = el('button', {
      type: 'button',
      text: 'Render derivative',
      on: { click: renderDerivative },
    });
    const originalButton = el('button', {
      type: 'button',
      text: 'Download original',
      on: { click: downloadOriginal },
    });

    function canRedact() {
      return canRedactFor(state.user.role);
    }

    function renderPreviewSection() {
      clear(previewSection);
      if (scope !== 'full' || !canRedact()) return;
      previewSection.append(
        wrap,
        el('p', {}, [previous, next]),
        el('label', { text: 'Find text' }),
        findText,
        findError,
        markMatches
      );
    }

    function renderRegionControls() {
      const marks = Array.from(regionsGroup.querySelectorAll('[data-region-index]'));
      for (const mark of marks) mark.remove();
      if (scope !== 'full' || !canRedact()) {
        clear(regionsGroup);
        return;
      }
      if (!regionsGroup.contains(addRegion)) {
        clear(regionsGroup);
        regionsGroup.append(addRegion, saveMarks, renderButton);
      }
      drawRegions();
    }

    function provenanceBlock() {
      clear(provenance);
      if (!exhibit.provenance) return;
      provenance.append(
        el('h2', { text: 'Provenance' }),
        el('p', { text: `Source: ${exhibit.provenance.source}` }),
        el('p', { text: `Collected by: ${exhibit.provenance.collected_by}` }),
        el('p', { class: 'mono', text: `Collected on: ${exhibit.provenance.collected_on}` }),
        el('p', {
          text: `Capture notes: ${exhibit.provenance.capture_notes || '-'}`,
        })
      );
    }

    function endAccess() {
      if (dead) return;
      dead = true;
      clear(body);
      body.hidden = true;
      accessEnded.hidden = false;
      closeAllDialogs();
      takeFocus(accessEnded);
    }

    function narrowed() {
      scope = 'derivatives';
      clear(provenance);
      clear(previewSection);
      clear(regionsGroup);
      clear(custodyHost);
      originalButton.remove();
      accessChanged.hidden = false;
    }

    function unchangedMarks() {
      const key = (region) => `${region.page}:${region.x}:${region.y}:${region.w}:${region.h}`;
      const left = working.map(key).sort().join('|');
      const right = saved.map(key).sort().join('|');
      return left === right;
    }

    function drawRegions() {
      for (const node of Array.from(wrap.querySelectorAll('.region, .region-handle'))) {
        node.remove();
      }
      const onPage = working.filter((region) => region.page === page);
      onPage.forEach((region) => {
        const index = working.indexOf(region) + 1;
        const button = el('button', {
          type: 'button',
          class: 'region',
          text: `Region ${index}`,
          'aria-label': `Region ${index}`,
          dataset: { regionIndex: String(index) },
        });
        position(button, region);
        button.style.zIndex = String(10 + index);
        button.addEventListener('keydown', (event) => regionKeys(event, region, index));
        button.addEventListener('pointerdown', (event) => startDrag(event, region, 'move'));
        wrap.append(button);
        const handle = el('span', {
          class: 'region-handle',
          dataset: { regionHandle: String(index) },
        });
        handle.style.left = `calc(${(region.x + region.w) / 10}% - 22px)`;
        handle.style.top = `calc(${(region.y + region.h) / 10}% - 22px)`;
        handle.style.zIndex = String(100 + index);
        handle.addEventListener('pointerdown', (event) => startDrag(event, region, 'resize'));
        wrap.append(handle);
      });
    }

    function position(node, region) {
      node.style.left = region.x / 10 + '%';
      node.style.top = region.y / 10 + '%';
      node.style.width = region.w / 10 + '%';
      node.style.height = region.h / 10 + '%';
    }

    function announceRegion(index, region) {
      announce(
        redactionStatus,
        `Region ${index} at ${region.x}, ${region.y}, size ${region.w} by ${region.h}.`
      );
    }

    function addWorkingRegion(values) {
      const region = values || { page, x: 100, y: 100, w: 200, h: 100 };
      working = working.concat([region]);
      drawRegions();
      const index = working.indexOf(region) + 1;
      const node = wrap.querySelector(`[data-region-index="${index}"]`);
      if (node) node.focus();
      announceRegion(index, region);
    }

    function regionKeys(event, region, index) {
      const moves = {
        ArrowLeft: [-STEP, 0],
        ArrowRight: [STEP, 0],
        ArrowUp: [0, -STEP],
        ArrowDown: [0, STEP],
      };
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        working = working.filter((item) => item !== region);
        drawRegions();
        announce(redactionStatus, `Region ${index} removed.`);
        addRegion.focus();
        return;
      }
      if (!(event.key in moves)) return;
      event.preventDefault();
      const [dx, dy] = moves[event.key];
      if (event.shiftKey) {
        region.w = Math.max(STEP, Math.min(1000 - region.x, region.w + dx));
        region.h = Math.max(STEP, Math.min(1000 - region.y, region.h + dy));
      } else {
        region.x = Math.max(0, Math.min(1000 - region.w, region.x + dx));
        region.y = Math.max(0, Math.min(1000 - region.h, region.y + dy));
      }
      drawRegions();
      const node = wrap.querySelector(`[data-region-index="${index}"]`);
      if (node) node.focus();
      announceRegion(index, region);
    }

    function toThousandths(event) {
      const box = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1000, Math.round(((event.clientX - box.left) / box.width) * 1000))),
        y: Math.max(0, Math.min(1000, Math.round(((event.clientY - box.top) / box.height) * 1000))),
      };
    }

    function startDrag(event, region, mode) {
      event.preventDefault();
      event.stopPropagation();
      const start = toThousandths(event);
      const origin = { ...region };
      const index = working.indexOf(region) + 1;
      const move = (moveEvent) => {
        const now = toThousandths(moveEvent);
        if (mode === 'move') {
          region.x = Math.max(0, Math.min(1000 - region.w, origin.x + now.x - start.x));
          region.y = Math.max(0, Math.min(1000 - region.h, origin.y + now.y - start.y));
        } else {
          region.w = Math.max(STEP, Math.min(1000 - region.x, origin.w + now.x - start.x));
          region.h = Math.max(STEP, Math.min(1000 - region.y, origin.h + now.y - start.y));
        }
        drawRegions();
      };
      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        announceRegion(index, region);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
    }

    canvas.addEventListener('pointerdown', (event) => {
      if (scope !== 'full') return;
      event.preventDefault();
      const start = toThousandths(event);
      const region = { page, x: start.x, y: start.y, w: STEP, h: STEP };
      working = working.concat([region]);
      drawRegions();
      const index = working.indexOf(region) + 1;
      const move = (moveEvent) => {
        const now = toThousandths(moveEvent);
        region.x = Math.min(start.x, now.x);
        region.y = Math.min(start.y, now.y);
        region.w = Math.max(STEP, Math.abs(now.x - start.x));
        region.h = Math.max(STEP, Math.abs(now.y - start.y));
        region.w = Math.min(region.w, 1000 - region.x);
        region.h = Math.min(region.h, 1000 - region.y);
        drawRegions();
      };
      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        announceRegion(index, region);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
    });

    async function loadPreview() {
      if (scope !== 'full' || !canRedact() || !exhibit.page_count) return;
      const token = (paintToken += 1);
      announce(redactionStatus, 'Loading preview.');
      const grant = await post(
        `/api/exhibits/${encodeURIComponent(exhibitId)}/preview-grants`,
        { page }
      );
      if (token !== paintToken) return;
      if (grant.status === 503) {
        announce(redactionStatus, 'Preview unavailable. Exhibit storage is unreachable.');
        return;
      }
      if (grant.status !== 201) return;
      const file = await get(`/api/download/${grant.body.token}`, { blob: true });
      if (token !== paintToken || !(file.body instanceof Blob)) return;
      const bitmap = await createImageBitmap(file.body);
      if (token !== paintToken) {
        bitmap.close();
        return;
      }
      previewSize = { width: bitmap.width, height: bitmap.height };
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.style.width = 'min(100%, ' + bitmap.width + 'px)';
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close();
      canvas.setAttribute('aria-label', `Exhibit preview page ${page}`);
      announce(redactionStatus, 'Preview loaded.');
      drawRegions();
    }

    function turn(delta) {
      const limit = exhibit.page_count || 1;
      const wanted = Math.max(1, Math.min(limit, page + delta));
      if (wanted === page) return;
      page = wanted;
      canvas.setAttribute('aria-label', `Exhibit preview page ${page}`);
      drawRegions();
      loadPreview();
    }

    async function storeMarks() {
      announce(redactionStatus, 'Saving marks.');
      const reply = await put(`/api/exhibits/${encodeURIComponent(exhibitId)}/redactions`, {
        regions: working,
        marks_version: marksVersion,
      });
      if (reply.status === 401) {
        resendMarks = true;
        return;
      }
      if (reply.status === 200) {
        saved = reply.body.regions;
        marksVersion = reply.body.marks_version;
        redactionStatus.classList.remove('refusal');
        announce(redactionStatus, 'Marks saved.');
        return;
      }
      const code = errorCode(reply);
      if (code === 'stale_marks') {
        marksVersion = reply.body.marks_version;
        setStatus(redactionStatus, COPY.staleMarks, true);
        return;
      }
      if (reply.status === 422 && reply.body.errors) {
        setStatus(
          redactionStatus,
          reply.body.errors.regions || reply.body.errors.marks_version || COPY.noLonger,
          true
        );
        return;
      }
      setStatus(redactionStatus, code === 'exhibit_not_cleared' ? COPY.notCleared : COPY.noLonger, true);
    }

    async function renderDerivative() {
      if (!unchangedMarks()) {
        setStatus(redactionStatus, COPY.unsavedMarks, true);
        return;
      }
      announce(redactionStatus, 'Rendering.');
      const reply = await post(`/api/exhibits/${encodeURIComponent(exhibitId)}/derivatives`, {});
      if (reply.status === 201) {
        redactionStatus.classList.remove('refusal');
        announce(redactionStatus, `Rendered ${reply.body.id}.`);
        await refreshDerivatives();
        return;
      }
      if (reply.status === 503) {
        setStatus(redactionStatus, 'Not rendered. Exhibit storage is unreachable.', true);
        return;
      }
      setStatus(redactionStatus, COPY.noLonger, true);
    }

    async function runFind() {
      findError.hidden = true;
      announce(redactionStatus, 'Finding matches.');
      const reply = await post(
        `/api/exhibits/${encodeURIComponent(exhibitId)}/redactions/find`,
        { text: findText.value }
      );
      if (reply.status === 200) {
        const key = (region) => `${region.page}:${region.x}:${region.y}:${region.w}:${region.h}`;
        const seen = new Set(working.map(key));
        let added = 0;
        for (const match of reply.body.matches) {
          if (seen.has(key(match))) continue;
          working = working.concat([match]);
          seen.add(key(match));
          added += 1;
        }
        drawRegions();
        redactionStatus.classList.remove('refusal');
        announce(
          redactionStatus,
          added === 0 && reply.body.matches.length === 0
            ? 'No matches found. A scanned page may still hold this text.'
            : `Added ${added} regions. Save your marks to keep them.`
        );
        return;
      }
      if (reply.status === 422 && reply.body.errors && reply.body.errors.text) {
        findError.textContent = reply.body.errors.text;
        findError.hidden = false;
        findText.setAttribute('aria-invalid', 'true');
        setStatus(redactionStatus, reply.body.errors.text, true);
        findText.focus();
        return;
      }
      if (reply.status === 503) {
        setStatus(redactionStatus, 'Find unavailable. Exhibit storage is unreachable.', true);
        return;
      }
      setStatus(redactionStatus, COPY.noLonger, true);
    }

    async function downloadFile(path, name) {
      setStatus(status, 'Preparing download.');
      const result = await claim(path);
      if (result.grant.status === 503) {
        setStatus(
          status,
          'Download unavailable. Exhibit storage is unreachable. Your grant is still unused.',
          true
        );
        return;
      }
      if (result.grant.status !== 201) {
        setStatus(status, COPY.noLonger, true);
        return;
      }
      if (result.file && result.file.body instanceof Blob) {
        saveBlob(result.file.body, name);
        setStatus(status, 'Download started.');
        return;
      }
      setStatus(status, COPY.noLonger, true);
    }

    function downloadOriginal() {
      downloadFile(
        `/api/exhibits/${encodeURIComponent(exhibitId)}/download-grants`,
        `${exhibit.id}.bin`
      );
    }

    async function refreshDerivatives(background = true) {
      const reply = await get(
        `/api/exhibits/${encodeURIComponent(exhibitId)}/derivatives`,
        { background }
      );
      if (reply.status !== 200) return;
      syncRows(derivatives.body, reply.body.derivatives, {
        key: (item) => item.id,
        signature: (item) => `${item.superseded}|${item.disposed}|${item.sha256}`,
        build: (item) => {
          const button = el('button', {
            type: 'button',
            text: `Download ${item.id}`,
            on: {
              click: () =>
                downloadFile(
                  `/api/derivatives/${item.id}/download-grants`,
                  `${item.id}.bin`
                ),
            },
          });
          return el('tr', {}, [
            el('td', { class: 'mono', text: item.id }),
            el('td', {}, [el('span', { class: 'digest', text: item.sha256 })]),
            el('td', { class: 'mono', text: String(item.size) }),
            el('td', {}, [
              item.superseded
                ? el('span', { class: 'mono' }, [icon('\u21BB'), ' Superseded'])
                : el('span', { class: 'mono', text: 'Current' }),
            ]),
            el('td', {}, [button]),
          ]);
        },
      });
    }

    function renderActions() {
      clear(actions);
      if (scope === 'full' && ['intake_officer', 'case_lead', 'investigator'].includes(state.user.role)) {
        actions.append(originalButton);
      }
      if (state.user.role !== 'case_lead' || scope !== 'full') return;
      const matter = el('input', { type: 'text', 'aria-label': 'Hold matter' });
      const matterError = el('p', { class: 'field-error', hidden: true });
      const place = el('button', {
        type: 'button',
        text: 'Place hold',
        on: { click: () => placeHold(place, matter, matterError) },
      });
      actions.append(
        el('h2', { text: 'State' }),
        el('label', { text: 'Hold matter' }),
        matter,
        matterError,
        place
      );
      for (const hold of exhibit.holds) {
        const lift = el('button', {
          type: 'button',
          text: `Lift hold ${hold.matter_ref}`,
          on: { click: () => liftHold(lift, hold) },
        });
        actions.append(lift);
      }
      if (exhibit.state === 'cleared') {
        const dispose = el('button', {
          type: 'button',
          text: 'Dispose',
          on: { click: () => disposalAction(dispose, '', 'Proposing disposal.') },
        });
        actions.append(dispose);
      }
      if (exhibit.state === 'disposal proposed') {
        const confirm = el('button', {
          type: 'button',
          text: 'Confirm disposal',
          on: { click: () => disposalAction(confirm, '/confirm', 'Disposing.') },
        });
        const cancel = el('button', {
          type: 'button',
          text: 'Cancel disposal',
          on: { click: () => disposalAction(cancel, '/cancel', 'Cancelling disposal.') },
        });
        actions.append(confirm, cancel);
      }
    }

    async function placeHold(opener, matter, matterError) {
      matterError.hidden = true;
      setStatus(status, 'Saving hold.');
      const reply = await privileged({
        opener,
        needsReason: true,
        run: (proof, reason) =>
          post(
            `/api/exhibits/${encodeURIComponent(exhibitId)}/hold`,
            { reason, matter_ref: matter.value },
            { proof }
          ),
      });
      if (!reply) {
        setStatus(status, '');
        return;
      }
      if (reply.status === 200) {
        setStatus(status, 'Hold placed.');
        await reload();
        return;
      }
      const code = errorCode(reply);
      if (code === 'hold_exists') {
        setStatus(status, COPY.matterHolds, true);
        return;
      }
      if (reply.status === 422 && reply.body.errors && reply.body.errors.matter_ref) {
        matterError.textContent = reply.body.errors.matter_ref;
        matterError.hidden = false;
        setStatus(status, reply.body.errors.matter_ref, true);
        matter.focus();
        return;
      }
      setStatus(status, COPY.noLonger, true);
    }

    async function liftHold(opener, hold) {
      setStatus(status, 'Saving hold.');
      const reply = await privileged({
        opener,
        needsReason: true,
        run: (proof, reason) =>
          post(
            `/api/exhibits/${encodeURIComponent(exhibitId)}/lift-hold`,
            { hold_id: hold.id, reason },
            { proof }
          ),
      });
      if (!reply) {
        setStatus(status, '');
        return;
      }
      if (reply.status === 200) {
        const left = reply.body.holds.length;
        setStatus(
          status,
          left === 0 ? 'Hold lifted.' : `Hold lifted. Other holds remain: ${left}.`
        );
        await reload();
        return;
      }
      setStatus(status, COPY.noLonger, true);
    }

    async function disposalAction(opener, suffix, pending) {
      setStatus(status, pending);
      const reply = await privileged({
        opener,
        needsReason: suffix !== '/confirm',
        run: (proof, reason) =>
          post(
            `/api/exhibits/${encodeURIComponent(exhibitId)}/dispose${suffix}`,
            suffix === '/confirm' ? {} : { reason },
            { proof }
          ),
      });
      if (!reply) {
        setStatus(status, '');
        return;
      }
      if (reply.status === 200) {
        if (suffix === '') {
          setStatus(
            status,
            `Disposal proposed for ${exhibit.id}. Another case lead must confirm it.`
          );
        } else if (suffix === '/confirm') {
          setStatus(status, `Disposed ${exhibit.id}.`);
        } else {
          setStatus(status, 'Disposal cancelled.');
        }
        await reload();
        return;
      }
      const code = errorCode(reply);
      if (code === 'legal_hold') {
        setStatus(status, COPY.heldDisposal, true);
        return;
      }
      if (code === 'separation_of_duties') {
        setStatus(status, COPY.sodDisposal, true);
        return;
      }
      if (code === 'exhibit_in_release') {
        setStatus(status, COPY.noLonger, true);
        return;
      }
      if (code === 'storage_unavailable') {
        setStatus(status, 'Not disposed. Exhibit storage is unreachable.', true);
        return;
      }
      setStatus(status, COPY.noLonger, true);
    }

    async function reload(background = true) {
      if (dead) return;
      const reply = await get(`/api/exhibits/${encodeURIComponent(exhibitId)}`, {
        background,
      });
      if (reply.status === 404) {
        endAccess();
        return;
      }
      if (reply.status !== 200) return;
      const wasScope = scope;
      exhibit = reply.body;
      const compartment = docketHandle.compartment();
      if (compartment) scope = compartment.caller_scope;
      figure.textContent = exhibit.id;
      digest.textContent = exhibit.sha256;
      heading.textContent = exhibit.name;
      clear(stateLine);
      stateLine.append(el('span', { text: exhibit.state }));
      if (exhibit.state === 'held') {
        stateLine.append(' ', heldMarker());
      }
      if (exhibit.seal_check === 'failed') {
        stateLine.append(' ', el('span', { class: 'refusal' }, [icon('\u2717'), ' Seal failed']));
      }
      const breaking = state.breakGlass.find(
        (item) => item.compartment_id === exhibit.compartment_id
      );
      breakGlassTime.hidden = !breaking;
      if (breaking) {
        breakGlassTime.textContent = `Break-glass ends at ${String(breaking.ends_at).slice(11, 16)} UTC.`;
      }
      if (wasScope === 'full' && scope === 'derivatives') {
        narrowed();
      } else if (scope === 'full') {
        provenanceBlock();
        if (!previewSection.firstChild) {
          renderPreviewSection();
          await loadPreview();
        }
        renderRegionControls();
      }
      renderActions();
      await refreshDerivatives(background);
      if (scope === 'full' && !custody && state.user.role === 'case_lead') {
        custody = mountCustody(custodyHost, exhibitId, { withTimeline: true });
        await custody.load(background);
      } else if (custody) {
        await custody.load(background);
      }
    }

    const marks = canRedactFor(state.user.role)
      ? await get(`/api/exhibits/${encodeURIComponent(exhibitId)}/redactions`)
      : { status: 204 };
    if (marks.status === 200) {
      saved = marks.body.regions;
      working = saved.map((region) => ({ ...region }));
      marksVersion = marks.body.marks_version;
    } else if (marks.status === 404) {
      scope = 'derivatives';
    }
    renderPreviewSection();
    renderRegionControls();
    await reload(false);
    if (scope === 'full') await loadPreview();

    return {
      refresh: async () => {
        await reload(true);
        await docketHandle.refresh(true);
      },
      unsavedWork: () => !unchangedMarks(),
      onResumed: () => {
        if (!resendMarks) return;
        resendMarks = false;
        storeMarks();
      },
      dispose: () => {
        dead = true;
      },
    };
  },
};
