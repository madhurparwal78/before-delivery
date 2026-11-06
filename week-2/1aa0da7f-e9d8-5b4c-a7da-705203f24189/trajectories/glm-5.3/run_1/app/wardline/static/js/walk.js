/* Chain Walk: browser-side verification of the single ledger chain (DP-82 to DP-92). */
(function () {
  WL.renderChainWalk = async function (docketEl, inspectorEl) {
    document.title = 'Chain Walk — Wardline';
    const countRes = await WL.api('GET', '/api/ledger?limit=1');
    const linkCount = countRes.ok ? countRes.data.count : 0;

    docketEl.innerHTML = `
      <div class="figure-block"><div data-figure id="verified-through">0</div><span data-figure-label>Verified through</span></div>
      <div role="region" aria-label="Chain Walk" id="walk-region" data-verified-through="0" data-link-state="idle">
        <a href="/audit/chain">Chain lattice</a>
        <div class="walk-layout">
          <div class="walk-rail-col">
            <div class="walk-rail" id="rail" style="height:600px;overflow-y:auto;touch-action:pan-y">
              <div id="rail-inner" style="position:relative;height:${linkCount * 72}px">
                <div id="rail-marks" style="position:absolute;inset:0"></div>
              </div>
            </div>
            <label class="field-label">Ledger walk</label>
            <input type="range" id="walk-slider" aria-label="Ledger walk" min="0" max="${linkCount}" value="0"
              style="width:100%">
          </div>
          <div class="digest-panel">
            <div class="digest-grid" id="digest-grid" data-digest-state="settled"></div>
            <div role="status" aria-label="Walk result" id="walk-result">Start of the chain.</div>
            <div class="section-heading">Anchor</div>
            <label class="field-label">Current anchor</label>
            <input type="text" id="current-anchor" aria-label="Current anchor" readonly style="width:100%">
            <div class="actions-row"><button id="copy-anchor" class="ghost" disabled>Copy anchor</button></div>
            <div role="status" aria-label="Anchor status" id="anchor-status"></div>
            <label class="field-label">Anchor to check</label>
            <input type="text" id="anchor-check" aria-label="Anchor to check">
            <div class="actions-row"><button id="check-anchor" class="ghost">Check anchor</button></div>
          </div>
        </div>
      </div>`;
    inspectorEl.innerHTML = '';

    const region = document.getElementById('walk-region');
    const grid = document.getElementById('digest-grid');
    const slider = document.getElementById('walk-slider');
    const resultEl = document.getElementById('walk-result');
    const railInner = document.getElementById('rail-inner');
    const railMarks = document.getElementById('rail-marks');
    const figureEl = document.getElementById('verified-through');

    const state = {
      head: 0,
      verifiedThrough: 0,
      entries: [],       // fetched rows by seq
      computed: {},      // seq -> computed digest
      breakAt: null,
      breakCells: null,
      remembered: WL.readRemembered(),
      lastBreak: null,
      count: linkCount,
      settling: null,
    };

    buildGrid('0'.repeat(64), null);
    function buildGrid(value, diffs) {
      grid.innerHTML = '';
      for (let i = 0; i < 64; i++) {
        const cell = document.createElement('div');
        cell.dataset.digestCell = String(i);
        cell.textContent = value ? value[i] : '-';
        if (diffs && diffs[i]) {
          cell.dataset.differs = 'true';
          if (diffs.first === i) cell.dataset.firstBreak = 'true';
        }
        grid.appendChild(cell);
      }
      grid.dataset.digestState = 'settled';
    }

    function paintCells(value, diffs) {
      const cells = grid.querySelectorAll('[data-digest-cell]');
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) {
        cells.forEach((c, i) => {
          c.textContent = value ? value[i] : '-';
          if (diffs && diffs[i]) c.dataset.differs = 'true'; else c.removeAttribute('data-differs');
          if (diffs && diffs.first === i) c.dataset.firstBreak = 'true'; else c.removeAttribute('data-first-break');
        });
        grid.dataset.digestState = 'settled';
        return;
      }
      grid.dataset.digestState = 'settling';
      const token = ++state.settleToken;
      cells.forEach((c) => { c.removeAttribute('data-differs'); c.removeAttribute('data-first-break'); });
      cells.forEach((c, i) => {
        setTimeout(() => {
          if (token !== state.settleToken) return;
          c.textContent = value ? value[i] : '-';
          if (diffs && diffs[i]) c.dataset.differs = 'true';
          if (diffs && diffs.first === i) c.dataset.firstBreak = 'true';
          if (i === 63) grid.dataset.digestState = 'settled';
        }, i * 7);
      });
    }
    state.settleToken = 0;

    async function ensureEntries(upTo) {
      // fetch pages until we hold seq upTo
      while (state.entries.length < upTo) {
        const after = state.entries.length ? state.entries[state.entries.length - 1].seq : 0;
        const res = await WL.api('GET', `/api/ledger?after=${after}&limit=1000`);
        if (!res.ok || !res.data.entries.length) break;
        state.entries.push(...res.data.entries);
        if (res.data.entries.length < 1000) break;
      }
    }

    function entryAt(seq) { return state.entries[seq - 1]; }

    async function verifyUpTo(n) {
      if (!WL.hasCrypto) return false;
      await ensureEntries(n);
      for (let seq = 1; seq <= n; seq++) {
        if (state.computed[seq]) continue;
        const e = entryAt(seq);
        if (!e) {
          // missing row: break at seq
          return applyBreak(seq, null, null);
        }
        const prevSeq = seq - 1;
        const gapOk = prevSeq === 0 || (entryAt(prevSeq) && e.seq === entryAt(prevSeq).seq + 1);
        if (prevSeq > 0 && (!entryAt(prevSeq) || e.seq !== entryAt(prevSeq).seq + 1)) {
          return applyBreak(prevSeq + 1, null, null);
        }
        const prevComputed = prevSeq === 0 ? WL.ZERO_DIGEST : state.computed[prevSeq];
        if (!prevComputed) return applyBreak(seq, null, null);
        const canonical = WL.entryCanonical(e);
        const computed = await WL.digestFor(prevComputed, canonical);
        state.computed[seq] = computed;
        if (e.digest !== computed) {
          return applyBreak(seq, computed, { value: computed, other: e.digest });
        }
        if (e.prev_digest !== prevComputed) {
          return applyBreak(seq, computed, { value: prevComputed, other: e.prev_digest });
        }
        const remembered = state.remembered[seq];
        if (remembered && remembered !== computed) {
          return applyBreak(seq, computed, { value: computed, other: remembered });
        }
      }
      // remembered link beyond the end
      const beyond = Object.keys(state.remembered).map(Number).filter((s) => s > state.count);
      if (beyond.length && n >= state.count) {
        const first = Math.min(...beyond);
        return applyBreak(first, null, null);
      }
      return false;
    }

    function applyBreak(seq, computed, diffInfo) {
      state.breakAt = seq;
      state.breakInfo = diffInfo;
      state.verifiedThrough = Math.max(0, seq - 1);
      return true;
    }

    function diffCells(diffInfo) {
      if (!diffInfo) return null;
      const a = diffInfo.value || '';
      const b = diffInfo.other || '';
      const diffs = {};
      let first = -1;
      for (let i = 0; i < 64; i++) {
        const ca = a[i] === undefined ? '-' : a[i];
        const cb = b[i] === undefined ? '-' : b[i];
        if (ca !== cb) { diffs[i] = true; if (first < 0) first = i; }
      }
      diffs.first = first;
      return diffs;
    }

    function paintRailMarks() {
      // at most 300 marks, always including the head's
      const marks = new Set();
      const head = state.head;
      marks.add(head);
      const from = Math.max(0, head - 150);
      for (let i = from; i <= Math.min(state.count, head + 150); i++) marks.add(i);
      railMarks.innerHTML = '';
      for (const n of Array.from(marks).sort((a, b) => a - b)) {
        const el = document.createElement('div');
        el.className = 'link-mark';
        el.dataset.linkMark = String(n);
        el.style.position = 'absolute';
        el.style.left = '0';
        el.style.top = (n * 72) + 'px';
        if (n === state.breakAt) el.innerHTML = '<span class="vermilion-col">✕ Break</span>';
        else if (n <= state.verifiedThrough && n > 0) el.innerHTML = '<span class="verified-col">✓ Verified</span>';
        railMarks.appendChild(el);
      }
    }

    async function moveTo(n, announce) {
      n = Math.max(0, Math.min(state.count, n));
      const broken = await verifyUpTo(n);
      state.head = n;
      slider.value = String(n);
      region.dataset.verifiedThrough = String(state.verifiedThrough);
      figureEl.textContent = String(state.verifiedThrough);
      if (n === 0) {
        region.dataset.linkState = 'idle';
        paintCells('0'.repeat(64), null);
        WL.setStatus('Walk result', 'Start of the chain.');
      } else if (state.breakAt !== null && n >= state.breakAt) {
        state.head = state.breakAt;
        slider.value = String(state.breakAt);
        region.dataset.linkState = 'broken';
        const computed = state.computed[state.breakAt];
        if (state.breakInfo) {
          paintCells(state.breakInfo.value, diffCells(state.breakInfo));
        } else {
          paintCells(null, null); // missing link: all '-'
        }
        WL.setStatus('Walk result', `Break at link ${state.breakAt}.`);
      } else {
        region.dataset.linkState = 'verified';
        const digest = state.computed[n];
        paintCells(digest, null);
        if (announce !== false) WL.setStatus('Walk result', `Link ${n} verified.`);
      }
      paintRailMarks();
      updateAnchor();
      scrollRailToHead();
    }

    function scrollRailToHead() {
      const rail = document.getElementById('rail');
      rail.scrollTop = state.head * 72;
    }

    function updateAnchor() {
      const field = document.getElementById('current-anchor');
      const btn = document.getElementById('copy-anchor');
      if (state.verifiedThrough > 0) {
        field.value = `wardline-anchor:v1:${state.verifiedThrough}:${state.computed[state.verifiedThrough]}`;
        btn.disabled = false;
      } else {
        field.value = '';
        btn.disabled = true;
      }
    }

    // controls
    let restTimer = null;
    function scheduleRestAnnounce(n) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      clearTimeout(restTimer);
      restTimer = setTimeout(() => {
        if (state.head === n) WL.setStatus('Walk result', state.breakAt !== null && n >= state.breakAt ?
          `Break at link ${state.breakAt}.` : `Link ${n} verified.`);
      }, 250);
    }

    slider.addEventListener('keydown', (e) => {
      let n = state.head;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') n += 1;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') n -= 1;
      else if (e.key === 'PageUp') n += 10;
      else if (e.key === 'PageDown') n -= 10;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = state.count;
      else return;
      e.preventDefault();
      moveTo(Math.max(0, n));
    });
    slider.addEventListener('input', () => moveTo(Number(slider.value)));

    document.getElementById('rail').addEventListener('scroll', () => {
      const rail = document.getElementById('rail');
      const n = Math.round(rail.scrollTop / 72);
      if (n !== state.head) {
        state.head = n;
        slider.value = String(n);
        scheduleRestAnnounce(n);
      }
    });

    // remember the highest verified link in this browser
    setInterval(() => {
      if (state.verifiedThrough > 0 && state.computed[state.verifiedThrough]) {
        WL.remember(state.verifiedThrough, state.computed[state.verifiedThrough]);
      }
    }, 4000);

    document.getElementById('copy-anchor').addEventListener('click', async () => {
      const value = document.getElementById('current-anchor').value;
      try {
        await navigator.clipboard.writeText(value);
        WL.setStatus('Anchor status', 'Anchor copied.');
      } catch (err) {
        document.getElementById('current-anchor').select();
        WL.setStatus('Anchor status', 'Anchor selected. Copy it now.');
      }
    });

    document.getElementById('check-anchor').addEventListener('click', async () => {
      const raw = document.getElementById('anchor-check').value.trim();
      const m = raw.match(/^wardline-anchor:v1:(\d+):([0-9a-f]{64})$/);
      if (!m || m[1].startsWith('0') || parseInt(m[1], 10) < 1) {
        WL.setStatus('Anchor status', 'This is not a Wardline anchor.');
        return;
      }
      const n = parseInt(m[1], 10);
      const digest = m[2];
      state.remembered[n] = digest;
      WL.remember(n, digest);
      if (n <= state.verifiedThrough) {
        if (state.computed[n] === digest) {
          WL.setStatus('Anchor status', `Anchor for link ${n} matches.`);
        } else {
          state.verifiedThrough = n - 1;
          region.dataset.verifiedThrough = String(n - 1);
          figureEl.textContent = String(n - 1);
          await moveTo(n);
          WL.setStatus('Anchor status', `Anchor for link ${n} does not match.`);
        }
      } else {
        WL.setStatus('Anchor status', `Anchor for link ${n} added. It will be tested when the walk reaches it.`);
        if (n > state.count) {
          // beyond the chain: test once the last link verifies
          await verifyUpTo(state.count);
          if (!state.breakAt && state.verifiedThrough >= state.count) {
            await moveTo(n);
          }
        }
      }
    });

    if (!WL.hasCrypto) {
      WL.setStatus('Walk result', WL.copy.noCrypto);
    }

    await moveTo(0, false);
  };

  WL.readRemembered = function () {
    try { return JSON.parse(localStorage.getItem('wardline-anchors') || '{}'); }
    catch (e) { return {}; }
  };
  WL.remember = function (n, digest) {
    try {
      const all = WL.readRemembered();
      if (!all[n] || n >= Math.max(...Object.keys(all).map(Number), 0)) {
        if (!all.high || n >= all.high) { all[n] = digest; all.high = Math.max(all.high || 0, n); }
      }
      localStorage.setItem('wardline-anchors', JSON.stringify(all));
    } catch (e) { /* private mode */ }
  };
})();
