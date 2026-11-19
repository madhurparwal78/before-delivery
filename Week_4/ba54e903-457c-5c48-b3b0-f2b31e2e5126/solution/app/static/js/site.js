/* Page chrome shared by every public page: Menu, account link, language, cookie preferences, trackers,
   the home hero video, the word strip state and the rising feature blocks. */
(function () {
  'use strict';
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var YEAR = 31536000;

  function setCookie(name, value, seconds) {
    document.cookie = name + '=' + value + '; path=/; max-age=' + seconds + '; SameSite=Lax';
  }
  function getCookie(name) {
    var found = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return found ? found[1] : null;
  }
  function randomId() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  }

  /* Menu (phone layout) */
  (function menu() {
    var nav = $('#primary-nav');
    if (!nav) return;
    var toggle = $('.nav-toggle', nav);
    var desktop = window.matchMedia('(min-width: 768px)');
    function setOpen(open) {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    toggle.addEventListener('click', function () { setOpen(!nav.classList.contains('is-open')); });
    nav.addEventListener('click', function (event) {
      if (event.target.closest('.nav-links a')) setOpen(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        setOpen(false);
        toggle.focus();
      }
    });
    /* Leaving the phone layout, or coming back to it, always shows Menu closed. */
    desktop.addEventListener('change', function () { setOpen(false); });
    window.addEventListener('resize', function () { if (window.innerWidth >= 768) setOpen(false); });
  })();

  /* Account link follows the session */
  (function account() {
    var link = $('#nav-account');
    if (!link || !Hub.token()) return;
    link.textContent = 'Open Community Hub';
    link.setAttribute('href', Hub.lastChannel() || '/servers');
  })();

  /* Language */
  (function locale() {
    var select = $('#locale');
    if (!select) return;
    select.addEventListener('change', function () {
      setCookie('hub_locale', select.value, YEAR);
      document.documentElement.lang = select.value;
    });
  })();

  /* Cookie preferences and trackers */
  (function consent() {
    var panel = $('#consent');
    var opener = $('#cookie-open');
    var status = $('#cookie-status');
    var skip = $('.skip-link');
    var analytics = $('#consent-analytics');
    var marketing = $('#consent-marketing');
    var returnTo = null;

    function stored() {
      var found = /^analytics:([01])\|marketing:([01])$/.exec(getCookie('hub_consent') || '');
      return found ? { analytics: found[1] === '1', marketing: found[2] === '1' } : { analytics: false, marketing: false };
    }
    function pageView(visitor) {
      Hub.api('POST', '/api/analytics/pageview', { body: { path: location.pathname, visitor_id: visitor }, anonymous: true })
        .catch(function () { /* analytics is best effort */ });
    }
    function trackers(choice, fresh) {
      var visitor = getCookie('hub_aid');
      if (choice.analytics) {
        if (!visitor) { visitor = randomId(); setCookie('hub_aid', visitor, YEAR); fresh = true; }
        if (fresh) pageView(visitor);
      } else if (visitor) {
        setCookie('hub_aid', '', 0);
      }
      if (choice.marketing) {
        if (!getCookie('hub_mkt')) setCookie('hub_mkt', randomId(), YEAR);
      } else if (getCookie('hub_mkt')) {
        setCookie('hub_mkt', '', 0);
      }
    }
    function close() {
      panel.hidden = true;
      (returnTo || skip).focus();
      returnTo = null;
    }
    function save(choice) {
      setCookie('hub_consent', 'analytics:' + (choice.analytics ? 1 : 0) + '|marketing:' + (choice.marketing ? 1 : 0), YEAR);
      status.textContent = 'Cookie preferences saved.';
      trackers(choice, true);
      close();
    }
    opener.addEventListener('click', function () {
      var choice = stored();
      analytics.checked = choice.analytics;
      marketing.checked = choice.marketing;
      returnTo = opener;
      panel.hidden = false;
      analytics.focus();
    });
    $('#consent-accept').addEventListener('click', function () { save({ analytics: true, marketing: true }); });
    $('#consent-reject').addEventListener('click', function () { save({ analytics: false, marketing: false }); });
    $('#consent-save').addEventListener('click', function () { save({ analytics: analytics.checked, marketing: marketing.checked }); });
    panel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    });
    if (getCookie('hub_consent')) trackers(stored(), true);
  })();

  /* Home: hero video, word strip, rising feature blocks */
  (function home() {
    var video = $('#hero-video');
    if (!video) return;
    var toggle = $('#hero-toggle');
    function label() { toggle.textContent = video.paused ? 'Play background video' : 'Pause background video'; }
    ['play', 'pause', 'emptied'].forEach(function (name) { video.addEventListener(name, label); });
    toggle.addEventListener('click', function () {
      if (video.paused) video.play().catch(function () { /* the visitor can press again */ }); else video.pause();
    });
    function follow() {
      if (reduced.matches) {
        video.removeAttribute('autoplay');
        video.pause();
        video.load();
      }
      label();
    }
    reduced.addEventListener('change', follow);
    label();

    var items = Array.prototype.slice.call(document.querySelectorAll('[data-rise]'));
    var wide = window.matchMedia('(min-width: 768px)');
    /* Its own query object: reading .matches every frame on the shared one would swallow its change event. */
    var still = window.matchMedia('(prefers-reduced-motion: reduce)');
    var styled = false;
    function frame() {
      if (wide.matches && !still.matches) {
        var height = window.innerHeight;
        items.forEach(function (item) {
          var offset = item._y || 0;
          var top = item.getBoundingClientRect().top - offset;
          var progress = Math.min(1, Math.max(0, (height - top) / (height / 3)));
          if (item._p !== progress) {
            var y = (1 - progress) * 24;
            item.style.opacity = String(progress);
            item.style.transform = y ? 'translateY(' + y + 'px)' : 'none';
            item._p = progress;
            item._y = y;
          }
        });
        styled = true;
      } else if (styled) {
        items.forEach(function (item) {
          item.style.opacity = '';
          item.style.transform = '';
          item._p = null;
          item._y = 0;
        });
        styled = false;
      }
      window.requestAnimationFrame(frame);
    }
    window.requestAnimationFrame(frame);
  })();
})();
