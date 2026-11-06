/* Exhibit screen: preview canvas, redaction regions, derivatives, custody (DP-39 to DP-48). */
(function () {
  WL.renderExhibitScreen = async function (eid, docketEl, inspectorEl) {
    const res = await WL.api('GET', '/api/exhibits/' + encodeURIComponent(eid));
    if (!res.ok) { WL.renderNotFoundScreen(); return; }
    const ex = res.data;
    document.title = ex.name + ' — Wardline';

    // docket side: the compartment's docket
    const compRes = await WL.api('GET', '/api/compartments/' + encodeURIComponent(ex.compartment_id));
    const exRes = await WL.api('GET', `/api/compartments/${encodeURIComponent(ex.compartment_id)}/exhibits`, undefined, { background: true });
    docketEl.innerHTML =
      WL.figure(compRes.ok ? compRes.data.exhibit_count : 0, 'Exhibits') +
      WL.statusRegion('Compartment totals') +
      `<div class="section-heading">Exhibits</div><div id="exhibits-table"></div>`;
    if (compRes.ok) {
      const t = docketEl.querySelector('[data-region="Compartment totals"]');
      t.dataset.quarantineCount = compRes.data.quarantine_count;
      t.dataset.releaseBytes = compRes.data.release_bytes;
      t.textContent = `${compRes.data.quarantine_count} in quarantine. ${compRes.data.release_bytes} bytes in releases.`;
    }
    if (exRes.ok) {
      docketEl.querySelector('#exhibits-table').innerHTML =
        '<table aria-label="Exhibits"><tbody>' + exRes.data.exhibits.map((e) =>
          `<tr><td class="mono"><a href="/exhibits/${e.id}">${e.id}</a></td><td>${WL.escapeHtml(e.name)}</td></tr>`
        ).join('') + '</tbody></table>';
    }

    const isCaseLead = WL.state.user.role === 'case_lead';
    const fullScope = compRes.ok && compRes.data.caller_scope === 'full';
    const canRedact = fullScope && ['investigator', 'case_lead'].includes(WL.state.user.role);
    const derivativesScope = compRes.ok && compRes.data.caller_scope === 'derivatives';

    inspectorEl.innerHTML =
      `<button id="back-docket" class="ghost" style="display:none">Back to docket</button>` +
      WL.figure(ex.id, 'Exhibit') +
      `<div class="mono" style="word-break:break-all;margin:0 28px 10px 28px" id="sha">${ex.sha256}</div>` +
      (derivativesScope ? '' : `<div class="section-heading">Provenance</div>
        <div class="kv-list" id="provenance">
          <div class="kv-row"><span class="kv-key">Source</span><span class="kv-value">${WL.escapeHtml(ex.provenance.source || '')}</span></div>
          <div class="kv-row"><span class="kv-key">Collected by</span><span class="kv-value">${WL.escapeHtml(ex.provenance.collected_by || '')}</span></div>
          <div class="kv-row"><span class="kv-key">Collected on</span><span class="kv-value">${WL.escapeHtml(ex.provenance.collected_on || '')}</span></div>
        </div>`) +
      `<div role="alert" aria-label="Access changed" id="access-changed" hidden class="access-ended">${WL.copy.accessChanged}</div>` +
      (canRedact && ex.page_count ? `
        <div class="section-heading">Preview</div>
        <div class="actions-row">
          <button id="prev-page" class="ghost">Previous page</button>
          <button id="next-page" class="ghost">Next page</button>
        </div>
        <div class="preview-wrap" id="preview-wrap"></div>
        <div role="status" aria-label="Redaction status" id="redaction-status"></div>
        <div class="region-tools" role="group" aria-label="Redaction regions">
          <div class="actions-row">
            <button id="add-region" class="ghost">Add region</button>
            <button id="save-marks" class="ghost">Save marks</button>
            <button id="render-derivative">Render derivative</button>
          </div>
          <div id="region-buttons" style="display:grid;gap:6px;margin-top:8px"></div>
          <label class="field-label">Find text</label>
          <input type="text" id="find-text" aria-label="Find text">
          <div class="field-error" data-for="text"></div>
          <div class="actions-row"><button id="mark-matches" class="ghost">Mark matches</button></div>
        </div>` : '') +
      (canRedact || derivativesScope || true ? `
        <div class="section-heading">Derivatives</div>
        <div id="derivatives"></div>
        ${canRedact ? '<div class="actions-row"><button id="download-original" class="ghost">Download original</button></div>' : ''}` : '') +
      (isCaseLead && fullScope ? `
        <div class="section-heading">Holds</div>
        <div id="holds"></div>
        <label class="field-label">Hold matter</label>
        <input type="text" id="hold-matter" aria-label="Hold matter">
        <div class="field-error" data-for="matter_ref"></div>
        <div class="actions-row">
          <button id="place-hold" class="ghost">Place hold</button>
          <button id="dispose" class="ghost">Dispose</button>
          <button id="confirm-disposal" class="ghost">Confirm disposal</button>
          <button id="cancel-disposal" class="ghost">Cancel disposal</button>
        </div>` : '') +
      `<div id="custody-host"></div>`;

    WL.applyViewportAfter = applyViewport;
    applyViewport();
    function applyViewport() {
      const back = inspectorEl.querySelector('#back-docket');
      if (!back) return;
      if (window.innerWidth < 768) back.style.display = '';
      else back.style.display = 'none';
      back.onclick = () => WL.go('/compartments/' + ex.compartment_id);
    }

    const redaction = { regions: [], saved: [], marksVersion: 0, dirty: false, page: 1, dragging: null };

    // ---- preview and regions ----
    if (canRedact && ex.page_count) {
      await loadSavedRegions();
      await paintPreview(1);

      document.getElementById('prev-page').addEventListener('click', () => turnPage(-1));
      document.getElementById('next-page').addEventListener('click', () => turnPage(1));
      document.getElementById('add-region').addEventListener('click', () => {
        const region = { page: redaction.page, x: 100, y: 100, w: 200, h: 100 };
        redaction.regions.push(region);
        redaction.dirty = true;
        announceRegion(redaction.regions.length, region);
        paintRegionButtons();
      });
      document.getElementById('save-marks').addEventListener('click', saveMarks);
      document.getElementById('render-derivative').addEventListener('click', renderDerivative);
      document.getElementById('mark-matches').addEventListener('click', markMatches);
    }

    async function loadSavedRegions() {
      const res = await WL.api('GET', `/api/exhibits/${encodeURIComponent(eid)}/redactions`, undefined, { background: true });
      if (res.ok) {
        redaction.saved = res.data.regions;
        redaction.marksVersion = res.data.marks_version;
        redaction.regions = WL.copy(res.data.regions);
      }
    }

    async function turnPage(delta) {
      const next = redaction.page + delta;
      if (next < 1 || next > ex.page_count) return;
      const token = ++previewToken;
      await paintPreview(next);
      if (token === previewToken) redaction.page = next;
    }

    let previewToken = 0;
    async function paintPreview(page) {
      const token = ++previewToken;
      const wrap = document.getElementById('preview-wrap');
      const status = document.getElementById('redaction-status');
      status.textContent = 'Loading preview.';
      const grant = await WL.api('POST', `/api/exhibits/${encodeURIComponent(eid)}/preview-grants`, { page: page });
      if (token !== previewToken) return;
      if (!grant.ok) {
        if (grant.data && grant.data.error === 'storage_unavailable') status.textContent = 'Preview unavailable. Exhibit storage is unreachable.';
        else if (grant.data && grant.data.error === 'not_previewable') status.textContent = 'This exhibit cannot be previewed.';
        else if (grant.data && grant.data.error === 'exhibit_not_cleared') status.textContent = 'This exhibit has not been cleared.';
        return;
      }
      const fileRes = await fetch(`/api/download/${grant.data.token}`, { credentials: 'same-origin' });
      if (token !== previewToken) return;
      if (!fileRes.ok) return;
      const blob = await fileRes.blob();
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((r) => { img.onload = r; img.src = url; });
      if (token !== previewToken) { URL.revokeObjectURL(url); return; }
      const canvas = document.createElement('canvas');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Exhibit preview page ${page}`);
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      wrap.innerHTML = '';
      wrap.appendChild(canvas);
      URL.revokeObjectURL(url);
      status.textContent = 'Preview loaded.';
      attachCanvasPointer(canvas);
      paintRegions();
    }

    function canvasPoint(canvas, e) {
      const rect = canvas.getBoundingClientRect();
      const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000);
      const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000);
      return { x: Math.max(0, Math.min(1000, x)), y: Math.max(0, Math.min(1000, y)) };
    }

    function attachCanvasPointer(canvas) {
      canvas.style.touchAction = 'none';
      canvas.addEventListener('pointerdown', (e) => {
        const p = canvasPoint(canvas, e);
        const hit = hitRegion(p);
        if (hit >= 0) { startDragMove(hit, p, canvas); return; }
        const start = { x: p.x, y: p.y };
        const region = { page: redaction.page, x: p.x, y: p.y, w: 1, h: 1 };
        redaction.regions.push(region);
        redaction.dirty = true;
        const move = (ev) => {
          const q = canvasPoint(canvas, ev);
          region.x = Math.min(start.x, q.x); region.y = Math.min(start.y, q.y);
          region.w = Math.max(1, Math.abs(q.x - start.x)); region.h = Math.max(1, Math.abs(q.y - start.y));
          paintRegions();
        };
        const up = () => {
          canvas.removeEventListener('pointermove', move);
          canvas.removeEventListener('pointerup', up);
          announceRegion(redaction.regions.length, region);
          paintRegionButtons();
        };
        canvas.addEventListener('pointermove', move);
        canvas.addEventListener('pointerup', up);
      });
    }

    function hitRegion(p) {
      for (let i = redaction.regions.length - 1; i >= 0; i--) {
        const r = redaction.regions[i];
        if (r.page !== redaction.page) continue;
        if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return i;
      }
      return -1;
    }

    function startDragMove(index, p, canvas) {
      const region = redaction.regions[index];
      const origin = { x: p.x, y: p.y, rx: region.x, ry: region.y };
      const move = (ev) => {
        const q = canvasPoint(canvas, ev);
        region.x = Math.max(0, Math.min(1000 - region.w, origin.rx + q.x - origin.x));
        region.y = Math.max(0, Math.min(1000 - region.h, origin.ry + q.y - origin.y));
        paintRegions();
      };
      const up = () => {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        redaction.dirty = true;
        announceRegion(index + 1, region);
      };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);
    }

    function paintRegions() {
      const wrap = document.getElementById('preview-wrap');
      const canvas = wrap && wrap.querySelector('canvas');
      if (!canvas) return;
      // existing region overlays
      wrap.querySelectorAll('.region-box').forEach((el) => el.remove());
      let n = 0;
      for (const r of redaction.regions) {
        n++;
        if (r.page !== redaction.page) continue;
        const box = document.createElement('div');
        box.className = 'region-box';
        box.style.left = (r.x / 1000 * canvas.clientWidth) + 'px';
        box.style.top = (r.y / 1000 * canvas.clientHeight) + 'px';
        box.style.width = Math.max(44, r.w / 1000 * canvas.clientWidth) + 'px';
        box.style.height = Math.max(44, r.h / 1000 * canvas.clientHeight) + 'px';
        box.style.position = 'absolute';
        box.style.zIndex = String(2 + n);
        const handle = document.createElement('div');
        handle.className = 'region-handle';
        handle.dataset.regionHandle = String(n);
        handle.setAttribute('tabindex', '-1');
        handle.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          const startX = e.clientX, startY = e.clientY;
          const ow = r.w, oh = r.h;
          const move = (ev) => {
            const dx = Math.round((ev.clientX - startX) / canvas.clientWidth * 1000);
            const dy = Math.round((ev.clientY - startY) / canvas.clientHeight * 1000);
            r.w = Math.max(1, ow + dx);
            r.h = Math.max(1, oh + dy);
            paintRegions();
          };
          const up = () => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
            redaction.dirty = true;
            announceRegion(n, r);
          };
          document.addEventListener('pointermove', move);
          document.addEventListener('pointerup', up);
        });
        box.appendChild(handle);
        wrap.appendChild(box);
      }
    }

    function paintRegionButtons() {
      const host = document.getElementById('region-buttons');
      if (!host) return;
      const focus = document.activeElement && document.activeElement.dataset ?
        document.activeElement.dataset.regionIndex : null;
      host.innerHTML = redaction.regions.map((r, i) =>
        `<button class="ghost" data-region-index="${i + 1}" data-region="${i}">Region ${i + 1}</button>`
      ).join('');
      host.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', () => {
          const i = Number(b.dataset.region);
          const r = redaction.regions[i];
          b.addEventListener('keydown', (e) => {
            const step = e.shiftKey ? 'resize' : 'move';
            let handled = true;
            if (step === 'move') {
              if (e.key === 'ArrowLeft') r.x = Math.max(0, r.x - 10);
              else if (e.key === 'ArrowRight') r.x = Math.min(1000 - r.w, r.x + 10);
              else if (e.key === 'ArrowUp') r.y = Math.max(0, r.y - 10);
              else if (e.key === 'ArrowDown') r.y = Math.min(1000 - r.h, r.y + 10);
              else handled = false;
            } else {
              if (e.key === 'ArrowLeft') r.w = Math.max(10, r.w - 10);
              else if (e.key === 'ArrowRight') r.w = Math.min(1000 - r.x, r.w + 10);
              else if (e.key === 'ArrowUp') r.h = Math.max(10, r.h - 10);
              else if (e.key === 'ArrowDown') r.h = Math.min(1000 - r.y, r.h + 10);
              else handled = false;
            }
            if (handled) {
              e.preventDefault();
              redaction.dirty = true;
              announceRegion(Number(b.dataset.regionIndex), r);
              paintRegions();
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
              e.preventDefault();
              redaction.regions.splice(i, 1);
              redaction.dirty = true;
              paintRegionButtons();
              paintRegions();
              const add = document.getElementById('add-region');
              if (add) add.focus();
            }
          });
        });
      });
      if (focus) {
        const again = host.querySelector(`[data-region-index="${focus}"]`);
        if (again) again.focus();
      }
      paintRegions();
    }

    function announceRegion(n, r) {
      WL.setStatus('Redaction status', `Region ${n} at ${r.x}, ${r.y}, size ${r.w} by ${r.h}.`);
    }

    async function saveMarks() {
      const status = document.getElementById('redaction-status');
      status.textContent = 'Saving marks.';
      const res = await WL.api('PUT', `/api/exhibits/${encodeURIComponent(eid)}/redactions`, {
        regions: redaction.regions, marks_version: redaction.marksVersion,
      });
      if (!res.ok) {
        const e = res.data && res.data.error;
        if (e === 'stale_marks') {
          redaction.marksVersion = res.data.marks_version;
          status.textContent = 'Someone else changed these marks. Review them and try again.';
        } else if (e === 'stale_marks') { /* handled above */ }
        else if (e === 'exhibit_not_cleared') status.textContent = 'This exhibit has not been cleared.';
        else status.textContent = 'Someone else changed these marks. Review them and try again.';
        return;
      }
      redaction.marksVersion = res.data.marks_version;
      redaction.saved = res.data.regions;
      redaction.dirty = false;
      status.textContent = 'Marks saved.';
    }

    async function renderDerivative() {
      const status = document.getElementById('redaction-status');
      if (redaction.dirty) {
        status.textContent = 'Save your marks before rendering.';
        return;
      }
      WL.stepUp({
        reason: false,
        onConfirm: async (proof, dlg) => {
          status.textContent = 'Rendering.';
          const res = await WL.api('POST', `/api/exhibits/${encodeURIComponent(eid)}/derivatives`, {},
            { headers: { 'X-Step-Up-Proof': proof } });
          WL.dialog.close(dlg, 'ok');
          if (!res.ok) {
            const e = res.data && res.data.error;
            if (e === 'storage_unavailable') status.textContent = 'Not rendered. Exhibit storage is unreachable.';
            else if (e === 'not_redactable') status.textContent = 'This exhibit cannot be redacted.';
            else if (e === 'exhibit_not_cleared') status.textContent = 'This exhibit has not been cleared.';
            else status.textContent = 'This action is no longer available.';
            return;
          }
          status.textContent = `Rendered ${res.data.id}.`;
          await paintDerivatives();
        },
      });
    }

    async function markMatches() {
      const status = document.getElementById('redaction-status');
      const text = document.getElementById('find-text').value;
      if (!text.trim()) return;
      status.textContent = 'Finding matches.';
      const res = await WL.api('POST', `/api/exhibits/${encodeURIComponent(eid)}/redactions/find`, { text: text });
      if (!res.ok) {
        const e = res.data && res.data.error;
        if (e === 'storage_unavailable') status.textContent = 'Find unavailable. Exhibit storage is unreachable.';
        else if (e === 'not_redactable') status.textContent = 'This exhibit cannot be redacted.';
        else status.textContent = 'Find unavailable. Exhibit storage is unreachable.';
        return;
      }
      const matches = res.data.matches;
      let added = 0;
      for (const m of matches) {
        const dup = redaction.regions.some((r) =>
          r.page === m.page && r.x === m.x && r.y === m.y && r.w === m.w && r.h === m.h);
        if (!dup) { redaction.regions.push(m); added++; }
      }
      redaction.dirty = redaction.regions.length !== redaction.saved.length || added > 0;
      status.textContent = added ?
        `Added ${added} regions. Save your marks to keep them.` :
        'No matches found. A scanned page may still hold this text.';
      paintRegionButtons();
    }

    // ---- derivatives ----
    async function paintDerivatives() {
      const host = document.getElementById('derivatives');
      const res = await WL.api('GET', `/api/exhibits/${encodeURIComponent(eid)}/derivatives`, undefined, { background: true });
      if (!res.ok) { host.innerHTML = ''; return; }
      host.innerHTML = '<table aria-label="Derivatives"><thead><tr><th>Reference</th><th>Type</th><th>Bytes</th><th>Marks</th><th></th></tr></thead><tbody>' +
        res.data.derivatives.map((d) => {
          const sup = d.superseded ? '<span class="mono">◇ Superseded</span>' : '';
          return `<tr><td class="mono">${d.id}</td><td class="mono">${WL.escapeHtml(d.content_type)}</td>` +
            `<td class="mono">${d.size}</td><td class="mono">${d.marks_version}</td>` +
            `<td><button class="ghost" data-download="${d.id}" ${d.disposed ? 'disabled' : ''}>Download ${d.id}</button> ${sup}</td></tr>`;
        }).join('') + '</tbody></table>';
      host.querySelectorAll('[data-download]').forEach((b) =>
        b.addEventListener('click', async () => {
          WL.actionStatus('Preparing download.');
          const grant = await WL.api('POST', `/api/derivatives/${b.dataset.download}/download-grants`, {});
          if (!grant.ok) {
            WL.actionStatus('Download unavailable. Exhibit storage is unreachable. Your grant is still unused.', 'vermilion');
            return;
          }
          location.href = `/api/download/${grant.data.token}`;
          WL.actionStatus('Download started.');
        }));
    }
    await paintDerivatives();

    // download original
    const dl = document.getElementById('download-original');
    if (dl) {
      dl.addEventListener('click', async () => {
        WL.actionStatus('Preparing download.');
        const grant = await WL.api('POST', `/api/exhibits/${encodeURIComponent(eid)}/download-grants`, {});
        if (!grant.ok) {
          WL.actionStatus('Download unavailable. Exhibit storage is unreachable. Your grant is still unused.', 'vermilion');
          return;
        }
        location.href = `/api/download/${grant.data.token}`;
        WL.actionStatus('Download started.');
      });
    }

    // ---- holds and disposal ----
    if (isCaseLead && fullScope) {
      await paintHolds();
      document.getElementById('place-hold').addEventListener('click', () => {
        const matter = document.getElementById('hold-matter').value.trim();
        const errEl = inspectorEl.querySelector('[data-for="matter_ref"]');
        WL.stepUp({
          reason: true,
          reasonLabel: 'Reason',
          validateReason: (v) => v.trim().length < 10 ? 'Write a reason of at least 10 characters.' : null,
          onConfirm: async (proof, dlg, form) => {
            WL.actionStatus('Saving hold.');
            const res = await WL.api('POST', `/api/exhibits/${encodeURIComponent(eid)}/hold`, {
              reason: form.querySelector('textarea[name="reason"]').value,
              matter_ref: matter,
            }, { headers: { 'X-Step-Up-Proof': proof } });
            if (!res.ok) {
              const e = res.data && res.data.error;
              if (e === 'hold_exists') WL.actionStatus('This matter already holds this exhibit.', 'vermilion');
              else if (e === 'legal_hold') WL.actionStatus('Under legal hold. This exhibit cannot be disposed of.', 'vermilion');
              else if ((res.data.errors || {}).matter_ref) {
                errEl.textContent = res.data.errors.matter_ref;
                errEl.previousElementSibling.focus();
                WL.dialog.close(dlg, 'stay');
                return;
              } else WL.actionStatus('This action is no longer available.', 'vermilion');
              return;
            }
            WL.dialog.close(dlg, 'ok');
            WL.actionStatus('Hold placed.');
            WL.render();
          },
        });
      });

      document.getElementById('dispose').addEventListener('click', () => {
        WL.stepUp({
          reason: true,
          reasonLabel: 'Reason',
          validateReason: (v) => v.trim().length < 10 ? 'Write a reason of at least 10 characters.' : null,
          onConfirm: async (proof, dlg, form) => {
            WL.actionStatus('Proposing disposal.');
            const res = await WL.api('POST', `/api/exhibits/${encodeURIComponent(eid)}/dispose`, {
              reason: form.querySelector('textarea[name="reason"]').value,
            }, { headers: { 'X-Step-Up-Proof': proof } });
            WL.dialog.close(dlg, 'ok');
            if (!res.ok) {
              const e = res.data && res.data.error;
              if (e === 'legal_hold') WL.actionStatus('Under legal hold. This exhibit cannot be disposed of.', 'vermilion');
              else if (e === 'exhibit_in_release') WL.actionStatus('This action is no longer available.', 'vermilion');
              else WL.actionStatus('This action is no longer available.', 'vermilion');
              return;
            }
            WL.actionStatus(`Disposal proposed for ${eid}. Another case lead must confirm it.`);
            WL.render();
          },
        });
      });

      document.getElementById('confirm-disposal').addEventListener('click', () => {
        WL.stepUp({
          reason: false,
          onConfirm: async (proof, dlg) => {
            WL.actionStatus('Disposing.');
            const res = await WL.api('POST', `/api/exhibits/${encodeURIComponent(eid)}/dispose/confirm`, {},
              { headers: { 'X-Step-Up-Proof': proof } });
            WL.dialog.close(dlg, 'ok');
            if (!res.ok) {
              const e = res.data && res.data.error;
              if (e === 'legal_hold') WL.actionStatus('Under legal hold. This exhibit cannot be disposed of.', 'vermilion');
              else if (e === 'separation_of_duties') WL.actionStatus('You proposed this disposal, so another case lead must confirm it.', 'vermilion');
              else if (e === 'storage_unavailable') WL.actionStatus('Not disposed. Exhibit storage is unreachable.', 'vermilion');
              else WL.actionStatus('This action is no longer available.', 'vermilion');
              return;
            }
            WL.actionStatus(`Disposed ${eid}.`);
            WL.render();
          },
        });
      });

      document.getElementById('cancel-disposal').addEventListener('click', () => {
        WL.stepUp({
          reason: true,
          reasonLabel: 'Reason',
          validateReason: (v) => v.trim().length < 10 ? 'Write a reason of at least 10 characters.' : null,
          onConfirm: async (proof, dlg, form) => {
            WL.actionStatus('Cancelling disposal.');
            const res = await WL.api('POST', `/api/exhibits/${encodeURIComponent(eid)}/dispose/cancel`, {
              reason: form.querySelector('textarea[name="reason"]').value,
            }, { headers: { 'X-Step-Up-Proof': proof } });
            WL.dialog.close(dlg, 'ok');
            if (!res.ok) { WL.actionStatus('This action is no longer available.', 'vermilion'); return; }
            WL.actionStatus('Disposal cancelled.');
            WL.render();
          },
        });
      });
    }

    async function paintHolds() {
      const host = document.getElementById('holds');
      const fresh = await WL.api('GET', '/api/exhibits/' + encodeURIComponent(eid), undefined, { background: true });
      if (!fresh.ok || !host) return;
      const holds = fresh.data.holds || [];
      host.innerHTML = (holds.length ?
        '<table aria-label="Holds"><thead><tr><th>Matter</th><th>Placed by</th><th></th></tr></thead><tbody>' +
        holds.map((h) => `<tr><td class="mono">${WL.escapeHtml(h.matter_ref)}</td><td class="mono">${WL.escapeHtml(h.placed_by)}</td>` +
          `<td><button class="ghost" data-lift="${h.id}" data-matter="${WL.escapeHtml(h.matter_ref)}">Lift hold ${WL.escapeHtml(h.matter_ref)}</button></td></tr>`).join('') +
        '</tbody></table>' : '') +
        (fresh.data.state === 'held' ? `<div class="held-marker" data-held-marker>● Held</div>` : '');
      host.querySelectorAll('[data-lift]').forEach((b) =>
        b.addEventListener('click', () => {
          WL.stepUp({
            reason: true,
            reasonLabel: 'Reason',
            validateReason: (v) => v.trim().length < 10 ? 'Write a reason of at least 10 characters.' : null,
            onConfirm: async (proof, dlg, form) => {
              WL.actionStatus('Saving hold.');
              const res = await WL.api('POST', `/api/exhibits/${encodeURIComponent(eid)}/lift-hold`, {
                hold_id: b.dataset.lift, reason: form.querySelector('textarea[name="reason"]').value,
              }, { headers: { 'X-Step-Up-Proof': proof } });
              WL.dialog.close(dlg, 'ok');
              if (!res.ok) { WL.actionStatus('This action is no longer available.', 'vermilion'); return; }
              const remaining = (res.data.holds || []).length;
              WL.actionStatus(remaining === 0 ? 'Hold lifted.' : `Hold lifted. Other holds remain: ${remaining}.`);
              WL.render();
            },
          });
        }));
    }

    // ---- custody surfaces ----
    const custodyAllowed = await custodyAdmitted(ex.compartment_id);
    if (custodyAllowed) {
      const host = inspectorEl.querySelector('#custody-host');
      await WL.renderCustodySurfaces(host, eid);
    }

    async function custodyAdmitted(cid) {
      if (WL.state.user.role === 'auditor') return true;
      if (WL.state.user.role !== 'case_lead') return false;
      const c = await WL.api('GET', '/api/compartments/' + encodeURIComponent(cid), undefined, { background: true });
      return c.ok && c.data.caller_scope === 'full';
    }

    // periodic grant check (DP-26)
    clearInterval(WL.state.exhibitTimer);
    WL.state.exhibitTimer = setInterval(async () => {
      const c = await WL.api('GET', '/api/compartments/' + encodeURIComponent(ex.compartment_id), undefined, { background: true });
      if (c.status === 404) { WL.showAccessEnded(); return; }
      if (!c.ok) return;
      if (c.data.caller_scope === 'derivatives' && fullScope) {
        const alert = inspectorEl.querySelector('#access-changed');
        if (alert) alert.hidden = false;
        const toRemove = ['#provenance', '#preview-wrap', '.region-tools', '#download-original', '#custody-host'];
        for (const selr of toRemove) {
          const el = inspectorEl.querySelector(selr);
          if (el) el.remove();
        }
      }
    }, 5000);

    WL.unsavedWork = function () {
      if (redaction.dirty) return true;
      if (WL.dialog.stack.length) return true;
      return false;
    };
  };

  WL.renderNotFoundScreen = function () {
    WL.renderer && WL.renderer();
  };
})();
