/* Aldermoor Open Record — client enhancements.
   The core reading, filtering, search and application flows work without this
   file; the tether, live time conversion, motion and gallery playback are the
   enhancements layered on top. */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // ----------------------------------------------------------------- header nav
  var modelsButton = $('#models-menu');
  if (modelsButton) {
    var modelsList = $('#models-menu-list');
    modelsButton.addEventListener('click', function () {
      var open = modelsButton.getAttribute('aria-expanded') === 'true';
      modelsButton.setAttribute('aria-expanded', String(!open));
      if (modelsList) modelsList.hidden = open;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modelsButton.getAttribute('aria-expanded') === 'true') {
        modelsButton.setAttribute('aria-expanded', 'false');
        if (modelsList) modelsList.hidden = true;
        modelsButton.focus();
      }
    });
    // Populate the Models menu from the catalogue API.
    fetch('/api/public/models', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : { items: [] }; })
      .then(function (data) {
        if (!modelsList || !data.items) return;
        data.items.forEach(function (item) {
          var a = document.createElement('a');
          a.href = '/models/' + item.slug;
          a.textContent = item.title;
          modelsList.appendChild(a);
        });
      })
      .catch(function () { /* menu stays as-is */ });
  }

  var navToggle = $('#nav-toggle');
  if (navToggle) {
    var primaryNav = $('.primary-nav');
    navToggle.addEventListener('click', function () {
      var open = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!open));
      if (primaryNav) primaryNav.setAttribute('data-open', String(!open));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navToggle.getAttribute('aria-expanded') === 'true') {
        navToggle.setAttribute('aria-expanded', 'false');
        if (primaryNav) primaryNav.setAttribute('data-open', 'false');
        navToggle.focus();
      }
    });
  }

  // ------------------------------------------------------------------ reveals
  function revealOnScroll() {
    var targets = $$('[data-reveal="pending"]');
    if (targets.length === 0) return;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      targets.forEach(function (t) { t.setAttribute('data-reveal', 'done'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        io.unobserve(el);
        // 500-800ms, plays once per load.
        el.style.transitionDuration = '600ms';
        window.setTimeout(function () { el.setAttribute('data-reveal', 'done'); }, 620);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });
    targets.forEach(function (t) { io.observe(t); });
  }

  // ----------------------------------------------------- thesis progress line
  function thesisProgress() {
    var list = $('#theses');
    if (!list) return;
    var fill = $('#thesis-progress-fill');
    var theses = $$('.thesis', list);
    function update() {
      var viewportMiddle = window.innerHeight / 2;
      var first = theses[0].getBoundingClientRect();
      var last = theses[theses.length - 1].getBoundingClientRect();
      var start = first.top - viewportMiddle;
      var end = last.bottom - viewportMiddle;
      var fraction = start <= 0 && end >= 0 ? -start / (end - start) : start > 0 ? 0 : 1;
      fraction = Math.max(0, Math.min(1, fraction));
      list.setAttribute('data-thesis-progress', fraction.toFixed(2));
      if (fill) fill.style.height = (fraction * 100).toFixed(1) + '%';
      var current = null;
      theses.forEach(function (t) {
        var rect = t.getBoundingClientRect();
        t.removeAttribute('data-current');
        if (rect.top <= viewportMiddle && rect.bottom >= viewportMiddle) current = t;
      });
      if (current) current.setAttribute('data-current', 'true');
    }
    window.addEventListener('scroll', function () { window.requestAnimationFrame(update); }, { passive: true });
    window.addEventListener('resize', function () { window.requestAnimationFrame(update); });
    update();
  }

  // ------------------------------------------------------------ chart stagger
  function chartEntry() {
    var chart = $('.benchmark-chart');
    if (!chart) return;
    var bars = $$('.bar-fill', chart);
    if (bars.length === 0) return;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      bars.forEach(function (b) { b.style.width = ''; b.style.transition = 'none'; });
      chart.setAttribute('data-entered', 'true');
      $$('.bar-row', chart).forEach(function (r) { r.setAttribute('data-entered', 'true'); });
      return;
    }
    bars.forEach(function (b) { b.style.width = '0%'; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        io.disconnect();
        bars.forEach(function (bar, i) {
          window.setTimeout(function () {
            bar.style.transitionDuration = '500ms';
            bar.style.width = bar.dataset.width || bar.getAttribute('data-width') || '100%';
            if (i === bars.length - 1) {
              window.setTimeout(function () { chart.setAttribute('data-entered', 'true'); }, 520);
            }
          }, 55 * i);
        });
      });
    }, { threshold: 0.25 });
    io.observe(chart);
  }

  // Bar widths are set from recorded scores via inline style; capture them.
  function captureBarWidths() {
    $$('.bar-fill').forEach(function (bar) {
      var width = bar.style.width;
      bar.setAttribute('data-width', width);
    });
  }

  // --------------------------------------------------------- publication times
  function localizeTimes() {
    $$('[data-published-at]').forEach(function (el) {
      var iso = el.getAttribute('data-published-at');
      if (!iso) return;
      var d = new Date(iso);
      var local = formatLocal(d);
      var london = el.textContent.replace(/^Published /, '').replace(/ London$/, '');
      el.textContent = 'Published ' + local + ' (' + london + ' London)';
    });
  }

  function formatLocal(d) {
    var day = d.getDate();
    var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return day + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() + ', ' + hh + ':' + mm;
  }

  // -------------------------------------------------------------- claim tether
  function claimTether() {
    var markers = $$('.claim-marker');
    if (markers.length === 0) return;
    var status = $('#claim-tether-status');
    var deltaLabel = $('#tether-delta');
    var line = $('#tether-line');
    var bracket = $('#tether-bracket');
    var chart = $('.benchmark-chart');
    var pageData = null;
    var dataScript = $('#page-data');
    if (dataScript) {
      try { pageData = JSON.parse(dataScript.textContent || '{}'); } catch (e) { pageData = null; }
    }
    var pinned = null;
    var rafPending = false;

    function claimsById() {
      var map = {};
      (pageData && pageData.claims ? pageData.claims : []).forEach(function (c) { map[c.id] = c; });
      return map;
    }

    function citedRowIds(claim) {
      if (!pageData || !pageData.rows || !claim) return [];
      return pageData.rows.filter(function (row) {
        return (row.subject && row.benchmark === claim.benchmark && row.eval_date === claim.eval_date);
      }).map(function (r) { return r.id; });
    }

    function applyTether(claimId, animate) {
      var claim = claimsById()[claimId];
      if (!claim) return;
      var rowIds = citedRowIds(claim);
      var duration = animate && !reduceMotion ? 560 : 0;
      // 1. Marker fill.
      var marker = $('#claim-' + claimId);
      if (marker) marker.setAttribute('aria-pressed', 'true');
      // Address gains the claim, replacing the current entry.
      var url = new URL(window.location.href);
      url.searchParams.set('claim', claimId);
      window.history.replaceState(null, '', url);
      // 2. Leader line (glide chart into view first when off screen).
      if (chart && chart.scrollIntoView && animate && !reduceMotion) {
        var rect = chart.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          chart.scrollIntoView({ behavior: 'auto', block: 'center' });
        }
      }
      drawLine(claimId, animate);
      // 3. Fade uncited rows.
      $$('.bar-row').forEach(function (row) {
        var cited = rowIds.indexOf(row.getAttribute('data-row-id')) !== -1;
        row.setAttribute('data-cited', String(cited));
        var fill = row.querySelector('.bar-fill');
        if (fill) {
          fill.style.transitionDuration = reduceMotion ? '0ms' : '250ms';
          fill.style.background = cited ? '#8a3b2a' : '';
        }
      });
      // 4. Difference counts up.
      if (deltaLabel) countUp(deltaLabel, claim.delta || '', duration);
      // 5. Announce.
      if (status) {
        var rows = pageData && pageData.rows ? pageData.rows : [];
        var modelRow = rows.find(function (r) { return r.id === claim.model_row_id; });
        var comparatorRow = rows.find(function (r) { return r.id === claim.comparator_row_id; });
        var date = formatDateForAnnouncement(claim.eval_date);
        status.textContent = 'Claim ' + claim.number + ': ' + claim.benchmark + ', ' +
          (modelRow ? modelRow.subject_name : '') + ' ' + (modelRow ? modelRow.score : '') +
          ' versus ' + (comparatorRow ? comparatorRow.subject_name : '') + ' ' + (comparatorRow ? comparatorRow.score : '') +
          ', evaluated ' + date + '.';
      }
      pinned = claimId;
    }

    function releaseTether() {
      if (!pinned) return;
      var claimId = pinned;
      var claim = claimsById()[claimId];
      var marker = $('#claim-' + claimId);
      if (status) status.textContent = 'Claim ' + (claim ? claim.number : '') + ' released.';
      if (deltaLabel) {
        if (reduceMotion) { deltaLabel.textContent = ''; }
        else countUp(deltaLabel, '', 300);
      }
      $$('.bar-row').forEach(function (row) {
        row.setAttribute('data-cited', 'true');
        var fill = row.querySelector('.bar-fill');
        if (fill) { fill.style.background = ''; }
      });
      if (line) line.hidden = true;
      if (bracket) bracket.hidden = true;
      if (marker) marker.setAttribute('aria-pressed', 'false');
      var url = new URL(window.location.href);
      url.searchParams.delete('claim');
      window.history.replaceState(null, '', url);
      pinned = null;
    }

    function drawLine(claimId, animate) {
      var marker = $('#claim-' + claimId);
      var narrow = window.innerWidth < 720;
      if (!marker || !chart) return;
      var claim = claimsById()[claimId];
      var rowIds = citedRowIds(claim);
      var firstCited = $$('.bar-row').find(function (r) { return rowIds.indexOf(r.getAttribute('data-row-id')) !== -1; });
      if (narrow) {
        if (line) line.hidden = true;
        if (bracket) {
          bracket.hidden = false;
          bracket.setAttribute('data-tether-line', claimId);
          bracket.textContent = 'Claim ' + (claim ? claim.number : '');
          if (firstCited) {
            var chartRect = chart.getBoundingClientRect();
            var rowRect = firstCited.getBoundingClientRect();
            bracket.style.left = '0px';
            bracket.style.top = (rowRect.top - chartRect.top + chart.scrollTop) + 'px';
            bracket.style.height = Math.max(24, rowRect.height) + 'px';
          }
        }
        return;
      }
      if (bracket) bracket.hidden = true;
      if (!line) return;
      line.hidden = false;
      line.setAttribute('data-tether-line', claimId);
      var markerRect = marker.getBoundingClientRect();
      var chartRect = chart.getBoundingClientRect();
      var targetRow = firstCited;
      if (!targetRow) { line.hidden = true; return; }
      var rowRect = targetRow.getBoundingClientRect();
      var x1 = markerRect.left - chartRect.left;
      var y1 = markerRect.top - chartRect.top + markerRect.height / 2;
      var x2 = rowRect.left - chartRect.left;
      var y2 = rowRect.top - chartRect.top + rowRect.height / 2;
      var length = Math.hypot(x2 - x1, y2 - y1);
      var angle = Math.atan2(y2 - y1, x2 - x1);
      line.style.left = x1 + 'px';
      line.style.top = y1 + 'px';
      line.style.width = '0px';
      line.style.transform = 'rotate(' + angle + 'rad)';
      line.style.transformOrigin = '0 0';
      if (animate && !reduceMotion) {
        line.style.transition = 'width 560ms ease-out';
        window.requestAnimationFrame(function () { line.style.width = length + 'px'; });
      } else {
        line.style.transition = 'none';
        line.style.width = length + 'px';
      }
    }

    function countUp(el, target, duration) {
      if (duration === 0) { el.textContent = target; return; }
      var numeric = parseFloat(target.replace('+', ''));
      if (Number.isNaN(numeric)) { el.textContent = target; return; }
      var start = performance.now();
      function step(now) {
        var t = Math.min(1, (now - start) / duration);
        var eased = 1 - Math.pow(1 - t, 3);
        var value = numeric * eased;
        var decimals = (target.split('.')[1] || '').length;
        var text = (numeric < 0 ? '-' : numeric >= 0 && target.indexOf('-') === -1 ? '+' : '') +
          value.toFixed(decimals);
        el.textContent = text;
        if (t < 1) window.requestAnimationFrame(step);
        else el.textContent = target;
      }
      window.requestAnimationFrame(step);
    }

    function formatDateForAnnouncement(evalDate) {
      var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      var parts = evalDate.split('-');
      return Number(parts[2]) + ' ' + months[Number(parts[1]) - 1] + ' ' + parts[0];
    }

    markers.forEach(function (marker) {
      var claimId = marker.getAttribute('data-claim-id');
      function activate() {
        if (pinned === claimId) { releaseTether(); marker.focus(); return; }
        if (pinned) releaseTether();
        applyTether(claimId, true);
      }
      marker.addEventListener('click', activate);
      marker.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
      });
      marker.addEventListener('mouseenter', function () {
        if (pinned) return;
        applyTether(claimId, true);
        pinned = null; // preview only
      });
      marker.addEventListener('mouseleave', function () {
        if (pinned === claimId) return;
        if (!pinned) {
          // Undo a preview.
          var m = $('#claim-' + claimId);
          if (m) m.setAttribute('aria-pressed', 'false');
          $$('.bar-row').forEach(function (row) {
            row.setAttribute('data-cited', 'true');
            var fill = row.querySelector('.bar-fill');
            if (fill) fill.style.background = '';
          });
          if (deltaLabel) deltaLabel.textContent = '';
          if (line) line.hidden = true;
          if (bracket) bracket.hidden = true;
        }
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && pinned) {
        releaseTether();
        var marker = $('.claim-marker[aria-pressed="false"]');
        var active = document.activeElement;
        if (active && active.classList && active.classList.contains('claim-marker')) active.focus();
      }
    });

    // Restore from the address without animation.
    var initial = new URL(window.location.href).searchParams.get('claim');
    if (initial && claimsById()[initial]) {
      window.setTimeout(function () { applyTether(initial, false); }, reduceMotion ? 0 : 250);
    }
    window.addEventListener('resize', function () {
      if (!pinned) return;
      if (rafPending) return;
      rafPending = true;
      window.requestAnimationFrame(function () { rafPending = false; drawLine(pinned, false); });
    });
  }

  // ----------------------------------------------------------------- gallery
  function gallery() {
    var region = $('.samples');
    if (!region) return;
    $$('.sample-button').forEach(function (button) {
      button.addEventListener('click', function () {
        var audioId = button.getAttribute('data-audio');
        var seqId = button.getAttribute('data-sequence');
        var action = button.getAttribute('data-action');
        if (audioId) {
          var wrap = button.closest('.sample');
          var player = wrap ? wrap.querySelector('audio') : null;
          if (!player) return;
          $$('.sample audio').forEach(function (other) {
            if (other !== player) { other.pause(); }
          });
          if (action === 'play') {
            player.play().then(function () {
              setPlayPause(wrap, true);
            }).catch(function () { /* ignore */ });
          } else {
            player.pause();
            setPlayPause(wrap, false);
          }
          return;
        }
        if (seqId) {
          var sample = button.closest('.sample');
          var img = sample ? sample.querySelector('.sample-frame') : null;
          if (!img) return;
          var urls = imageUrlsFor(seqId);
          var current = img.getAttribute('data-frame-index') || '0';
          var idx = Number(current);
          var next = action === 'next' ? (idx + 1) % urls.length : (idx - 1 + urls.length) % urls.length;
          swapFrame(img, urls, next, sample);
        }
      });
    });
    $$('.sample-frame').forEach(function (img) {
      img.setAttribute('tabindex', '0');
      img.setAttribute('data-frame-index', '0');
      img.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        var sample = img.closest('.sample');
        var seqId = sample ? sample.getAttribute('data-sample-id') : null;
        var urls = imageUrlsFor(seqId);
        var idx = Number(img.getAttribute('data-frame-index') || '0');
        var next = e.key === 'ArrowRight' ? (idx + 1) % urls.length : (idx - 1 + urls.length) % urls.length;
        swapFrame(img, urls, next, sample);
      });
    });
    function imageUrlsFor(seqId) {
      var sample = document.querySelector('.sample[data-sample-id="' + seqId + '"]');
      if (!sample) return [];
      var urlsAttr = sample.getAttribute('data-frame-urls');
      return urlsAttr ? urlsAttr.split(' ').filter(Boolean) : [];
    }
    function swapFrame(img, urls, next, sample) {
      if (!urls.length) return;
      img.setAttribute('data-frame-index', String(next));
      img.setAttribute('src', urls[next]);
      img.setAttribute('alt', (sample ? sample.querySelector('.sample-title').textContent : 'Frame') + ' frame ' + (next + 1));
      var statusEl = sample ? sample.querySelector('[data-frame-status]') : null;
      if (statusEl) statusEl.textContent = 'Frame ' + (next + 1) + ' of ' + urls.length;
    }
    function setPlayPause(wrap, playing) {
      var playBtn = wrap.querySelector('[data-action="play"]');
      var pauseBtn = wrap.querySelector('[data-action="pause"]');
      if (playBtn) playBtn.hidden = playing;
      if (pauseBtn) pauseBtn.hidden = !playing;
    }
  }

  // ---------------------------------------------------------------- careers filters
  var filterForm = $('#filter-form');
  if (filterForm) {
    filterForm.addEventListener('change', function () {
      filterForm.submit();
    });
  }

  // ------------------------------------------------------------------- search
  var searchForm = $('.search-form');
  if (searchForm) {
    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' ) return;
      var target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      var input = $('#search-terms');
      if (input) { e.preventDefault(); input.focus(); }
    });
  }

  // ------------------------------------------------------- application form
  var applicationForm = $('#application-form');
  if (applicationForm) {
    var submitButton = $('#submit-application');
    var appStatus = $('#application-status');
    var dataScript = $('#page-data');
    var slug = null;
    try { slug = JSON.parse(dataScript ? dataScript.textContent : '{}').slug; } catch (e) { slug = null; }
    var idempotencyKey = null;
    var pending = false;
    applicationForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (pending) return;
      pending = true;
      if (submitButton) submitButton.disabled = true;
      if (appStatus) { appStatus.textContent = 'Sending your application…'; appStatus.setAttribute('data-kind', ''); }
      clearFieldErrors(applicationForm);
      if (!idempotencyKey) idempotencyKey = 'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
      var formData = new FormData(applicationForm);
      fetch('/api/careers/roles/' + slug + '/applications', {
        method: 'POST',
        body: formData,
        headers: { 'Idempotency-Key': idempotencyKey },
      }).then(function (res) {
        return res.json().then(function (body) { return { status: res.status, body: body, ok: res.ok }; });
      }).then(function (result) {
        if (result.status === 201 || result.status === 200) {
          var email = formData.get('email');
          if (appStatus) {
            appStatus.textContent = 'Application received. Your receipt and tracking link are on their way to ' + email + '.';
            appStatus.setAttribute('data-kind', 'success');
          }
          idempotencyKey = null;
          applicationForm.reset();
          return;
        }
        idempotencyKey = null;
        if (result.status === 422 && result.body && result.body.fields) {
          if (appStatus) { appStatus.textContent = 'Please fix the highlighted fields.'; appStatus.setAttribute('data-kind', 'error'); }
          showFieldErrors(applicationForm, result.body.fields);
          focusFirstError(applicationForm);
          return;
        }
        if (appStatus) {
          appStatus.textContent = (result.body && result.body.message) || 'Something went wrong. Please try again.';
          appStatus.setAttribute('data-kind', 'error');
        }
      }).catch(function () {
        idempotencyKey = null;
        if (appStatus) {
          appStatus.textContent = "We couldn't reach Aldermoor. Check your connection and try again.";
          appStatus.setAttribute('data-kind', 'error');
        }
      }).finally(function () {
        pending = false;
        if (submitButton) submitButton.disabled = false;
      });
    });
  }

  // ---------------------------------------------------------------- resend form
  var resendForm = document.querySelector('form[data-resend]');
  if (resendForm) {
    var resendStatus = $('#resend-status');
    resendForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = resendForm.querySelector('input[name="email"]').value;
      if (resendStatus) { resendStatus.textContent = 'Sending…'; resendStatus.setAttribute('data-kind', ''); }
      fetch('/api/careers/tracking-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email }),
      }).then(function (res) {
        return res.json().then(function (body) { return { status: res.status, body: body }; });
      }).then(function (result) {
        if (result.status === 202) {
          if (resendStatus) { resendStatus.textContent = result.body.message; resendStatus.setAttribute('data-kind', 'success'); }
          return;
        }
        if (result.status === 422 && result.body && result.body.fields && result.body.fields.email) {
          if (resendStatus) { resendStatus.textContent = result.body.fields.email; resendStatus.setAttribute('data-kind', 'error'); }
          return;
        }
        if (result.status === 429 && resendStatus) {
          resendStatus.textContent = result.body.message;
          resendStatus.setAttribute('data-kind', 'error');
          return;
        }
        if (resendStatus) { resendStatus.textContent = 'Something went wrong. Please try again.'; resendStatus.setAttribute('data-kind', 'error'); }
      }).catch(function () {
        if (resendStatus) { resendStatus.textContent = "We couldn't reach Aldermoor. Check your connection and try again."; resendStatus.setAttribute('data-kind', 'error'); }
      });
    });
  }

  // ------------------------------------------------------------- tracking page
  var withdrawButton = $('#withdraw-button');
  if (withdrawButton) {
    var withdrawDialog = $('#withdraw-dialog');
    var confirmWithdraw = $('#confirm-withdraw');
    var keepApplication = $('#keep-application');
    var appStatusTrack = $('#application-status');
    var lastFocus = null;
    function openDialog() {
      lastFocus = document.activeElement;
      if (!withdrawDialog) return;
      withdrawDialog.hidden = false;
      var safe = keepApplication || (withdrawDialog.querySelector('button'));
      if (safe) safe.focus();
    }
    function closeDialog() {
      if (withdrawDialog) withdrawDialog.hidden = true;
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    withdrawButton.addEventListener('click', openDialog);
    if (keepApplication) keepApplication.addEventListener('click', closeDialog);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && withdrawDialog && !withdrawDialog.hidden) closeDialog();
      if (e.key === 'Tab' && withdrawDialog && !withdrawDialog.hidden) {
        var focusables = withdrawDialog.querySelectorAll('button, [href], input, select, textarea');
        if (focusables.length === 0) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    if (confirmWithdraw) {
      confirmWithdraw.addEventListener('click', function () {
        if (appStatusTrack) { appStatusTrack.textContent = 'Withdrawing…'; }
        var token = window.location.pathname.split('/').pop();
        fetch('/api/track/' + token + '/withdraw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          .then(function (res) { return res.json().then(function (body) { return { status: res.status, body: body }; }); })
          .then(function (result) {
            if (result.status === 200) {
              if (appStatusTrack) { appStatusTrack.textContent = 'Your application has been withdrawn.'; appStatusTrack.setAttribute('data-kind', 'success'); }
              window.setTimeout(function () { window.location.reload(); }, 900);
              return;
            }
            if (appStatusTrack) { appStatusTrack.textContent = result.body.message; appStatusTrack.setAttribute('data-kind', 'error'); }
            closeDialog();
          })
          .catch(function () {
            if (appStatusTrack) { appStatusTrack.textContent = "We couldn't reach Aldermoor. Check your connection and try again."; appStatusTrack.setAttribute('data-kind', 'error'); }
          });
      });
    }
  }

  // ---------------------------------------------------------------- console UI
  if (document.body.classList.contains('console')) {
    var signOutButton = $('#sign-out');
    if (signOutButton) {
      signOutButton.addEventListener('click', function () {
        fetch('/api/console/session', { method: 'DELETE' }).then(function () {
          window.location.href = '/console/sign-in';
        }).catch(function () { window.location.href = '/console/sign-in'; });
      });
    }
    var signInForm = $('#sign-in-form');
    if (signInForm) {
      var signInStatus = $('#sign-in-status');
      signInForm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (signInStatus) signInStatus.textContent = 'Signing in…';
        fetch('/api/console/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: signInForm.querySelector('#email').value,
            password: signInForm.querySelector('#password').value,
          }),
        }).then(function (res) {
          return res.json().then(function (body) { return { status: res.status, body: body }; });
        }).then(function (result) {
          if (result.status === 200) {
            window.location.href = '/console';
            return;
          }
          if (signInStatus) signInStatus.textContent = result.body.message;
        }).catch(function () {
          if (signInStatus) signInStatus.textContent = "We couldn't reach Aldermoor. Check your connection and try again.";
        });
      });
    }
    // Service status banner.
    var serviceStatus = $('#service-status');
    function refreshServiceStatus() {
      fetch('/api/ready').then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
        if (!data || !serviceStatus) return;
        var lines = [];
        if (data.dependencies && data.dependencies.mail === 'down') {
          lines.push('Mail delivery is delayed. Messages are queued and will be sent when mail returns.');
        }
        if (data.dependencies && data.dependencies.storage === 'down') {
          lines.push('File storage is unreachable. Applications, résumé downloads and samples are paused.');
        }
        serviceStatus.textContent = lines.join(' ');
      }).catch(function () { /* leave as-is */ });
    }
    refreshServiceStatus();
    window.setInterval(refreshServiceStatus, 15000);
    // Route-specific console screens.
    loadConsoleScreen();
  }

  // ------------------------------------------------------------- helpers
  function clearFieldErrors(form) {
    $$('.field-error', form).forEach(function (el) { el.hidden = true; el.textContent = ''; });
  }
  function showFieldErrors(form, fields) {
    Object.keys(fields || {}).forEach(function (key) {
      var input = form.querySelector('[name="' + key + '"]');
      var field = input ? input.closest('.field') : null;
      var errorEl = field ? field.querySelector('.field-error') : null;
      if (errorEl) { errorEl.textContent = fields[key]; errorEl.hidden = false; }
    });
  }
  function focusFirstError(form) {
    var errorEl = form.querySelector('.field-error:not([hidden])');
    if (errorEl) {
      var field = errorEl.closest('.field');
      var input = field ? field.querySelector('input, select, textarea') : null;
      if (input) input.focus();
    }
  }

  // Console screen loader (the screens are rendered client-side from the API).
  function loadConsoleScreen() {
    var detail = $('#console-detail');
    if (!detail) return;
    var route = detail.getAttribute('data-route');
    if (route === 'home') renderWorkQueue(detail);
    else if (route === 'rows') renderRows(detail);
    else if (route === 'benefits') renderBenefits(detail);
    else if (route === 'grants') renderGrants(detail);
    else if (route === 'audit') renderAudit(detail);
    else if (route === 'jobs') renderJobs(detail);
    else if (route === 'requisitions') renderRequisitions(detail);
    else if (route.indexOf('content') === 0) renderContent(detail, route);
    else if (route.indexOf('requisitions/') === 0) renderRequisitionDetail(detail, route.slice('requisitions/'.length));
    else if (route.indexOf('applications/') === 0) renderApplicationDetail(detail, route.slice('applications/'.length));
    else detail.innerHTML = '<p class="muted">Choose a section from the left.</p>';
  }

  function api(path, options) {
    return fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {}))
      .then(function (res) { return res.json().then(function (body) { return { status: res.status, body: body, ok: res.ok }; }); });
  }

  function consoleStatus(kind, text) {
    var el = $('#console-status');
    if (!el) return;
    el.textContent = text;
    el.setAttribute('data-kind', kind === 'error' ? 'error' : 'success');
  }

  function renderWorkQueue(detail) {
    detail.innerHTML = '<h1 class="display">Work queue</h1><p class="muted">Loading…</p>';
    api('/api/console/content').then(function (result) {
      if (result.status !== 200) { detail.innerHTML = '<p class="muted">Sign in to see your queue.</p>'; return; }
      var groups = { draft: [], in_review: [], returned: [], approved: [], scheduled: [], published: [], withdrawn: [] };
      (result.body.items || []).forEach(function (item) { (groups[item.status] || []).push(item); });
      var html = '<h1 class="display">Work queue</h1>';
      Object.keys(groups).forEach(function (status) {
        if (groups[status].length === 0) return;
        html += '<section class="queue-group"><h2>' + status.replace('_', ' ') + '</h2><ul class="queue-list">';
        groups[status].forEach(function (item) {
          html += '<li><a href="/console/content/' + item.id + '">' + escapeHtmlText(item.title) + '</a> <span class="muted">(' + item.kind + ' · v' + item.version + ')</span></li>';
        });
        html += '</ul></section>';
      });
      if (!result.body.items || result.body.items.length === 0) html += '<p class="muted">No content items yet.</p>';
      detail.innerHTML = html;
    });
  }

  function renderRows(detail) {
    detail.innerHTML = '<h1 class="display">Benchmark rows</h1><form class="console-card" id="row-form">' +
      '<h2>Record a benchmark row</h2>' +
      rowField('subject', 'Subject (model slug or comparator slug)') +
      rowField('benchmark', 'Benchmark') +
      rowField('eval_date', 'Evaluation date (YYYY-MM-DD)') +
      rowField('score', 'Score (0 to 100, two decimals)') +
      rowField('source_note', 'Source note') +
      '<button class="button" type="submit">Record row</button></form>' +
      '<div class="table-wrap"><table class="console-table" aria-label="Benchmark rows"><thead><tr><th>Subject</th><th>Benchmark</th><th>Date</th><th>Score</th></tr></thead><tbody id="rows-body"></tbody></table></div>';
    function refresh() {
      api('/api/console/benchmark-rows').then(function (res) {
        var body = $('#rows-body');
        if (!body) return;
        body.innerHTML = (res.body.rows || []).map(function (r) {
          return '<tr><td data-label="Subject">' + escapeHtmlText(r.subject_name) + '</td><td data-label="Benchmark">' + escapeHtmlText(r.benchmark) + '</td><td data-label="Date" class="mono">' + escapeHtmlText(r.eval_date) + '</td><td data-label="Score" class="mono">' + escapeHtmlText(r.score) + '</td></tr>';
        }).join('');
      });
    }
    refresh();
    var form = $('#row-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        consoleStatus('', 'Saving…');
        api('/api/console/benchmark-rows', { method: 'POST', body: JSON.stringify(formValues(form)) }).then(function (res) {
          if (res.status === 201) { consoleStatus('success', 'Row recorded.'); form.reset(); refresh(); }
          else consoleStatus('error', res.body.message || 'Could not record the row.');
        });
      });
    }
  }

  function renderBenefits(detail) {
    detail.innerHTML = '<h1 class="display">Benefits register</h1><form class="console-card" id="benefits-form">' +
      '<h2>Record a benefits entry</h2>' +
      rowField('region', 'Region (uk, europe, north-america)') +
      rowField('effective_from', 'Effective from (YYYY-MM-DD)') +
      rowField('summary', 'Summary') +
      '<button class="button" type="submit">Record benefits entry</button></form>';
    var form = $('#benefits-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        consoleStatus('', 'Saving…');
        api('/api/console/benefits', { method: 'POST', body: JSON.stringify(formValues(form)) }).then(function (res) {
          if (res.status === 201) { consoleStatus('success', 'Benefits entry recorded.'); form.reset(); }
          else consoleStatus('error', res.body.message || 'Could not record the entry.');
        });
      });
    }
  }

  function renderGrants(detail) {
    detail.innerHTML = '<h1 class="display">Grants</h1><form class="console-card" id="grant-form">' +
      '<h2>Grant a role</h2>' +
      rowField('staff_email', 'Staff email') +
      rowSelect('role', 'Role', ['editor', 'approver', 'recruiter', 'administrator']) +
      rowField('expires_at', 'Expires (London, YYYY-MM-DDTHH:mm)') +
      '<button class="button" type="submit">Grant role</button></form>' +
      '<div class="table-wrap"><table class="console-table" aria-label="Grants"><thead><tr><th>Staff</th><th>Role</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody id="grants-body"></tbody></table></div>';
    function refresh() {
      api('/api/console/grants').then(function (res) {
        var body = $('#grants-body');
        if (!body) return;
        if (res.status !== 200) { body.innerHTML = ''; return; }
        body.innerHTML = (res.body.grants || []).map(function (g) {
          return '<tr><td data-label="Staff">' + escapeHtmlText(g.staff_email) + '</td><td data-label="Role">' + escapeHtmlText(g.role) + '</td><td data-label="Expires" class="mono">' + escapeHtmlText(String(g.expires_at).replace('T', ' ').slice(0, 16)) + '</td><td data-label="Status">' + g.status + '</td><td data-label=""><button class="button subtle" data-revoke="' + g.id + '" data-version="' + g.version + '">Revoke ' + escapeHtmlText(g.role) + ' for ' + escapeHtmlText(g.staff_email) + '</button></td></tr>';
        }).join('');
        $$('[data-revoke]', body).forEach(function (button) {
          button.addEventListener('click', function () {
            consoleStatus('', 'Saving…');
            api('/api/console/grants/' + button.getAttribute('data-revoke') + '/revoke', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'If-Match': '"' + button.getAttribute('data-version') + '"', 'Idempotency-Key': 'revoke-' + button.getAttribute('data-revoke') + '-' + Date.now() },
              body: '{}',
            }).then(function (res2) {
              if (res2.status === 200) { consoleStatus('success', 'Role revoked.'); refresh(); }
              else consoleStatus('error', res2.body.message || 'Could not revoke.');
            });
          });
        });
      });
    }
    refresh();
    var form = $('#grant-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        consoleStatus('', 'Saving…');
        var values = formValues(form);
        var iso = values.expires_at;
        api('/api/console/grants', {
          method: 'POST',
          headers: { 'Idempotency-Key': 'grant-' + Date.now() },
          body: JSON.stringify({ staff_email: values.staff_email, role: values.role, expires_at: londonToIso(iso) }),
        }).then(function (res) {
          if (res.status === 201) { consoleStatus('success', 'Role granted.'); form.reset(); refresh(); }
          else consoleStatus('error', res.body.message || 'Could not grant the role.');
        });
      });
    }
  }

  function londonToIso(value) {
    // The console sends the London wall clock; the API accepts an instant too.
    if (!value) return value;
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
    if (!m) return value;
    return value;
  }

  function renderAudit(detail) {
    detail.innerHTML = '<h1 class="display">Audit record</h1><button class="button" id="verify-chain">Verify chain</button>' +
      '<div class="table-wrap"><table class="console-table" aria-label="Audit record"><thead><tr><th>Seq</th><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead><tbody id="audit-body"></tbody></table></div>' +
      '<p><a href="#" id="older-entries">Older entries</a></p>';
    var beforeSeq = null;
    function refresh() {
      var path = '/api/console/audit?limit=100' + (beforeSeq ? '&before_seq=' + beforeSeq : '');
      api(path).then(function (res) {
        var body = $('#audit-body');
        if (!body) return;
        if (res.status !== 200) { body.innerHTML = ''; return; }
        var rows = res.body.entries || [];
        body.innerHTML = rows.map(function (e) {
          return '<tr><td data-label="Seq" class="mono">' + e.seq + '</td><td data-label="When" class="mono">' + escapeHtmlText(String(e.at).replace('T', ' ').slice(0, 19)) + '</td><td data-label="Actor">' + escapeHtmlText(e.actor) + '</td><td data-label="Action">' + escapeHtmlText(e.action) + '</td><td data-label="Target">' + escapeHtmlText(e.target_type + ' ' + e.target_id.slice(0, 8)) + '</td><td data-label="Detail" class="muted">' + escapeHtmlText(JSON.stringify(e.detail)) + '</td></tr>';
        }).join('');
        var older = $('#older-entries');
        if (older) {
          older.addEventListener('click', function (ev) {
            ev.preventDefault();
            if (rows.length > 0) beforeSeq = rows[rows.length - 1].seq;
            refresh();
          });
        }
      });
    }
    refresh();
    var verify = $('#verify-chain');
    if (verify) {
      verify.addEventListener('click', function () {
        consoleStatus('', 'Saving…');
        api('/api/console/audit/verify').then(function (res) {
          if (res.status === 200) {
            consoleStatus('success', res.body.valid ? 'Audit chain verified: ' + res.body.entries + ' entries.' : 'Audit chain broken at entry ' + res.body.first_invalid_seq + '.');
          } else {
            consoleStatus('error', res.body.message || 'Could not verify.');
          }
        });
      });
    }
  }

  function renderJobs(detail) {
    detail.innerHTML = '<h1 class="display">Jobs</h1><nav class="facets" aria-label="Job states">' +
      '<a href="#" data-state="">Pending</a><a href="#" data-state="dead">Dead</a><a href="#" data-state="done">Done</a></nav>' +
      '<div class="table-wrap"><table class="console-table" aria-label="Jobs"><thead><tr><th>Kind</th><th>State</th><th>Attempts</th><th>Last error</th><th>Next attempt</th><th></th></tr></thead><tbody id="jobs-body"></tbody></table></div>';
    var state = 'pending';
    $$('[data-state]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        state = link.getAttribute('data-state');
        refresh();
      });
    });
    function refresh() {
      api('/api/console/jobs?state=' + state).then(function (res) {
        var body = $('#jobs-body');
        if (!body) return;
        var jobs = res.body.jobs || [];
        if (jobs.length === 0) { body.innerHTML = '<tr><td colspan="6" class="muted">No jobs in this state.</td></tr>'; }
        body.innerHTML = jobs.map(function (j) {
          return '<tr><td data-label="Kind">' + escapeHtmlText(j.kind) + '</td><td data-label="State">' + j.state + '</td><td data-label="Attempts" class="mono">' + j.attempts + '</td><td data-label="Last error">' + escapeHtmlText(j.last_error || '—') + '</td><td data-label="Next attempt" class="mono">' + escapeHtmlText(String(j.next_attempt_at).replace('T', ' ').slice(0, 16)) + '</td><td data-label="">' + (j.state === 'dead' ? '<button class="button subtle" data-retry="' + j.id + '">Retry job ' + j.id.slice(0, 8) + '</button>' : '') + '</td></tr>';
        }).join('');
        $$('[data-retry]', body).forEach(function (button) {
          button.addEventListener('click', function () {
            consoleStatus('', 'Saving…');
            api('/api/console/jobs/' + button.getAttribute('data-retry') + '/retry', { method: 'POST', body: '{}' }).then(function (res2) {
              if (res2.status === 200) { consoleStatus('success', 'Job queued for retry.'); refresh(); }
              else consoleStatus('error', res2.body.message || 'Could not retry.');
            });
          });
        });
      });
    }
    refresh();
  }

  function renderRequisitions(detail) {
    detail.innerHTML = '<h1 class="display">Requisitions</h1><form class="console-card" id="req-form">' +
      '<h2>New requisition</h2>' +
      rowField('slug', 'Slug') + rowField('title', 'Title') +
      rowSelect('discipline', 'Discipline', ['research', 'engineering', 'policy', 'operations']) +
      rowSelect('office', 'Office', ['london', 'edinburgh', 'zurich', 'toronto']) +
      rowField('description', 'Description') +
      rowField('recruiters', 'Recruiters (comma-separated emails)') +
      '<button class="button" type="submit">Create requisition</button></form>' +
      '<div class="table-wrap"><table class="console-table" aria-label="Requisitions"><thead><tr><th>Title</th><th>Status</th><th>Version</th><th>Counts</th></tr></thead><tbody id="reqs-body"></tbody></table></div>';
    function refresh() {
      api('/api/console/requisitions').then(function (res) {
        var body = $('#reqs-body');
        if (!body) return;
        if (res.status !== 200) { body.innerHTML = ''; return; }
        body.innerHTML = (res.body.requisitions || []).map(function (r) {
          return '<tr><td data-label="Title"><a href="/console/requisitions/' + r.id + '">' + escapeHtmlText(r.title) + '</a></td><td data-label="Status">' + r.status + '</td><td data-label="Version" class="mono">' + r.version + '</td><td data-label="Counts" class="muted">' + Object.keys(r.counts).map(function (k) { return k + ':' + r.counts[k]; }).join(' ') + '</td></tr>';
        }).join('');
      });
    }
    refresh();
    var form = $('#req-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        consoleStatus('', 'Saving…');
        var values = formValues(form);
        api('/api/console/requisitions', {
          method: 'POST',
          headers: { 'Idempotency-Key': 'req-' + Date.now() },
          body: JSON.stringify({
            slug: values.slug, title: values.title, discipline: values.discipline,
            office: values.office, description: values.description,
            recruiters: values.recruiters ? values.recruiters.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [],
          }),
        }).then(function (res) {
          if (res.status === 201) { consoleStatus('success', 'Requisition created.'); form.reset(); refresh(); }
          else consoleStatus('error', res.body.message || 'Could not create.');
        });
      });
    }
  }

  function renderRequisitionDetail(detail, id) {
    detail.innerHTML = '<p class="muted">Loading…</p>';
    api('/api/console/requisitions/' + id).then(function (res) {
      if (res.status !== 200) { detail.innerHTML = '<p class="muted">No such requisition.</p>'; return; }
      var r = res.body.requisition;
      api('/api/console/requisitions/' + id + '/applications').then(function (appsRes) {
        var apps = appsRes.status === 200 ? appsRes.body.applications : [];
        var html = '<h1 class="display">' + escapeHtmlText(r.title) + '</h1>' +
          '<p class="muted">' + r.discipline + ' · ' + r.office + ' · ' + r.status + ' · version ' + r.version + '</p>' +
          '<button class="button" id="open-req" data-version="' + r.version + '">Open requisition</button> ' +
          '<button class="button subtle" id="close-req" data-version="' + r.version + '">Close requisition</button>';
        html += '<div class="table-wrap"><table class="console-table" aria-label="Applications"><thead><tr><th>Reference</th><th>Name</th><th>Stage</th><th>Version</th></tr></thead><tbody>' +
          apps.map(function (a) {
            return '<tr><td data-label="Reference" class="mono">' + escapeHtmlText(a.reference) + '</td><td data-label="Name">' + escapeHtmlText(a.name) + '</td><td data-label="Stage">' + a.stage + '</td><td data-label="Version" class="mono"><a href="/console/applications/' + a.id + '">v' + a.version + ' →</a></td></tr>';
          }).join('') + '</tbody></table></div>';
        detail.innerHTML = html;
        var openBtn = $('#open-req');
        if (openBtn) {
          openBtn.addEventListener('click', function () {
            consoleStatus('', 'Saving…');
            api('/api/console/requisitions/' + id + '/open', {
              method: 'POST',
              headers: { 'If-Match': '"' + openBtn.getAttribute('data-version') + '"', 'Idempotency-Key': 'open-' + id + '-' + Date.now() },
              body: '{}',
            }).then(function (res2) {
              if (res2.status === 200) { consoleStatus('success', 'Requisition opened.'); renderRequisitionDetail(detail, id); }
              else consoleStatus('error', res2.body.message || 'Could not open.');
            });
          });
        }
        var closeBtn = $('#close-req');
        if (closeBtn) {
          closeBtn.addEventListener('click', function () {
            var reason = window.prompt('Say why this requisition is closing.');
            if (!reason) return;
            consoleStatus('', 'Saving…');
            api('/api/console/requisitions/' + id + '/close', {
              method: 'POST',
              headers: { 'If-Match': '"' + closeBtn.getAttribute('data-version') + '"', 'Idempotency-Key': 'close-' + id + '-' + Date.now() },
              body: JSON.stringify({ reason: reason }),
            }).then(function (res2) {
              if (res2.status === 200) { consoleStatus('success', 'Requisition closed.'); renderRequisitionDetail(detail, id); }
              else consoleStatus('error', res2.body.message || 'Could not close.');
            });
          });
        }
      });
    });
  }

  function renderApplicationDetail(detail, id) {
    detail.innerHTML = '<p class="muted">Loading…</p>';
    api('/api/console/applications/' + id).then(function (res) {
      if (res.status !== 200) { detail.innerHTML = '<p class="muted">No such application.</p>'; return; }
      var a = res.body.application;
      var html = '<h1 class="display">' + escapeHtmlText(a.reference) + '</h1>' +
        '<p>' + escapeHtmlText(a.name) + ' · ' + escapeHtmlText(a.email) + '</p>' +
        '<p class="muted">Stage: ' + a.stage + ' · version ' + a.version + '</p>' +
        '<form id="stage-form" class="console-card"><h2>Move to stage</h2>' +
        rowSelect('to', 'Move to stage', ['screening', 'interview', 'final_review', 'offer', 'declined']) +
        rowField('rationale', 'Decision rationale') +
        '<button class="button" type="submit">Record decision</button></form>' +
        '<form id="note-form" class="console-card"><h2>Interview note</h2>' +
        rowField('note-body', 'Note') +
        '<button class="button" type="submit">Add note</button></form>' +
        '<p><a class="button subtle" id="resume-link" href="/api/console/applications/' + id + '/resume">Download résumé</a></p>' +
        '<p><button class="button subtle" id="reissue-link">Reissue tracking link</button></p>' +
        '<h2>Decisions</h2><ol class="plain-list">' +
        (a.decisions || []).map(function (d) { return '<li>' + d.from + ' → ' + d.to + ': ' + escapeHtmlText(d.rationale) + ' <span class="muted">by ' + escapeHtmlText(d.by) + '</span></li>'; }).join('') +
        '</ol><h2>Notes</h2><ol class="plain-list">' +
        (a.notes || []).map(function (n) { return '<li>' + escapeHtmlText(n.body) + ' <span class="muted">by ' + escapeHtmlText(n.by) + '</span></li>'; }).join('') +
        '</ol>';
      detail.innerHTML = html;
      var stageForm = $('#stage-form');
      if (stageForm) {
        stageForm.addEventListener('submit', function (e) {
          e.preventDefault();
          var values = formValues(stageForm);
          consoleStatus('', 'Saving…');
          api('/api/console/applications/' + id + '/stage', {
            method: 'POST',
            headers: { 'If-Match': '"' + a.version + '"', 'Idempotency-Key': 'stage-' + id + '-' + Date.now() },
            body: JSON.stringify({ to: values.to, rationale: values.rationale }),
          }).then(function (res2) {
            if (res2.status === 200) { consoleStatus('success', 'Decision recorded. The candidate will be told the new stage by email.'); renderApplicationDetail(detail, id); }
            else if (res2.status === 412) { consoleStatus('error', res2.body.message); appendReload(); }
            else consoleStatus('error', res2.body.message || 'Could not record the decision.');
          });
        });
      }
      var noteForm = $('#note-form');
      if (noteForm) {
        noteForm.addEventListener('submit', function (e) {
          e.preventDefault();
          var noteBody = noteForm.querySelector('[name="note-body"]').value;
          consoleStatus('', 'Saving…');
          api('/api/console/applications/' + id + '/notes', {
            method: 'POST',
            headers: { 'Idempotency-Key': 'note-' + id + '-' + Date.now() },
            body: JSON.stringify({ body: noteBody }),
          }).then(function (res2) {
            if (res2.status === 201) { consoleStatus('success', 'Note added.'); renderApplicationDetail(detail, id); }
            else consoleStatus('error', res2.body.message || 'Could not add the note.');
          });
        });
      }
      var reissue = $('#reissue-link');
      if (reissue) {
        reissue.addEventListener('click', function () {
          consoleStatus('', 'Saving…');
          api('/api/console/applications/' + id + '/tracking-link/reissue', {
            method: 'POST',
            headers: { 'Idempotency-Key': 'reissue-' + id + '-' + Date.now() },
            body: '{}',
          }).then(function (res2) {
            if (res2.status === 200) consoleStatus('success', 'A new tracking link is on its way to the candidate.');
            else consoleStatus('error', res2.body.message || 'Could not reissue.');
          });
        });
      }
    });
  }

  function appendReload() {
    var status = $('#console-status');
    if (!status || status.querySelector('button')) return;
    var button = document.createElement('button');
    button.className = 'button subtle';
    button.textContent = 'Reload';
    button.addEventListener('click', function () { window.location.reload(); });
    status.appendChild(document.createTextNode(' '));
    status.appendChild(button);
  }

  function renderContent(detail, route) {
    if (route.indexOf('content/new') === 0) {
      renderContentNew(detail);
      return;
    }
    var id = route.slice('content/'.length);
    if (!id) { renderContentNew(detail); return; }
    api('/api/console/content/' + id).then(function (res) {
      if (res.status !== 200) { detail.innerHTML = '<p class="muted">No such item.</p>'; return; }
      var c = res.body.content;
      var html = '<h1 class="display">' + escapeHtmlText(c.title) + '</h1>' +
        '<p class="muted">' + c.kind + ' · ' + c.status + ' · version ' + c.version + ' · by ' + escapeHtmlText(c.author) + '</p>' +
        '<form id="content-form" class="console-card">' +
        rowField('title', 'Title', c.title) + rowField('slug', 'Slug', c.slug) +
        rowField('summary', 'Summary', c.summary) +
        '<div class="field"><label for="body">Body</label><textarea id="body" name="body" rows="10" style="width:100%;font-family:var(--font-mono);font-size:0.85rem">' + escapeHtmlText(c.body) + '</textarea></div>' +
        '<button class="button" type="submit">Save draft</button> ' +
        '<button class="button subtle" type="button" id="submit-review">Submit for review</button>' +
        '</form>' +
        '<form id="comment-form" class="console-card"><h2>Comments</h2>' +
        rowField('comment-body', 'Comment') + '<button class="button" type="submit">Add comment</button>' +
        '<ol class="plain-list">' + (c.comments || []).map(function (cm) { return '<li>' + escapeHtmlText(cm.body) + ' <span class="muted">by ' + escapeHtmlText(cm.author) + '</span></li>'; }).join('') + '</ol></form>' +
        '<div class="console-card" id="actions-card"><h2>Actions</h2>' +
        '<button class="button" type="button" id="approve-btn">Approve</button> ' +
        '<button class="button subtle" type="button" id="return-btn">Return to author</button> ' +
        '<button class="button subtle" type="button" id="schedule-btn">Schedule release</button> ' +
        '<button class="button subtle" type="button" id="release-btn">Release now</button> ' +
        '<button class="button danger" type="button" id="withdraw-btn">Withdraw</button></div>';
      if (c.kind === 'model') {
        html += '<div class="console-card" id="release-card"><h2>Release record</h2>' +
          '<p class="muted" id="release-record-status"></p>' +
          '<button class="button" type="button" id="signoff-safety">Record safety sign-off</button> ' +
          '<button class="button" type="button" id="signoff-legal">Record legal sign-off</button> ' +
          '<button class="button subtle" type="button" id="validate-claims">Validate claims</button> ' +
          '<button class="button subtle" type="button" id="clear-record">Clear release record</button></div>';
      }
      detail.innerHTML = html;
      wireContentHandlers(detail, id, c);
    });
  }

  function renderContentNew(detail) {
    var params = new URL(window.location.href).searchParams;
    var kind = params.get('kind') === 'news' ? 'news' : 'model';
    detail.innerHTML = '<h1 class="display">New ' + (kind === 'news' ? 'news post' : 'model route') + '</h1>' +
      '<form id="content-form" class="console-card">' +
      rowField('title', 'Title') + rowField('slug', 'Slug') + rowField('summary', 'Summary') +
      '<div class="field"><label for="body">Body</label><textarea id="body" name="body" rows="10" style="width:100%;font-family:var(--font-mono);font-size:0.85rem"></textarea></div>' +
      (kind === 'news'
        ? rowSelect('subject', 'Subject', ['research', 'safety', 'policy', 'company']) + rowField('tags', 'Tags (comma-separated)')
        : rowField('linked_news_slug', 'Linked news slug (optional)')) +
      '<button class="button" type="submit">Save draft</button></form>';
    var form = $('#content-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var values = formValues(form);
      var payload = { kind: kind, slug: values.slug, title: values.title, summary: values.summary, body: values.body };
      if (kind === 'news') {
        payload.subject = values.subject;
        payload.tags = values.tags ? values.tags.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
      } else {
        payload.claims = [];
        if (values.linked_news_slug) payload.linked_news_slug = values.linked_news_slug;
      }
      consoleStatus('', 'Saving…');
      api('/api/console/content', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'create-' + Date.now() },
        body: JSON.stringify(payload),
      }).then(function (res) {
        if (res.status === 201) {
          consoleStatus('success', 'Draft saved.');
          window.location.href = '/console/content/' + res.body.content.id;
        } else {
          consoleStatus('error', res.body.message || 'Could not save the draft.');
        }
      });
    });
  }

  function wireContentHandlers(detail, id, c) {
    function callAction(path, options, successText) {
      consoleStatus('', 'Saving…');
      api(path, options).then(function (res) {
        if (res.status >= 200 && res.status < 300) { consoleStatus('success', successText); renderContent(detail, 'content/' + id); }
        else if (res.status === 412) { consoleStatus('error', res.body.message); appendReload(); }
        else consoleStatus('error', res.body.message || 'The action failed.');
      });
    }
    function ifMatchHeaders() {
      return { 'If-Match': '"' + c.version + '"', 'Idempotency-Key': 'action-' + id + '-' + Date.now() };
    }
    var form = $('#content-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var values = formValues(form);
        var payload = { title: values.title, slug: values.slug, summary: values.summary, body: values.body };
        consoleStatus('', 'Saving…');
        api('/api/console/content/' + id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'If-Match': '"' + c.version + '"', 'Idempotency-Key': 'patch-' + id + '-' + Date.now() },
          body: JSON.stringify(payload),
        }).then(function (res) {
          if (res.status === 200) { consoleStatus('success', 'Draft saved.'); renderContent(detail, 'content/' + id); }
          else if (res.status === 412) { consoleStatus('error', res.body.message); appendReload(); }
          else consoleStatus('error', res.body.message || 'Could not save.');
        });
      });
    }
    var submitReview = $('#submit-review');
    if (submitReview) {
      submitReview.addEventListener('click', function () {
        callAction('/api/console/content/' + id + '/submit', { method: 'POST', headers: ifMatchHeaders(), body: '{}' }, 'Submitted for review.');
      });
    }
    var approve = $('#approve-btn');
    if (approve) {
      approve.addEventListener('click', function () {
        callAction('/api/console/content/' + id + '/approve', { method: 'POST', headers: ifMatchHeaders(), body: '{}' }, 'Approved.');
      });
    }
    var returnBtn = $('#return-btn');
    if (returnBtn) {
      returnBtn.addEventListener('click', function () {
        var reason = window.prompt('Say what needs to change.');
        if (!reason) return;
        callAction('/api/console/content/' + id + '/return', {
          method: 'POST',
          headers: ifMatchHeaders(),
          body: JSON.stringify({ reason: reason }),
        }, 'Returned to author.');
      });
    }
    var scheduleBtn = $('#schedule-btn');
    if (scheduleBtn) {
      scheduleBtn.addEventListener('click', function () {
        var time = window.prompt('Release time (London), YYYY-MM-DDTHH:mm');
        if (!time) return;
        callAction('/api/console/content/' + id + '/schedule', {
          method: 'POST',
          headers: ifMatchHeaders(),
          body: JSON.stringify({ release_at_local: time }),
        }, 'Release scheduled for ' + time + ' London.');
      });
    }
    var releaseBtn = $('#release-btn');
    if (releaseBtn) {
      releaseBtn.addEventListener('click', function () {
        callAction('/api/console/content/' + id + '/release', { method: 'POST', headers: ifMatchHeaders(), body: '{}' }, 'Released.');
      });
    }
    var withdrawBtn = $('#withdraw-btn');
    if (withdrawBtn) {
      withdrawBtn.addEventListener('click', function () {
        if (!window.confirm('Withdraw this item?')) return;
        callAction('/api/console/content/' + id + '/withdraw', { method: 'POST', headers: ifMatchHeaders(), body: '{}' }, 'Withdrawn.');
      });
    }
    var commentForm = $('#comment-form');
    if (commentForm) {
      commentForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var body = commentForm.querySelector('[name="comment-body"]').value;
        callAction('/api/console/content/' + id + '/comments', {
          method: 'POST',
          headers: { 'Idempotency-Key': 'comment-' + id + '-' + Date.now() },
          body: JSON.stringify({ body: body }),
        }, 'Comment added.');
      });
    }
    ['safety', 'legal'].forEach(function (kind) {
      var button = $('#signoff-' + kind);
      if (button) {
        button.addEventListener('click', function () {
          callAction('/api/console/content/' + id + '/release-record/signoffs', {
            method: 'POST',
            headers: { 'Idempotency-Key': 'signoff-' + id + '-' + kind + '-' + Date.now() },
            body: JSON.stringify({ kind: kind, note: '' }),
          }, (kind === 'safety' ? 'Safety' : 'Legal') + ' sign-off recorded.');
        });
      }
    });
    var validate = $('#validate-claims');
    if (validate) {
      validate.addEventListener('click', function () {
        callAction('/api/console/content/' + id + '/release-record/validate-claims', {
          method: 'POST',
          headers: { 'Idempotency-Key': 'validate-' + id + '-' + Date.now() },
          body: '{}',
        }, 'Claims validated.');
      });
    }
    var clearBtn = $('#clear-record');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        callAction('/api/console/content/' + id + '/release-record/clear', {
          method: 'POST',
          headers: { 'Idempotency-Key': 'clear-' + id + '-' + Date.now() },
          body: '{}',
        }, 'Release record cleared.');
      });
    }
    var releaseStatus = $('#release-record-status');
    if (releaseStatus) {
      api('/api/console/content/' + id + '/release-record').then(function (res) {
        if (res.status === 200 && res.body.record) {
          releaseStatus.textContent = 'Status: ' + res.body.record.status;
        }
      });
    }
  }

  function rowField(name, label, value) {
    return '<div class="field"><label for="' + name + '">' + escapeHtmlText(label) + '</label>' +
      '<input type="text" id="' + name + '" name="' + name + '" value="' + escapeHtmlText(value || '') + '"></div>';
  }
  function rowSelect(name, label, options) {
    return '<div class="field"><label for="' + name + '">' + escapeHtmlText(label) + '</label><select id="' + name + '" name="' + name + '">' +
      options.map(function (o) { return '<option value="' + o + '">' + o + '</option>'; }).join('') + '</select></div>';
  }
  function formValues(form) {
    var out = {};
    $$('input, select, textarea', form).forEach(function (input) {
      if (input.name) out[input.name] = input.value;
    });
    return out;
  }
  function escapeHtmlText(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ------------------------------------------------------------- boot
  captureBarWidths();
  revealOnScroll();
  thesisProgress();
  chartEntry();
  claimTether();
  gallery();
  localizeTimes();
})();
