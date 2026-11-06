/* The main app: routing, docket panes, live checks (DP-02, DP-27, DP-28). */
(function () {
  const docketEl = document.getElementById('pane-docket');
  const inspectorEl = document.getElementById('pane-inspector');
  const navEl = document.getElementById('pane-nav');
  const drawerNav = document.getElementById('drawer-nav');
  const drawer = document.getElementById('drawer');
  const drawerButton = document.getElementById('drawer-button');

  WL.rendered = { statusRegions: {} };

  // ---------- viewport panes ----------
  function applyViewport() {
    const w = window.innerWidth;
    const r = WL.parseRoute(WL.route());
    const inspectorRoutes = (r.top === 'exhibits' || r.top === 'releases');
    if (w >= 1200) {
      navEl.style.display = 'block';
      drawer.classList.remove('open');
      drawer.dataset.inert = 'true';
      drawerButton.hidden = true;
      docketEl.classList.remove('mobile-hidden');
      inspectorEl.classList.remove('mobile-hidden');
      docketEl.style.display = '';
      inspectorEl.style.display = '';
    } else if (w >= 768) {
      navEl.style.display = 'none';
      drawerButton.hidden = false;
      docketEl.classList.remove('mobile-hidden');
      inspectorEl.classList.remove('mobile-hidden');
      docketEl.style.display = '';
      inspectorEl.style.display = '';
    } else {
      navEl.style.display = 'none';
      drawerButton.hidden = false;
      if (inspectorRoutes) {
        docketEl.classList.add('mobile-hidden');
        inspectorEl.classList.remove('mobile-hidden');
      } else {
        inspectorEl.classList.add('mobile-hidden');
        docketEl.classList.remove('mobile-hidden');
      }
    }
  }

  // ---------- drawer ----------
  function openDrawer() {
    drawer.classList.add('open');
    drawer.dataset.inert = 'false';
    drawerButton.setAttribute('aria-expanded', 'true');
    const first = drawerNav.querySelector('a');
    if (first) first.focus();
  }
  function closeDrawer() {
    drawer.classList.remove('open');
    drawer.dataset.inert = 'true';
    drawerButton.setAttribute('aria-expanded', 'false');
  }
  drawerButton.addEventListener('click', openDrawer);
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  drawer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeDrawer(); drawerButton.focus(); }
  });
  document.getElementById('sign-out').addEventListener('click', WL.signOut);

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const before = WL.state.lastWidth || w;
    if ((before < 1200 && w >= 1200) || (before >= 768 && w < 768) ||
        (before < 768 && w >= 768) || (before >= 1200 && w < 1200)) {
      applyViewport();
      if (w >= 1200) closeDrawer();
    }
    WL.state.lastWidth = w;
  });

  // ---------- navigation render ----------
  async function renderNav() {
    const res = await WL.api('GET', '/api/compartments', undefined, { background: true });
    const html = [];
    if (res.ok) {
      const current = WL.parseRoute(WL.route());
      html.push('<ul>');
      for (const c of res.data.compartments) {
        const active = current.id === c.id ? ' style="font-weight:700"' : '';
        html.push(`<li><a href="/compartments/${c.id}"${active}>${escapeHtml(c.name)}</a></li>`);
      }
      html.push('</ul>');
    }
    navEl.innerHTML = html.join('');
    drawerNav.innerHTML = html.join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  WL.escapeHtml = escapeHtml;

  function statusRegion(name) {
    return `<div role="status" aria-label="${escapeHtml(name)}" data-region="${escapeHtml(name)}"></div>`;
  }
  WL.statusRegion = statusRegion;

  function figure(figureText, labelText, extraAttrs) {
    return `<div class="figure-block"><div data-figure ${extraAttrs || ''}>${escapeHtml(figureText)}</div>` +
      `<span data-figure-label>${escapeHtml(labelText)}</span></div>`;
  }
  WL.figure = figure;

  // ---------- router ----------
  const ROUTES = {
    compartments: renderCompartments,
    exhibits: renderExhibit,
    releases: renderRelease,
    reviews: renderReviews,
    intake: renderIntake,
    ledger: renderLedger,
    audit: renderAuditChain,
  };

  async function render() {
    const path = WL.route();
    const r = WL.parseRoute(path);
    document.getElementById('who').textContent = WL.state.user ? WL.state.user.name : '';
    applyViewport();
    if (WL.state.user.role === 'auditor' && (path === '/ledger' || path === '/ledger/review' || path === '/audit/chain')) {
      // auditor routes
    } else if (WL.state.user.role !== 'auditor' && (path === '/ledger' || path === '/ledger/review' || path === '/audit/chain')) {
      return renderNotFound();
    }
    if (r.top === 'compartments') {
      if (r.id) return renderCompartmentDocket(r.id);
      return renderCompartments();
    }
    if (ROUTES[r.top]) return ROUTES[r.top](r);
    return renderNotFound();
  }
  WL.renderer = render;

  function renderNotFound() {
    document.title = 'Not found — Wardline';
    docketEl.innerHTML = `<div class="figure-block"><div data-figure>404</div>` +
      `<span data-figure-label>Address</span></div>` +
      `<h2 style="font-family:var(--sans);font-weight:600">Nothing to show at this address.</h2>`;
    inspectorEl.innerHTML = '';
    navEl.innerHTML = '';
    applyViewport();
  }

  window.addEventListener('popstate', render);

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('/') || href.startsWith('/static') ||
        (WL.state.user && WL.state.user.role !== 'auditor' &&
         (href === '/ledger' || href === '/ledger/review' || href === '/audit/chain'))) {
      return;
    }
    if (href.startsWith('/l/')) return;
    if (a.dataset.top) return;
    e.preventDefault();
    history.pushState({}, '', href);
    render();
  });

  // ---------- screens ----------
  async function renderCompartments() {
    document.title = 'Compartments — Wardline';
    const dash = await WL.api('GET', '/api/dashboard');
    const totals = dash.ok ? dash.data : { exhibits: 0, quarantined: 0, held: 0, releases_in_review: 0, release_bytes: 0 };
    docketEl.innerHTML =
      figure(totals.exhibits, 'Total exhibits') +
      `<div class="section-heading">Totals</div>
       <div role="region" aria-label="Totals" class="mono">Exhibits ${totals.exhibits} · Quarantined ${totals.quarantined} · Held ${totals.held} · In review ${totals.releases_in_review} · Release bytes ${totals.release_bytes}</div>
       <div class="section-heading">Search exhibits</div>
       <input type="search" aria-label="Search exhibits" id="search-box">
       <ul id="search-results" aria-label="Search results" role="list"></ul>` +
      (WL.state.user.role === 'case_lead'
        ? `<div class="section-heading">Compartments</div><div class="actions-row"><button id="new-comp">New compartment</button></div>` +
          `<div class="section-heading">Break-glass</div>
           <label class="field-label">Compartment reference</label><input type="text" aria-label="Compartment reference" id="bg-ref">
           <label class="field-label">Break-glass reason</label><textarea aria-label="Break-glass reason" id="bg-reason"></textarea>
           <div class="actions-row"><button id="bg-open">Open break-glass</button></div>`
        : '') +
      `<div class="section-heading">Your compartments</div><div id="comp-list"></div>`;
    inspectorEl.innerHTML = `<p>${WL.copy.noRecord}</p>`;
    applyViewport();

    // search as you type
    const box = document.getElementById('search-box');
    let t = null;
    box.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const res = await WL.api('GET', '/api/search?q=' + encodeURIComponent(box.value));
        const ul = document.getElementById('search-results');
        if (res.ok) {
          ul.innerHTML = res.data.results.map((r) =>
            `<li><a href="/exhibits/${r.exhibit_id}">${escapeHtml(r.exhibit_id)} — ${escapeHtml(r.name)}</a> <span class="mono">${escapeHtml(r.state)}</span></li>`
          ).join('');
        } else {
          ul.innerHTML = '';
        }
      }, 300);
    });

    const listRes = await WL.api('GET', '/api/compartments');
    if (listRes.ok) {
      document.getElementById('comp-list').innerHTML =
        '<table aria-label="Compartments"><thead><tr><th>Reference</th><th>Name</th><th>Exhibits</th><th>Quarantined</th></tr></thead><tbody>' +
        listRes.data.compartments.map((c) =>
          `<tr><td class="mono"><a href="/compartments/${c.id}">${c.id}</a></td><td>${escapeHtml(c.name)}</td>` +
          `<td class="mono">${c.exhibit_count}</td><td class="mono">${c.quarantine_count}</td></tr>`
        ).join('') + '</tbody></table>';
    }

    if (WL.state.user.role === 'case_lead') {
      document.getElementById('new-comp').addEventListener('click', () => {
        const dlg = WL.dialog.open({
          name: 'New compartment',
          build: (form) => {
            form.innerHTML = `
              <label class="field-label">Compartment name</label>
              <input type="text" aria-label="Compartment name" name="name">
              <div class="field-error" data-for="name"></div>
              <div class="actions-row"><button type="button" data-confirm>Create compartment</button></div>`;
            form.querySelector('[data-confirm]').addEventListener('click', async () => {
              const name = form.querySelector('input[name="name"]').value;
              const res = await WL.api('POST', '/api/compartments', { name });
              if (!res.ok) {
                form.querySelector('[data-for="name"]').textContent = (res.data.errors || {}).name || '';
                return;
              }
              WL.actionStatus('Compartment created.');
              WL.dialog.close(dlg, 'ok');
              WL.go('/compartments/' + res.data.id);
            });
          },
        });
      });

      document.getElementById('bg-open').addEventListener('click', () => {
        const ref = document.getElementById('bg-ref').value.trim();
        const reason = document.getElementById('bg-reason').value;
        if (!ref) { WL.actionStatus('Enter a compartment reference.', 'vermilion'); return; }
        WL.stepUp({
          reason: true,
          reasonLabel: 'Reason',
          reasonValue: reason,
          validateReason: (v) => v.trim().length < 20 ? 'Write a reason of at least 20 characters.' : null,
          onConfirm: async (proof, dlg) => {
            const res = await WL.api('POST', `/api/compartments/${encodeURIComponent(ref)}/break-glass`,
              { reason: reason },
              { headers: { 'X-Step-Up-Proof': proof, 'Idempotency-Key': WL.state.bgKey || WL.newKey() } });
            WL.state.bgKey = null;
            if (res.status === 404) { WL.actionStatus('No compartment with this reference.', 'vermilion'); WL.dialog.close(dlg, 'cancel'); return; }
            if (!res.ok) {
              const e = res.data.error;
              if (e === 'already_granted') WL.actionStatus('You already hold access to this compartment.', 'vermilion');
              else if (e === 'break_glass_active') WL.actionStatus('Break-glass is already open on this compartment.', 'vermilion');
              else WL.actionStatus(WL.copy.wrongStepUp, 'vermilion');
              return;
            }
            WL.dialog.close(dlg, 'ok');
            const body = res.data;
            let msg = `Break-glass open until ${body.ends_at.slice(11, 16)} UTC. Owner notice queued.`;
            if (body.notice === 'held') {
              msg = `Break-glass open until ${body.ends_at.slice(11, 16)} UTC. ` + WL.copy.noticeHeld;
            }
            WL.actionStatus(msg);
            WL.go('/compartments/' + encodeURIComponent(ref));
          },
        });
        WL.state.bgKey = WL.newKey();
      });
    }
    renderNav();
  }

  WL.newKey = function () {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  // ---- compartment docket ----
  async function renderCompartmentDocket(cid) {
    const res = await WL.api('GET', '/api/compartments/' + encodeURIComponent(cid));
    if (!res.ok) return renderNotFound();
    const c = res.data;
    document.title = c.name + ' — Wardline';
    const isLead = WL.state.user.role === 'case_lead' && c.caller_scope === 'full';

    const exhibitsRes = await WL.api('GET', `/api/compartments/${encodeURIComponent(cid)}/exhibits`, undefined, { background: true });
    const releasesRes = await WL.api('GET', `/api/compartments/${encodeURIComponent(cid)}/releases`, undefined, { background: true });

    docketEl.innerHTML =
      figure(c.exhibit_count, 'Exhibits') +
      statusRegion('Compartment totals') +
      `<div class="section-heading">Exhibits</div><div id="exhibits-table"></div>` +
      (isLead ? `<div class="section-heading">Access list</div><div id="access-list"></div>
                 <div class="actions-row"><button id="issue-grant">Issue grant</button></div>` : '') +
      `<div class="section-heading">Releases</div><div id="releases-table"></div>
       <div class="actions-row"><button id="new-release">New release</button></div>`;

    const totalsEl = docketEl.querySelector('[data-region="Compartment totals"]');
    totalsEl.dataset.quarantineCount = c.quarantine_count;
    totalsEl.dataset.releaseBytes = c.release_bytes;
    totalsEl.textContent = `${c.quarantine_count} in quarantine. ${c.release_bytes} bytes in releases.`;

    paintExhibits(cid, exhibitsRes.ok ? exhibitsRes.data.exhibits : []);
    paintReleases(cid, releasesRes.ok ? releasesRes.data.releases : []);
    if (isLead && c.access) paintAccessList(cid, c);

    inspectorEl.innerHTML = `<p>${WL.copy.noRecord}</p>`;
    applyViewport();

    if (isLead) {
      document.getElementById('issue-grant').addEventListener('click', () => openGrantDialog(cid, null));
    }
    document.getElementById('new-release').addEventListener('click', () => openNewReleaseDialog(cid));

    // live refresh of the docket (DP-27)
    clearInterval(WL.state.docketTimer);
    WL.state.docketTimer = setInterval(async () => {
      const fresh = await WL.api('GET', '/api/compartments/' + encodeURIComponent(cid), undefined, { background: true });
      if (!fresh.ok) {
        if (fresh.status === 404) showAccessEnded();
        return;
      }
      const cc = fresh.data;
      totalsEl.dataset.quarantineCount = cc.quarantine_count;
      totalsEl.dataset.releaseBytes = cc.release_bytes;
      totalsEl.textContent = `${cc.quarantine_count} in quarantine. ${cc.release_bytes} bytes in releases.`;
      const ex = await WL.api('GET', `/api/compartments/${encodeURIComponent(cid)}/exhibits`, undefined, { background: true });
      if (ex.ok) paintExhibits(cid, ex.data.exhibits);
      const rel = await WL.api('GET', `/api/compartments/${encodeURIComponent(cid)}/releases`, undefined, { background: true });
      if (rel.ok) paintReleases(cid, rel.data.releases);
      if (isLead && cc.access) paintAccessList(cid, cc);
    }, 5000);

    renderNav();
  }

  function paintExhibits(cid, exhibits) {
    const host = document.getElementById('exhibits-table');
    if (!host) return;
    host.innerHTML = '<table aria-label="Exhibits"><thead><tr><th>Reference</th><th>Name</th><th>State</th><th>Held</th></tr></thead><tbody>' +
      exhibits.map((e) => {
        const held = (e.holds || []).length ? `<span class="held-marker" data-held-marker>● Held</span>` : '';
        return `<tr data-exhibit="${e.id}"><td class="mono"><a href="/exhibits/${e.id}">${e.id}</a></td>` +
          `<td>${escapeHtml(e.name)}</td><td class="mono">${escapeHtml(e.state)}</td><td>${held}</td></tr>`;
      }).join('') + '</tbody></table>';
  }

  function paintReleases(cid, releases) {
    const host = document.getElementById('releases-table');
    if (!host) return;
    host.innerHTML = '<table aria-label="Releases"><thead><tr><th>Reference</th><th>Name</th><th>State</th></tr></thead><tbody>' +
      releases.map((r) =>
        `<tr><td class="mono"><a href="/releases/${r.id}">${r.id}</a></td><td>${escapeHtml(r.name)}</td>` +
        `<td class="mono">${escapeHtml(r.state)}</td></tr>`
      ).join('') + '</tbody></table>';
  }

  function paintAccessList(cid, compartment) {
    const host = document.getElementById('access-list');
    if (!host) return;
    const rows = compartment.access.map((g) => {
      const lapse = g.expires_at ?
        `Lapses ${g.expires_at.slice(0, 16).replace('T', ' ')} UTC` : 'Does not lapse';
      const name = WL.personName ? WL.personName(g.user_id) : g.user_id;
      const actions = (g.kind === 'grant' && g.state === 'active')
        ? `<button class="ghost" data-edit="${g.id}">Edit grant for ${escapeHtml(name)}</button>
           <button class="ghost" data-revoke="${g.id}">Revoke grant for ${escapeHtml(name)}</button>
           <button class="ghost" data-endsessions="${g.user_id}">End sessions for ${escapeHtml(name)}</button>`
        : '';
      return `<tr data-grant="${g.id}"><td class="mono">${escapeHtml(name)}</td><td class="mono">${escapeHtml(g.scope)}</td>` +
        `<td class="mono">${escapeHtml(g.state)}</td><td class="mono">${escapeHtml(lapse)}</td><td>${actions}</td></tr>`;
    }).join('');
    host.innerHTML = '<table aria-label="Access list"><thead><tr><th>Person</th><th>Scope</th><th>State</th><th>Lapse</th><th></th></tr></thead><tbody>' +
      rows + '</tbody></table>';
    host.querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => {
        const g = compartment.access.find((x) => x.id === b.dataset.edit);
        openGrantDialog(cid, g);
      }));
    host.querySelectorAll('[data-revoke]').forEach((b) =>
      b.addEventListener('click', () => {
        const opener = b;
        WL.stepUp({
          reason: false,
          onConfirm: async (proof, dlg) => {
            const res = await WL.api('POST', `/api/grants/${b.dataset.revoke}/revoke`, {},
              { headers: { 'X-Step-Up-Proof': proof } });
            WL.dialog.close(dlg, 'ok');
            if (!res.ok) return handleGrantError(res);
            WL.actionStatus('Grant revoked.');
            WL.render();
          },
          onClose: () => { if (opener && document.contains(opener)) opener.focus(); },
        });
      }));
    host.querySelectorAll('[data-endsessions]').forEach((b) =>
      b.addEventListener('click', () => {
        WL.stepUp({
          reason: false,
          onConfirm: async (proof, dlg) => {
            const res = await WL.api('POST', `/api/users/${b.dataset.endsessions}/sessions/revoke`, {},
              { headers: { 'X-Step-Up-Proof': proof } });
            WL.dialog.close(dlg, 'ok');
            if (!res.ok) {
              WL.actionStatus(res.status === 403 ? 'This action is no longer available.' : 'This action is no longer available.', 'vermilion');
              return;
            }
            WL.actionStatus('Sessions ended.');
          },
        });
      }));
  }

  function handleGrantError(res) {
    const e = res.data && res.data.error;
    if (e === 'stale_access_list') {
      WL.actionStatus('Someone else changed this access list. Review it and try again.', 'vermilion');
      WL.state.accessVersion = res.data.access_version;
      return true;
    }
    if (e === 'last_case_lead') {
      WL.actionStatus('This compartment needs another case lead with full access first.', 'vermilion');
      return true;
    }
    if (e === 'grant_not_active') {
      WL.actionStatus('This action is no longer available.', 'vermilion');
      return true;
    }
    WL.actionStatus('This action is no longer available.', 'vermilion');
    return true;
  }

  function openGrantDialog(cid, existing) {
    const dlg = WL.dialog.open({
      name: existing ? 'Edit grant' : 'Issue grant',
      build: (form) => {
        form.innerHTML = `
          ${existing ? '' : '<label class="field-label">Person</label><select name="person" aria-label="Person"></select>'}
          <label class="field-label">Scope</label>
          <select name="scope" aria-label="Scope">
            <option value="full">Full</option><option value="derivatives">Derivatives only</option>
          </select>
          <label class="field-label">Lapses at</label>
          <input type="text" name="expires_at" aria-label="Lapses at" placeholder="YYYY-MM-DD HH:MM UTC">
          <div class="field-error" data-for="expires_at"></div>
          <div class="actions-row"><button type="button" data-confirm>Save grant</button></div>`;
        if (!existing) {
          const sel = form.querySelector('select[name="person"]');
          WL.api('GET', '/api/directory').then((r) => {
            if (r.ok) {
              for (const p of r.data.people) {
                const o = document.createElement('option');
                o.value = p.id; o.textContent = p.name;
                sel.appendChild(o);
              }
            }
          });
          sel.value = '';
        } else {
          form.querySelector('select[name="scope"]').value = existing.scope;
          form.querySelector('input[name="expires_at"]').value = existing.expires_at || '';
        }
        form.querySelector('[data-confirm]').addEventListener('click', async () => {
          const scope = form.querySelector('select[name="scope"]').value;
          const expires = form.querySelector('input[name="expires_at"]').value.trim();
          const version = WL.state.accessVersion !== undefined ? WL.state.accessVersion :
            (WL.state.currentAccessVersion || 0);
          const body = { scope: scope, expires_at: expires === '' ? null : expires, access_version: version };
          WL.stepUp({
            reason: false,
            onConfirm: async (proof, stepDlg) => {
              const headers = { 'X-Step-Up-Proof': proof };
              const res = existing
                ? await WL.api('PATCH', `/api/grants/${existing.id}`, body, { headers })
                : await WL.api('POST', `/api/compartments/${encodeURIComponent(cid)}/grants`,
                    Object.assign({ user_id: form.querySelector('select[name="person"]').value }, body), { headers });
              if (!res.ok) {
                const e = res.data && res.data.error;
                if (e === 'stale_access_list') {
                  WL.state.accessVersion = res.data.access_version;
                  WL.actionStatus('Someone else changed this access list. Review it and try again.', 'vermilion');
                  WL.dialog.close(stepDlg, 'stay');
                  if (stepDlg) stepDlg.remove();
                  const saveBtn = dlg.querySelector('[data-confirm]');
                  if (saveBtn) saveBtn.focus();
                  return;
                }
                handleGrantError(res);
                WL.dialog.close(stepDlg, 'cancel');
                return;
              }
              WL.state.accessVersion = undefined;
              WL.dialog.close(stepDlg, 'ok');
              WL.dialog.close(dlg, 'ok');
              WL.actionStatus('Grant saved.');
              WL.render();
            },
          });
        });
      },
    });
  }

  function openNewReleaseDialog(cid) {
    const dlg = WL.dialog.open({
      name: 'New release',
      build: (form) => {
        form.innerHTML = `
          <label class="field-label">Release name</label>
          <input type="text" name="name" aria-label="Release name">
          <label class="field-label">Matter reference</label>
          <input type="text" name="matter" aria-label="Matter reference">
          <label class="field-label">Recipient</label>
          <select name="recipient" aria-label="Recipient">
            <option value="counsel">Outside counsel</option><option value="requester">Requester</option>
          </select>
          <div class="field-error" data-for="matter"></div>
          <div class="actions-row"><button type="button" data-confirm>Create release</button></div>`;
        form.querySelector('[data-confirm]').addEventListener('click', async () => {
          const res = await WL.api('POST', `/api/compartments/${encodeURIComponent(cid)}/releases`, {
            name: form.querySelector('input[name="name"]').value,
            matter_ref: form.querySelector('input[name="matter"]').value,
            recipient_kind: form.querySelector('select[name="recipient"]').value,
          });
          if (!res.ok) {
            const errs = (res.data && res.data.errors) || {};
            form.querySelector('[data-for="matter"]').textContent = errs.matter_ref || errs.name || '';
            return;
          }
          WL.dialog.close(dlg, 'ok');
          WL.go('/releases/' + res.data.id);
        });
      },
    });
  }

  function showAccessEnded() {
    clearInterval(WL.state.docketTimer);
    WL.dialog.closeAll();
    docketEl.innerHTML = `<div role="alert" aria-label="Access ended" tabindex="-1" class="access-ended">${WL.copy.accessEnded}</div>`;
    inspectorEl.innerHTML = '';
    const el = docketEl.querySelector('[aria-label="Access ended"]');
    if (el) el.focus();
    renderNav();
  }
  WL.showAccessEnded = showAccessEnded;

  async function renderReviews() {
    if (WL.state.user.role !== 'case_lead') return renderNotFound();
    document.title = 'Review queue — Wardline';
    const res = await WL.api('GET', '/api/reviews');
    const releases = res.ok ? res.data.releases : [];
    docketEl.innerHTML =
      figure(releases.length, 'Waiting for a decision') +
      statusRegion('Review queue count') +
      `<div class="section-heading">Review queue</div><div id="queue-table"></div>`;
    inspectorEl.innerHTML = `<p>${WL.copy.noRecord}</p>`;
    WL.setStatus('Review queue count', `${releases.length} waiting for a decision.`);
    paintQueue(releases);
    applyViewport();
    clearInterval(WL.state.queueTimer);
    WL.state.queueTimer = setInterval(async () => {
      const fresh = await WL.api('GET', '/api/reviews', undefined, { background: true });
      if (fresh.ok) {
        WL.setStatus('Review queue count', `${fresh.data.releases.length} waiting for a decision.`);
        paintQueue(fresh.data.releases);
      }
    }, 5000);
    renderNav();
  }

  function paintQueue(releases) {
    const host = document.getElementById('queue-table');
    if (!host) return;
    const focused = document.activeElement;
    const focusedRow = focused && focused.closest('tr[data-release]');
    host.innerHTML = '<table aria-label="Review queue" tabindex="-1"><thead><tr><th>Release</th><th>Name</th><th>Matter</th></tr></thead><tbody>' +
      releases.map((r) =>
        `<tr data-release="${r.id}"><td class="mono"><a href="/releases/${r.id}">${r.id}</a></td>` +
        `<td>${escapeHtml(r.name)}</td><td class="mono">${escapeHtml(r.matter_ref)}</td></tr>`
      ).join('') + '</tbody></table>';
    if (focusedRow && !host.querySelector(`tr[data-release="${focusedRow.dataset.release}"]`)) {
      const rows = host.querySelectorAll('tr[data-release]');
      const next = host.querySelector(`tr[data-release="${focusedRow.dataset.release}"]`);
      if (!next) {
        // move focus to next row link, else last, else the table
        let target = null;
        for (const row of rows) {
          if (row.dataset.release > focusedRow.dataset.release) { target = row.querySelector('a'); break; }
        }
        if (!target && rows.length) target = rows[rows.length - 1].querySelector('a');
        if (target) target.focus(); else host.querySelector('table').focus();
      }
    }
  }

  async function renderLedger(r) {
    if (r.sub === 'review') return renderLedgerReview();
    if (WL.state.user.role !== 'auditor') return renderNotFound();
    await WL.renderChainWalk(docketEl, inspectorEl);
  }

  async function renderAuditChain() {
    if (WL.state.user.role !== 'auditor') return renderNotFound();
    await WL.renderLattice(docketEl, inspectorEl);
  }

  async function renderLedgerReview() {
    if (WL.state.user.role !== 'auditor') return renderNotFound();
    document.title = 'Auditor review — Wardline';
    const sig = await WL.api('GET', '/api/signals');
    const ledger = await WL.api('GET', '/api/ledger?limit=1000');
    const signals = sig.ok ? sig.data.signals : [];
    const entries = ledger.ok ? ledger.data.entries : [];
    const denials = entries.filter((e) => e.action === 'access.denied');
    const bgOpens = entries.filter((e) => e.action === 'break_glass.opened');
    const grantsIssued = entries.filter((e) => e.action === 'grant.issued');

    docketEl.innerHTML =
      figure(signals.length, 'Open signals') +
      `<div class="section-heading">Custody lookup</div>
       <label class="field-label">Exhibit id</label><input type="text" id="custody-id" aria-label="Exhibit id">
       <div class="actions-row"><button id="show-custody">Show custody</button></div>
       <div id="custody-host"></div>`;
    inspectorEl.innerHTML = `<p>${WL.copy.noRecord}</p>`;
    applyViewport();

    document.getElementById('show-custody').addEventListener('click', () => {
      const eid = document.getElementById('custody-id').value.trim();
      WL.renderCustodyTable(document.getElementById('custody-host'), eid);
    });
    renderNav();
  }

  // placeholder screens wired from their own modules
  async function renderExhibit(r) { await WL.renderExhibitScreen(r.id, docketEl, inspectorEl); }
  async function renderRelease(r) { await WL.renderReleaseScreen(r.id, docketEl, inspectorEl); }
  async function renderIntake() { await WL.renderIntakeScreen(docketEl, inspectorEl); }

  // ---------- boot ----------
  (async () => {
    const ok = await WL.loadSession();
    if (!ok) {
      location.href = '/sign-in?next=' + encodeURIComponent(WL.route());
      return;
    }
    if (WL.state.user.role === 'auditor' && ['/compartments', '/intake', '/reviews'].includes(WL.route())) {
      history.replaceState({}, '', '/ledger');
    }
    if (WL.state.user.role !== 'auditor' && ['/ledger', '/ledger/review', '/audit/chain'].includes(WL.route())) {
      history.replaceState({}, '', '/compartments');
    }
    await render();
    WL.startChecks();
    renderNav();
    WL.state.lastWidth = window.innerWidth;
  })();
})();
