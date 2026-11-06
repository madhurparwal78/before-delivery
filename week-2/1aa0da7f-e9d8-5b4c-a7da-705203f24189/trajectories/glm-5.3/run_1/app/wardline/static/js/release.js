/* Release screen: assembly, decisions, links (DP-49 to DP-60). */
(function () {
  WL.renderReleaseScreen = async function (rid, docketEl, inspectorEl) {
    const res = await WL.api('GET', '/api/releases/' + encodeURIComponent(rid));
    if (!res.ok) { WL.renderNotFoundScreen(); return; }
    const rel = res.data;

    const compRes = await WL.api('GET', '/api/compartments/' + encodeURIComponent(rel.compartment_id));
    const releasesRes = await WL.api('GET', `/api/compartments/${encodeURIComponent(rel.compartment_id)}/releases`, undefined, { background: true });
    docketEl.innerHTML =
      WL.figure(compRes.ok ? compRes.data.exhibit_count : 0, 'Exhibits') +
      WL.statusRegion('Compartment totals') +
      `<div class="section-heading">Releases</div><div id="docket-releases"></div>`;
    if (compRes.ok) {
      const t = docketEl.querySelector('[data-region="Compartment totals"]');
      t.dataset.quarantineCount = compRes.data.quarantine_count;
      t.dataset.releaseBytes = compRes.data.release_bytes;
      t.textContent = `${compRes.data.quarantine_count} in quarantine. ${compRes.data.release_bytes} bytes in releases.`;
    }
    if (releasesRes.ok) {
      docketEl.querySelector('#docket-releases').innerHTML =
        '<table aria-label="Releases"><tbody>' + releasesRes.data.releases.map((r) =>
          `<tr><td class="mono"><a href="/releases/${r.id}">${r.id}</a></td><td>${WL.escapeHtml(r.name)}</td><td class="mono">${WL.escapeHtml(r.state)}</td></tr>`
        ).join('') + '</tbody></table>';
    }

    const isCaseLead = WL.state.user.role === 'case_lead';
    const fullScope = compRes.ok && compRes.data.caller_scope === 'full';
    const breakGlass = compRes.ok && compRes.data.caller_scope === 'full' &&
      WL.state.breakGlass && WL.state.breakGlass.some((b) => b.compartment_id === rel.compartment_id);
    const isContributor = rel.contributor_ids.includes(WL.state.user.id) || rel.assembler_id === WL.state.user.id;

    inspectorEl.innerHTML =
      `<button id="back-docket" class="ghost" style="display:none">Back to docket</button>` +
      WL.figure(rel.items.length, 'Items') +
      `<div class="mono" style="margin:0 28px 10px 28px" data-manifest-digest="true">${rel.manifest_digest}</div>` +
      `<div role="status" aria-label="Release state" id="release-state">${WL.stateWords[rel.state]}</div>` +
      `<div role="status" aria-label="Action status"></div>
       <div class="section-heading">Items</div><div id="items"></div>
       ${rel.state === 'assembling' ? `
         <div class="section-heading">Add item</div>
         <label class="field-label">Derivative</label><select id="item-derivative" aria-label="Derivative"></select>
         <label class="field-label">Item label</label><input type="text" id="item-label" aria-label="Item label">
         <div class="field-error" data-for="label"></div>
         <div class="actions-row"><button id="add-item" class="ghost">Add item</button></div>` : ''}
       <div class="actions-row" id="decision-buttons"></div>
       <div id="link-slot"></div>`;

    applyViewport();
    function applyViewport() {
      const back = inspectorEl.querySelector('#back-docket');
      if (!back) return;
      back.style.display = window.innerWidth < 768 ? '' : 'none';
      back.onclick = () => WL.go('/compartments/' + rel.compartment_id);
    }

    // derivative combobox
    if (rel.state === 'assembling') {
      const dvRes = await WL.api('GET', `/api/exhibits?compartment=${encodeURIComponent(rel.compartment_id)}`, undefined, { background: true });
      const sel = document.getElementById('item-derivative');
      // derivatives from this compartment
      const comps = await WL.api('GET', '/api/compartments', undefined, { background: true });
      if (comps.ok) {
        const mine = comps.data.compartments.find((c) => c.id === rel.compartment_id);
        if (mine) {
          const exRes = await WL.api('GET', `/api/compartments/${encodeURIComponent(rel.compartment_id)}/exhibits`, undefined, { background: true });
          if (exRes.ok) {
            for (const e of exRes.data.exhibits) {
              const dRes = await WL.api('GET', `/api/exhibits/${encodeURIComponent(e.id)}/derivatives`, undefined, { background: true });
              if (dRes.ok) {
                for (const d of dRes.data.derivatives) {
                  if (d.disposed) continue;
                  const o = document.createElement('option');
                  o.value = d.id; o.textContent = d.id;
                  sel.appendChild(o);
                }
              }
            }
          }
        }
      }
      document.getElementById('add-item').addEventListener('click', async () => {
        WL.actionStatus('Saving item.');
        const res = await WL.api('POST', `/api/releases/${encodeURIComponent(rid)}/items`, {
          derivative_id: sel.value, label: document.getElementById('item-label').value,
        });
        if (!res.ok) {
          const errs = res.data.errors || {};
          const errEl = inspectorEl.querySelector('[data-for="label"]');
          errEl.textContent = errs.label || errs.derivative_id || '';
          WL.actionStatus('This action is no longer available.', 'vermilion');
          return;
        }
        WL.actionStatus('Item added.');
        WL.render();
      });
    }

    function paintItems(release) {
      const host = document.getElementById('items');
      const canOpen = isCaseLead && fullScope && !breakGlass && release.state === 'submitted';
      host.innerHTML = '<table aria-label="Release items"><thead><tr><th>Item</th><th>Derivative</th><th>Bytes</th><th></th></tr></thead><tbody>' +
        release.items.map((it) => {
          const sup = it.superseded ? '<span class="mono">◇ Superseded</span>' : '';
          const opened = it.opened_by_caller ? '<span class="verified-col mono">✓ Opened</span>' : '';
          const openBtn = canOpen && !it.opened_by_caller ?
            `<button class="ghost" data-open="${it.id}" data-dv="${it.derivative_id}">Open ${WL.escapeHtml(it.label)}</button>` : '';
          const rm = release.state === 'assembling' ?
            `<button class="ghost" data-remove="${it.id}">Remove ${WL.escapeHtml(it.label)}</button>` : '';
          return `<tr data-item="${it.id}"><td>${WL.escapeHtml(it.label)}</td><td class="mono">${it.derivative_id}</td>` +
            `<td class="mono">${it.size}</td><td>${openBtn} ${rm} ${opened} ${sup}</td></tr>`;
        }).join('') + '</tbody></table>';
      host.querySelectorAll('[data-remove]').forEach((b) =>
        b.addEventListener('click', async () => {
          WL.actionStatus('Saving item.');
          const r = await WL.api('DELETE', `/api/releases/${encodeURIComponent(rid)}/items/${encodeURIComponent(b.dataset.remove)}`);
          if (!r.ok) { WL.actionStatus('This action is no longer available.', 'vermilion'); return; }
          WL.actionStatus('Item removed.');
          WL.render();
        }));
      host.querySelectorAll('[data-open]').forEach((b) =>
        b.addEventListener('click', async () => {
          WL.actionStatus('Preparing download.');
          const grant = await WL.api('POST', `/api/derivatives/${encodeURIComponent(b.dataset.dv)}/download-grants`, {});
          if (!grant.ok) { WL.actionStatus('Download unavailable. Exhibit storage is unreachable. Your grant is still unused.', 'vermilion'); return; }
          location.href = `/api/download/${grant.data.token}`;
          WL.actionStatus('Download started.');
          // poll for the Opened mark
          const deadline = Date.now() + 5000;
          const poll = setInterval(async () => {
            const fresh = await WL.api('GET', '/api/releases/' + encodeURIComponent(rid), undefined, { background: true });
            if (fresh.ok) {
              const item = fresh.data.items.find((i) => i.id === b.dataset.open);
              if (item && item.opened_by_caller) {
                clearInterval(poll);
                WL.render();
              }
            }
            if (Date.now() > deadline) clearInterval(poll);
          }, 1000);
        }));
    }
    paintItems(rel);

    // decision buttons
    const buttons = document.getElementById('decision-buttons');
    const roles = {
      submit: ['investigator', 'case_lead'],
      signOff: ['case_lead'],
      reject: ['case_lead'],
      reopen: ['investigator', 'case_lead'],
      share: ['case_lead'],
      withdraw: ['case_lead'],
    };
    if (rel.state === 'assembling' && roles.submit.includes(WL.state.user.role)) {
      addButton('submit', 'Submit release');
    }
    if (rel.state === 'submitted' && isCaseLead && fullScope && !breakGlass && !isContributor) {
      addButton('sign-off', 'Sign off');
      addButton('reject', 'Reject');
    }
    if (rel.state === 'rejected' && rel.assembler_id === WL.state.user.id) {
      addButton('reopen', 'Reopen');
    }
    if (rel.state === 'signed off' && isCaseLead && fullScope && !breakGlass) {
      addButton('share', 'Share');
    }
    if (rel.state === 'shared' && isCaseLead && fullScope && !breakGlass) {
      addButton('link-revoke', 'Revoke link');
      addButton('link-regenerate', 'Regenerate link');
      addButton('withdraw', 'Withdraw');
    }

    function addButton(kind, label) {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = 'ghost';
      b.addEventListener('click', () => action(kind));
      buttons.appendChild(b);
    }

    async function action(kind) {
      if (kind === 'submit') {
        WL.stepUp({
          reason: false,
          onConfirm: async (proof, dlg) => {
            WL.actionStatus('Submitting.');
            const res = await WL.api('POST', `/api/releases/${encodeURIComponent(rid)}/submit`, {},
              { headers: { 'X-Step-Up-Proof': proof } });
            WL.dialog.close(dlg, 'ok');
            if (!res.ok) return releaseError(res);
            WL.actionStatus(`Submitted ${rid}.`);
            WL.render();
          },
        });
      } else if (kind === 'sign-off') {
        const manifest = inspectorEl.querySelector('[data-manifest-digest]').textContent;
        WL.stepUp({
          reason: false,
          onConfirm: async (proof, dlg) => {
            WL.actionStatus('Signing off.');
            const res = await WL.api('POST', `/api/releases/${encodeURIComponent(rid)}/sign-off`, {
              manifest_digest: manifest,
            }, { headers: { 'X-Step-Up-Proof': proof } });
            WL.dialog.close(dlg, 'ok');
            if (!res.ok) return releaseError(res);
            let msg = `Signed off ${rid}. Assembler notice queued.`;
            if (res.data.notice === 'held') msg = `Signed off ${rid}. ` + WL.copy.noticeHeld;
            WL.actionStatus(msg);
            WL.go('/releases/' + encodeURIComponent(rid));
            WL.render();
          },
        });
      } else if (kind === 'reject') {
        WL.stepUp({
          reason: true,
          reasonLabel: 'Reason',
          validateReason: (v) => v.trim().length < 10 ? 'Write a reason of at least 10 characters.' : null,
          onConfirm: async (proof, dlg, form) => {
            WL.actionStatus('Rejecting.');
            const res = await WL.api('POST', `/api/releases/${encodeURIComponent(rid)}/reject`, {
              reason: form.querySelector('textarea[name="reason"]').value,
            }, { headers: { 'X-Step-Up-Proof': proof } });
            WL.dialog.close(dlg, 'ok');
            if (!res.ok) return releaseError(res);
            let msg = `Rejected ${rid}. Assembler notice queued.`;
            if (res.data.notice === 'held') msg = `Rejected ${rid}. ` + WL.copy.noticeHeld;
            WL.actionStatus(msg);
            WL.render();
          },
        });
      } else if (kind === 'reopen') {
        const res = await WL.api('POST', `/api/releases/${encodeURIComponent(rid)}/reopen`, {});
        if (!res.ok) return releaseError(res);
        WL.actionStatus(`Reopened ${rid}.`);
        WL.render();
      } else if (kind === 'share' || kind === 'link-regenerate') {
        openLinkDialog(kind === 'share' ? 'share' : 'regenerate');
      } else if (kind === 'link-revoke') {
        WL.stepUp({
          reason: false,
          onConfirm: async (proof, dlg) => {
            WL.actionStatus('Updating link.');
            const res = await WL.api('POST', `/api/releases/${encodeURIComponent(rid)}/link/revoke`, {},
              { headers: { 'X-Step-Up-Proof': proof } });
            WL.dialog.close(dlg, 'ok');
            if (!res.ok) return releaseError(res);
            WL.actionStatus('Link revoked.');
            WL.render();
          },
        });
      } else if (kind === 'withdraw') {
        WL.stepUp({
          reason: false,
          onConfirm: async (proof, dlg) => {
            WL.actionStatus('Withdrawing.');
            const res = await WL.api('POST', `/api/releases/${encodeURIComponent(rid)}/withdraw`, {},
              { headers: { 'X-Step-Up-Proof': proof } });
            WL.dialog.close(dlg, 'ok');
            if (!res.ok) return releaseError(res);
            WL.actionStatus(`Withdrawn ${rid}.`);
            WL.render();
          },
        });
      }
    }

    function openLinkDialog(kind) {
      const dlg = WL.dialog.open({
        name: kind === 'share' ? 'Share release' : 'New link',
        build: (form) => {
          form.innerHTML = `
            <label class="field-label">Link lapses at</label>
            <input type="text" name="expires_at" aria-label="Link lapses at" placeholder="YYYY-MM-DD HH:MM UTC">
            <div class="field-error" data-for="expires_at"></div>
            <div class="actions-row"><button type="button" data-confirm>${kind === 'share' ? 'Share' : 'Regenerate'}</button></div>`;
          form.querySelector('[data-confirm]').addEventListener('click', () => {
            const expires = form.querySelector('input[name="expires_at"]').value.trim();
            WL.stepUp({
              reason: false,
              onConfirm: async (proof, stepDlg) => {
                WL.actionStatus(kind === 'share' ? 'Confirming derivatives.' : 'Updating link.');
                const res = await WL.api('POST',
                  kind === 'share' ? `/api/releases/${encodeURIComponent(rid)}/share` : `/api/releases/${encodeURIComponent(rid)}/link/regenerate`,
                  { expires_at: expires }, { headers: { 'X-Step-Up-Proof': proof } });
                WL.dialog.close(stepDlg, 'ok');
                if (!res.ok) {
                  const e = res.data && res.data.error;
                  if ((res.data.errors || {}).expires_at) {
                    form.querySelector('[data-for="expires_at"]').textContent = res.data.errors.expires_at;
                    return;
                  }
                  return releaseError(res);
                }
                WL.dialog.close(dlg, 'ok');
                if (kind === 'share') WL.actionStatus(`Shared ${rid}. Every derivative is confirmed present.`);
                else WL.actionStatus('New link ready. The old link no longer works.');
                const slot = document.getElementById('link-slot');
                const a = document.createElement('a');
                a.setAttribute('aria-label', 'Share link');
                a.href = res.data.url;
                a.textContent = location.origin + res.data.url;
                slot.innerHTML = '';
                slot.appendChild(a);
                WL.render();
              },
            });
          });
        },
      });
    }

    function releaseError(res) {
      const e = res.data && res.data.error;
      if (e === 'release_locked') WL.actionStatus('This action is no longer available.', 'vermilion');
      else if (e === 'illegal_transition') WL.actionStatus('Already decided by someone else.', 'vermilion');
      else if (e === 'release_empty') WL.actionStatus('This action is no longer available.', 'vermilion');
      else if (e === 'separation_of_duties') WL.actionStatus('You worked on this release, so someone else must decide it.', 'vermilion');
      else if (e === 'release_changed') WL.actionStatus('This release changed while you were reviewing it. Review it again.', 'vermilion');
      else if (e === 'derivative_superseded') WL.actionStatus(`A newer set of marks exists for ${res.data.derivative_id}. Render again and replace it.`, 'vermilion');
      else if (e === 'items_unopened') WL.actionStatus(`Open every item before signing off. Not opened yet: ${res.data.item_ids.length}.`, 'vermilion');
      else if (e === 'derivative_missing') WL.actionStatus('This action is no longer available.', 'vermilion');
      else if (e === 'storage_unavailable') WL.actionStatus('Not shared. Exhibit storage is unreachable, so the derivatives could not be confirmed.', 'vermilion');
      else WL.actionStatus('This action is no longer available.', 'vermilion');
      if (e === 'derivative_superseded' || e === 'release_changed' || e === 'items_unopened') WL.render();
    }

    // live refresh (DP-27)
    clearInterval(WL.state.releaseTimer);
    WL.state.releaseTimer = setInterval(async () => {
      const c = await WL.api('GET', '/api/compartments/' + encodeURIComponent(rel.compartment_id), undefined, { background: true });
      if (c.status === 404) { WL.showAccessEnded(); return; }
      const fresh = await WL.api('GET', '/api/releases/' + encodeURIComponent(rid), undefined, { background: true });
      if (fresh.ok) {
        const stateEl = inspectorEl.querySelector('[aria-label="Release state"]');
        if (stateEl) stateEl.textContent = WL.stateWords[fresh.data.state];
        const mdEl = inspectorEl.querySelector('[data-manifest-digest]');
        if (mdEl) mdEl.textContent = fresh.data.manifest_digest;
        paintItems(fresh.data);
      }
    }, 5000);
  };
})();
