/* Custody surfaces: table check in the browser, scrubbed timeline (DP-93 to DP-96). */
(function () {
  // table + status only (auditor review)
  WL.renderCustodyTable = async function (host, eid) {
    host.innerHTML = `
      <div role="status" aria-label="Custody status" id="custody-status">Checking custody.</div>
      <table aria-label="Custody history" id="custody-table"></table>`;
    await paintCustody(host, eid, false);
  };

  WL.renderCustodySurfaces = async function (host, eid) {
    host.innerHTML = `
      <div role="region" aria-label="Custody timeline" id="custody-timeline"
           data-scrub-progress="0" data-scrub-position="1" data-scrub-total="1" data-scrub-state="settled">
        <div class="scrub-track" data-scrub-track><div class="scrub-fill" data-scrub-fill style="width:0"></div></div>
        <div class="custody-scroller" data-custody-scroller id="custody-scroller" tabindex="0"></div>
        <label class="field-label">Custody scrub</label>
        <input type="range" id="custody-slider" aria-label="Custody scrub" min="1" max="1" value="1" style="width:100%">
        <div class="actions-row">
          <button id="entry-details" class="ghost">Entry details</button>
        </div>
        <div role="status" aria-label="Custody timeline status"></div>
      </div>
      <div role="status" aria-label="Custody status">Checking custody.</div>
      <table aria-label="Custody history" id="custody-table"></table>`;
    await paintCustody(host, eid, true);
  };

  async function fetchAll(eid) {
    const entries = [];
    let after = 0;
    while (true) {
      const res = await WL.api('GET', `/api/exhibits/${encodeURIComponent(eid)}/custody?after=${after}&limit=1000`);
      if (!res.ok) return { error: res };
      entries.push(...res.data.entries);
      if (res.data.next_after === null || !res.data.entries.length) break;
      after = res.data.next_after;
    }
    return { entries: entries };
  }

  async function paintCustody(host, eid, withTimeline) {
    const table = host.querySelector('#custody-table');
    const status = host.querySelector('[aria-label="Custody status"]');
    const got = await fetchAll(eid);
    if (got.error) {
      status.textContent = got.error.status === 404 ? 'No exhibit with this id.' : 'This action is no longer available.';
      table.innerHTML = '';
      return;
    }
    const entries = got.entries;
    const verdicts = await verifyCustody(entries);
    let altered = 0;
    const rows = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const ok = verdicts[i];
      if (!ok) altered++;
      rows.push(`<tr data-seq="${e.seq}"><td class="mono">${e.seq}</td><td class="mono">${WL.escapeHtml(e.at)}</td>` +
        `<td class="mono">${WL.escapeHtml(e.actor_id)}</td><td class="mono">${WL.escapeHtml(e.action)}</td>` +
        `<td class="mono">${WL.escapeHtml(e.target)}</td>` +
        `<td>${ok ? '<span class="verified-col">✓ Verified</span>' : '<span class="vermilion-col">✕ Altered</span>'}</td></tr>`);
    }
    table.innerHTML = '<thead><tr><th>Seq</th><th>At</th><th>Actor</th><th>Action</th><th>Target</th><th>Verdict</th></tr></thead><tbody>' +
      rows.join('') + '</tbody>';
    status.textContent = altered === 0 ?
      `${entries.length} entries checked. All match their digests. Run Chain Walk to prove the whole chain.` :
      `Entry ${entries.find((e, i) => !verdicts[i]).seq} does not match its digest.`;

    if (withTimeline && entries.length) buildTimeline(host, entries, verdicts);
  }

  async function verifyCustody(entries) {
    if (!WL.hasCrypto) return entries.map(() => null);
    const verdicts = [];
    let prev = null;
    for (const e of entries) {
      const canonical = WL.entryCanonical(e);
      const computed = await WL.digestFor(e.prev_digest, canonical);
      verdicts.push(computed === e.digest);
    }
    return verdicts;
  }

  function buildTimeline(host, entries, verdicts) {
    const region = host.querySelector('#custody-timeline');
    const scroller = host.querySelector('[data-custody-scroller]');
    const track = host.querySelector('[data-scrub-track]');
    const fill = host.querySelector('[data-scrub-fill]');
    const slider = host.querySelector('#custody-slider');
    const statusEl = host.querySelector('[aria-label="Custody timeline status"]');
    const total = entries.length;

    region.dataset.scrubTotal = String(total);
    slider.max = String(total);
    slider.value = '1';

    scroller.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const stop = document.createElement('div');
      stop.className = 'scrub-stop';
      stop.dataset.custodyStop = String(entries[i].seq);
      stop.dataset.stopState = i === 0 ? 'current' : 'future';
      stop.style.height = '64px';
      stop.innerHTML = `<span class="scrub-dot"></span> <span class="mono">${entries[i].seq} · ${WL.escapeHtml(entries[i].action)}</span>` +
        (verdicts[i] === false ? ' <span class="vermilion-col">✕ Altered</span>' : '');
      scroller.appendChild(stop);
    }
    // scroll range: (total-1) * 64 px
    scroller.style.height = '320px';

    function updateFromScroll() {
      const range = (total - 1) * 64;
      const offset = Math.min(range, Math.max(0, scroller.scrollTop));
      const position = Math.round(offset / 64) + 1;
      const progress = range === 0 ? 1000 : Math.round((offset / range) * 1000);
      region.dataset.scrubPosition = String(position);
      region.dataset.scrubProgress = String(progress);
      region.dataset.scrubState = 'moving';
      fill.style.width = (progress / 10) + '%';
      slider.value = String(position);
      stops(position);
      clearTimeout(scrub._t);
      scrub._t = setTimeout(() => {
        region.dataset.scrubState = 'settled';
        announce(position);
      }, 250);
    }

    function stops(position) {
      scroller.querySelectorAll('.scrub-stop').forEach((el, i) => {
        const seq = Number(el.dataset.custodyStop);
        const idx = entries.findIndex((e) => e.seq === seq);
        el.dataset.stopState = idx + 1 < position ? 'past' : idx + 1 === position ? 'current' : 'future';
      });
    }

    function announce(position) {
      const text = position === 1 && total === 1 ? `Latest custody entry. Entry ${total} of ${total}.`
        : position === 1 ? `Start of custody. Entry 1 of ${total}.`
        : position === total ? `Latest custody entry. Entry ${total} of ${total}.`
        : `Entry ${position} of ${total}.`;
      statusEl.textContent = text;
    }

    scroller.addEventListener('scroll', updateFromScroll);
    slider.addEventListener('input', () => {
      scroller.scrollTop = (Number(slider.value) - 1) * 64;
    });
    slider.addEventListener('keydown', (e) => {
      let n = Number(slider.value);
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') n += 1;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') n -= 1;
      else if (e.key === 'PageUp') n += 10;
      else if (e.key === 'PageDown') n -= 10;
      else if (e.key === 'Home') n = 1;
      else if (e.key === 'End') n = total;
      else return;
      e.preventDefault();
      n = Math.max(1, Math.min(total, n));
      scroller.scrollTop = (n - 1) * 64;
    });
    region.addEventListener('keydown', (e) => {
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'n' || e.key === 'N') {
        scroller.scrollTop = Math.min((total - 1) * 64, scroller.scrollTop + 64);
      } else if (e.key === 'p' || e.key === 'P') {
        scroller.scrollTop = Math.max(0, scroller.scrollTop - 64);
      }
    });

    document.getElementById('entry-details').addEventListener('click', () => {
      const position = Number(region.dataset.scrubPosition);
      const entry = entries[position - 1];
      if (!entry) return;
      const dlg = WL.dialog.open({
        name: 'Custody entry',
        build: (form) => {
          form.innerHTML = `<div class="kv-list">
            <div class="kv-row"><span class="kv-key">Seq</span><span class="kv-value">${entry.seq}</span></div>
            <div class="kv-row"><span class="kv-key">At</span><span class="kv-value">${WL.escapeHtml(entry.at)}</span></div>
            <div class="kv-row"><span class="kv-key">Actor</span><span class="kv-value">${WL.escapeHtml(entry.actor_id)}</span></div>
            <div class="kv-row"><span class="kv-key">Action</span><span class="kv-value">${WL.escapeHtml(entry.action)}</span></div>
            <div class="kv-row"><span class="kv-key">Target</span><span class="kv-value">${WL.escapeHtml(entry.target)}</span></div>
          </div>
          <div class="actions-row"><button type="button" data-close>Close entry</button></div>`;
          form.querySelector('[data-close]').addEventListener('click', () => WL.dialog.close(dlg, 'cancel'));
        },
      });
    });

    announce(1);
  }
})();
