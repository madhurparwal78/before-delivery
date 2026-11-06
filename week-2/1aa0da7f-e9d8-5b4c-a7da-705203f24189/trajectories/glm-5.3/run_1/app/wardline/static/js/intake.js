/* Intake: registration with progress and quarantine clearance (DP-08 to DP-22). */
(function () {
  WL.renderIntakeScreen = async function (docketEl, inspectorEl) {
    document.title = 'Intake — Wardline';
    const quarantined = await countQuarantined();
    docketEl.innerHTML =
      WL.figure(quarantined, 'In quarantine') +
      `<form id="register-form" aria-label="Register exhibit">
         <div role="alert" aria-label="There is a problem" id="error-summary" class="error-summary" hidden>
           <h2>There is a problem</h2><ul id="error-list"></ul>
         </div>
         <label class="field-label">Compartment</label>
         <select name="compartment" id="f-compartment" aria-label="Compartment"></select>
         <label class="field-label">Exhibit name</label>
         <input type="text" name="name" aria-label="Exhibit name" id="f-name">
         <label class="field-label">Source</label>
         <input type="text" name="source" aria-label="Source" id="f-source">
         <label class="field-label">Collected by</label>
         <input type="text" name="collected_by" aria-label="Collected by" id="f-collected-by">
         <label class="field-label">Collected on</label>
         <input type="text" name="collected_on" aria-label="Collected on" id="f-collected-on" placeholder="YYYY-MM-DD">
         <label class="field-label">Capture notes</label>
         <textarea name="capture_notes" aria-label="Capture notes" id="f-notes"></textarea>
         <label class="field-label">Declared type</label>
         <select name="declared_type" aria-label="Declared type" id="f-type">
           <option value="application/pdf">PDF document</option>
           <option value="image/png">PNG image</option>
           <option value="image/jpeg">JPEG image</option>
           <option value="audio/wav">WAV audio</option>
           <option value="audio/mpeg">MPEG audio</option>
         </select>
         <label class="field-label">File</label>
         <input type="file" name="file" aria-label="File" id="f-file">
         <label class="field-label">Submitted digest</label>
         <input type="text" name="submitted_sha256" aria-label="Submitted digest" id="f-digest">
         <div class="actions-row" style="margin-top:14px">
           <button type="submit" id="register-button">Register exhibit</button>
         </div>
       </form>
       <div id="progress-slot" hidden>
         <progress id="upload-progress" aria-label="Upload progress" min="0" max="100" value="0"></progress>
       </div>
       <div role="status" aria-label="Intake status" id="intake-status"></div>
       <div class="section-heading">Quarantine</div>
       <div id="quarantine-host"></div>`;
    inspectorEl.innerHTML = `<p>${WL.copy.noRecord}</p>`;
    const statusEl = document.getElementById('intake-status');

    // compartments with an active full grant
    const compRes = await WL.api('GET', '/api/compartments');
    const sel = document.getElementById('f-compartment');
    if (compRes.ok) {
      for (const c of compRes.data.compartments) {
        const o = document.createElement('option');
        o.value = c.id; o.textContent = c.name;
        sel.appendChild(o);
      }
    }

    const form = document.getElementById('register-form');
    let idemKey = WL.newKey();
    let sending = false;
    let lastFieldValues = '';

    form.addEventListener('submit', (e) => { e.preventDefault(); register(); });
    form.addEventListener('change', () => { idemKey = WL.newKey(); });
    form.addEventListener('input', () => { idemKey = WL.newKey(); });

    async function register() {
      if (sending) return;
      sending = true;
      const button = document.getElementById('register-button');
      button.disabled = true;
      try {
        await doRegister();
      } finally {
        sending = false;
        button.disabled = false;
      }
    }

    async function doRegister() {
      const summary = document.getElementById('error-summary');
      const list = document.getElementById('error-list');
      summary.hidden = true;
      list.innerHTML = '';
      document.querySelectorAll('.field-error[data-for]').forEach((el) => { el.textContent = ''; });
      const fd = new FormData();
      fd.append('file', document.getElementById('f-file').files[0] || '');
      for (const name of ['name', 'source', 'collected_by', 'collected_on', 'capture_notes']) {
        fd.append(name, form.querySelector(`[name="${name}"]`).value);
      }
      fd.append('declared_type', document.getElementById('f-type').value);
      fd.append('submitted_sha256', document.getElementById('f-digest').value);

      const compartment = sel.value;
      const progressWrap = document.getElementById('progress-slot');
      const progress = document.getElementById('upload-progress');
      progressWrap.hidden = false;
      progress.value = 0;

      const announced = { 0: false, 25: false, 50: false, 75: false, 100: false };
      announce(0);

      function announce(pct) {
        if (pct in announced && !announced[pct]) {
          announced[pct] = true;
          statusEl.textContent = `Uploading ${pct} percent.`;
        }
      }

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/compartments/${encodeURIComponent(compartment)}/exhibits`);
      xhr.setRequestHeader('Idempotency-Key', idemKey);
      xhr.responseType = 'json';
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const pct = Math.floor((e.loaded / e.total) * 100);
          progress.value = Math.min(99, pct);
          for (const step of [0, 25, 50, 75]) {
            if (pct >= step) announce(step);
          }
        }
      });

      const result = await new Promise((resolve) => {
        xhr.addEventListener('load', () => {
          resolve({ status: xhr.status, data: xhr.response });
        });
        xhr.addEventListener('error', () => resolve(null));
        xhr.addEventListener('abort', () => resolve(null));
        xhr.send(fd);
      });

      if (result === null) {
        progressWrap.hidden = true;
        statusEl.textContent = WL.copy.connectionLost;
        return;
      }
      if (result.status === 201) {
        progress.value = 100;
        announce(100);
        statusEl.textContent = 'Confirming storage.';
        const id = result.data.id;
        statusEl.textContent = `Sealed ${id}. In quarantine until a second officer clears it.`;
        form.reset();
        document.getElementById('f-compartment').value = compartment;
        idemKey = WL.newKey();
        progressWrap.hidden = true;
        await refreshQuarantine();
        return;
      }
      // refusal
      progressWrap.hidden = true;
      const data = result.data || {};
      if (data.error === 'storage_unavailable') {
        statusEl.textContent = 'Not registered. Exhibit storage is unreachable, and nothing was kept. Try again when the notice clears.';
        return;
      }
      if (data.error === 'file_too_large') {
        statusEl.textContent = 'This file is over the 20,000,000 byte limit.';
        summary.hidden = false;
        list.innerHTML = `<li><a href="#f-file">File</a> — over the limit</li>`;
        document.getElementById('error-summary').focus();
        return;
      }
      const errors = data.errors || {};
      const order = ['compartment', 'name', 'declared_type', 'source', 'collected_by', 'collected_on', 'capture_notes', 'file', 'idempotency_key'];
      const items = [];
      const spoken = [];
      for (const field of order) {
        if (errors[field]) {
          items.push(`<li><a href="#f-${field === 'file' ? 'file' : field.replace('_', '-')}">${fieldLabel(field)}</a> — ${WL.escapeHtml(errors[field])}</li>`);
          spoken.push(errors[field]);
        }
      }
      if (items.length) {
        summary.hidden = false;
        list.innerHTML = items.join('');
        statusEl.textContent = spoken.join(' ');
        summary.focus();
      }
    }

    function fieldLabel(field) {
      const labels = {
        compartment: 'Compartment', name: 'Exhibit name', declared_type: 'Declared type',
        source: 'Source', collected_by: 'Collected by', collected_on: 'Collected on',
        capture_notes: 'Capture notes', file: 'File', idempotency_key: 'Idempotency key',
      };
      return labels[field] || field;
    }

    async function countQuarantined() {
      const res = await WL.api('GET', '/api/dashboard');
      if (!res.ok) return 0;
      return res.data.quarantined;
    }

    async function refreshQuarantine() {
      const res = await WL.api('GET', '/api/dashboard');
      if (res.ok) {
        const fig = docketEl.querySelector('[data-figure]');
        fig.textContent = res.data.quarantined;
      }
      const compartments = await WL.api('GET', '/api/compartments');
      const all = [];
      if (compartments.ok) {
        for (const c of compartments.data.compartments) {
          const ex = await WL.api('GET', `/api/compartments/${encodeURIComponent(c.id)}/exhibits?state=quarantined`, undefined, { background: true });
          if (ex.ok) all.push(...ex.data.exhibits);
        }
      }
      paintQuarantine(all);
    }

    function paintQuarantine(exhibits) {
      const host = document.getElementById('quarantine-host');
      const focused = document.activeElement;
      const focusedRow = focused && focused.closest('tr[data-exhibit]');
      const rows = exhibits.map((e) => {
        const sealFailed = e.seal_check === 'failed'
          ? `<span class="vermilion-col">● Seal failed</span>` : '';
        return `<tr data-exhibit="${e.id}">
          <td class="mono"><a href="/exhibits/${e.id}">${e.id}</a></td>
          <td>${WL.escapeHtml(e.name)}</td>
          <td class="mono" style="word-break:break-all">${e.sha256}</td>
          <td>${sealFailed}</td>
          <td><button class="ghost" data-clear="${e.id}">Clear ${e.id}</button>
              <button class="ghost" data-refuse="${e.id}">Refuse ${e.id}</button></td>
        </tr>`;
      }).join('');
      host.innerHTML = `<table aria-label="Quarantine" tabindex="-1">
        <thead><tr><th>Reference</th><th>Name</th><th>Digest</th><th></th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>`;
      host.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => clearExhibit(b.dataset.clear, b)));
      host.querySelectorAll('[data-refuse]').forEach((b) => b.addEventListener('click', () => refuseExhibit(b.dataset.refuse, b)));
      // focus follows the vanished-row rule
      if (focusedRow && !host.querySelector(`tr[data-exhibit="${focusedRow.dataset.exhibit}"]`)) {
        const remaining = Array.from(host.querySelectorAll('tr[data-exhibit]'));
        let next = null;
        for (const row of remaining) {
          if (row.dataset.exhibit > focusedRow.dataset.exhibit) { next = row.querySelector('[data-clear]'); break; }
        }
        if (!next && remaining.length) next = remaining[remaining.length - 1].querySelector('[data-clear]');
        if (next) next.focus(); else host.querySelector('table').focus();
      }
    }

    async function clearExhibit(eid, opener) {
      WL.stepUp({
        reason: false,
        onConfirm: async (proof, dlg) => {
          WL.actionStatus('Clearing.');
          const res = await WL.api('POST', `/api/exhibits/${encodeURIComponent(eid)}/clear`, {},
            { headers: { 'X-Step-Up-Proof': proof } });
          WL.dialog.close(dlg, 'ok');
          if (!res.ok) {
            const e = res.data && res.data.error;
            if (e === 'seal_mismatch') WL.actionStatus('Not cleared. The stored file no longer matches its seal.', 'vermilion');
            else if (e === 'illegal_transition') WL.actionStatus('Already decided by someone else.', 'vermilion');
            else if (e === 'separation_of_duties') WL.actionStatus('You registered this exhibit, so another officer must decide it.', 'vermilion');
            else if (e === 'storage_unavailable') WL.actionStatus('Not cleared. Exhibit storage is unreachable.', 'vermilion');
            else WL.actionStatus('This action is no longer available.', 'vermilion');
            return;
          }
          WL.actionStatus(`Cleared ${eid}.`);
          refreshQuarantine();
        },
        onClose: () => {
          if (!document.contains(opener)) {
            const host = document.getElementById('quarantine-host');
            const row = host && host.querySelector(`tr[data-exhibit="${eid}"]`);
            if (!row) {
              const remaining = host ? Array.from(host.querySelectorAll('tr[data-exhibit]')) : [];
              let next = null;
              for (const r of remaining) {
                if (r.dataset.exhibit > eid) { next = r.querySelector('[data-clear]'); break; }
              }
              if (!next && remaining.length) next = remaining[remaining.length - 1].querySelector('[data-clear]');
              if (next) next.focus(); else if (host) host.querySelector('table').focus();
            }
          }
        },
      });
    }

    async function refuseExhibit(eid, opener) {
      WL.stepUp({
        reason: true,
        reasonLabel: 'Reason',
        validateReason: (v) => v.trim().length < 10 ? 'Write a reason of at least 10 characters.' : null,
        onConfirm: async (proof, dlg, form) => {
          WL.actionStatus('Refusing.');
          const reason = form.querySelector('textarea[name="reason"]').value;
          const res = await WL.api('POST', `/api/exhibits/${encodeURIComponent(eid)}/refuse`,
            { reason: reason }, { headers: { 'X-Step-Up-Proof': proof } });
          if (!res.ok) {
            const e = res.data && res.data.error;
            if (e === 'illegal_transition') WL.actionStatus('Already decided by someone else.', 'vermilion');
            else if (e === 'separation_of_duties') WL.actionStatus('You registered this exhibit, so another officer must decide it.', 'vermilion');
            else WL.actionStatus('This action is no longer available.', 'vermilion');
            return;
          }
          WL.dialog.close(dlg, 'ok');
          WL.actionStatus(`Refused ${eid}.`);
          refreshQuarantine();
        },
      });
    }

    await refreshQuarantine();
    // live quarantine refresh
    clearInterval(WL.state.quarantineTimer);
    WL.state.quarantineTimer = setInterval(refreshQuarantine, 5000);

    WL.unsavedWork = function () {
      const fields = ['f-name', 'f-source', 'f-collected-by', 'f-collected-on', 'f-notes', 'f-digest'];
      for (const id of fields) {
        const el = document.getElementById(id);
        if (el && el.value) return true;
      }
      const file = document.getElementById('f-file');
      if (file && file.files.length) return true;
      return false;
    };
  };
})();
