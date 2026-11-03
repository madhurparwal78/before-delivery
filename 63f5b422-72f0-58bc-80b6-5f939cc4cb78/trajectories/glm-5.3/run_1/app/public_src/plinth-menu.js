// Menu disclosure on published pages: collapses each nav below 768px.
(function () {
  'use strict';
  var navs = document.querySelectorAll('nav[aria-label="Site"]');
  navs.forEach(function (nav) {
    var navId = nav.id || 'site-nav';
    nav.id = navId;
    var listId = navId + '-links';
    var list = document.createElement('div');
    list.id = listId;
    list.className = 'pl-navlinks';
    while (nav.firstChild) list.appendChild(nav.firstChild);
    nav.appendChild(list);
    var button = document.createElement('button');
    button.textContent = 'Menu';
    button.className = 'pl-menu-button';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', listId);
    nav.insertBefore(button, list);

    var motionState = 'closed';
    var progress = 0;
    var raf = null;
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function apply(p) {
      list.style.opacity = String(p);
      list.style.transform = 'scale(' + (0.95 + 0.05 * p) + ')';
    }
    function setCollapsed(collapsed) {
      nav.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
      list.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
      list.style.pointerEvents = collapsed ? 'none' : '';
      if (collapsed) {
        list.style.visibility = 'hidden';
        list.querySelectorAll('a').forEach(function (a) { a.tabIndex = -1; });
      } else {
        list.style.visibility = 'visible';
        list.querySelectorAll('a').forEach(function (a) { a.tabIndex = 0; });
      }
    }

    function updateByViewport() {
      var phone = window.matchMedia('(max-width: 767.98px)').matches;
      if (!phone) {
        // wide: links always show, no menu button
        button.style.display = 'none';
        list.style.visibility = 'visible';
        list.style.opacity = '1';
        list.style.transform = 'none';
        list.setAttribute('aria-hidden', 'false');
        list.querySelectorAll('a').forEach(function (a) { a.tabIndex = 0; });
        nav.removeAttribute('data-collapsed');
        return;
      }
      button.style.display = '';
      setCollapsed(motionState !== 'open');
      apply(motionState === 'open' ? 1 : 0);
    }

    button.addEventListener('click', function () {
      var opening = motionState !== 'open' && motionState !== 'opening';
      var target = opening;
      if (raf) cancelAnimationFrame(raf);
      if (reduced) {
        motionState = target ? 'open' : 'closed';
        progress = target ? 1 : 0;
        nav.setAttribute('data-motion', motionState);
        nav.setAttribute('data-progress', progress.toFixed(2));
        setCollapsed(!target);
        apply(target ? 1 : 0);
        button.setAttribute('aria-expanded', target ? 'true' : 'false');
        return;
      }
      var from = progress;
      var to = target ? 1 : 0;
      var ms = Math.round(Math.abs(to - from) * 200);
      var start = performance.now();
      motionState = target ? 'opening' : 'closing';
      nav.setAttribute('data-motion', motionState);
      setCollapsed(false);
      var step = function () {
        var t = ms <= 0 ? 1 : Math.min(1, (performance.now() - start) / ms);
        progress = from + (to - from) * t;
        nav.setAttribute('data-progress', progress.toFixed(2));
        apply(progress);
        if (t >= 1) {
          motionState = target ? 'open' : 'closed';
          nav.setAttribute('data-motion', motionState);
          setCollapsed(!target);
          raf = null;
          return;
        }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      button.setAttribute('aria-expanded', target ? 'true' : 'false');
    });

    button.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && motionState === 'open') {
        e.preventDefault();
        button.click();
        button.focus();
      }
    });

    updateByViewport();
    window.addEventListener('resize', updateByViewport);
  });
})();
