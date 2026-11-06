/* Relayo: header menus, cookie preferences, focus care, carousel, narrative, strip. */
(function () {
  "use strict";

  const data = readPageData();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  function readPageData() {
    const node = document.getElementById("page-data");
    if (!node) return {};
    try {
      return JSON.parse(node.textContent || "{}");
    } catch (error) {
      return {};
    }
  }

  /* ---------- focus is never hidden ---------- */

  const cookiePanel = document.getElementById("cookie-panel");

  function obstructions() {
    const header = document.querySelector(".site-header");
    const top = header ? header.getBoundingClientRect().bottom : 0;
    let bottom = window.innerHeight;
    if (cookiePanel && !cookiePanel.hidden) {
      bottom = Math.min(bottom, cookiePanel.getBoundingClientRect().top);
    }
    return { top: top, bottom: bottom };
  }

  function ensureVisible(element) {
    if (!element || typeof element.getBoundingClientRect !== "function") return;
    const header = document.querySelector(".site-header");
    if ((header && header.contains(element)) || (cookiePanel && cookiePanel.contains(element))) {
      return;
    }
    const edges = obstructions();
    const rect = element.getBoundingClientRect();
    const margin = 8;
    let delta = 0;
    if (rect.top < edges.top + margin) {
      delta = rect.top - edges.top - margin;
    } else if (rect.bottom > edges.bottom - margin) {
      delta = Math.min(rect.bottom - edges.bottom + margin, rect.top - edges.top - margin);
    }
    if (delta !== 0) window.scrollBy(0, delta);
  }

  function ensureVisibleSoon(element) {
    // Correct now, then again once the browser's own scroll-into-view has settled.
    ensureVisible(element);
    window.requestAnimationFrame(function () {
      ensureVisible(element);
    });
  }

  window.relayoEnsureVisible = ensureVisible;

  document.addEventListener("focusin", function (event) {
    if (event.target === document.body) return;
    ensureVisibleSoon(event.target);
  });

  /* ---------- disclosure menus ---------- */

  function disclosure(buttonId, panelId, openAttribute) {
    const button = document.getElementById(buttonId);
    const panel = document.getElementById(panelId);
    if (!button || !panel) return null;

    function isOpen() {
      return button.getAttribute("aria-expanded") === "true";
    }

    function setOpen(open) {
      button.setAttribute("aria-expanded", open ? "true" : "false");
      if (openAttribute === "hidden") {
        panel.hidden = !open;
      } else if (open) {
        panel.setAttribute("data-open", "true");
      } else {
        panel.removeAttribute("data-open");
      }
    }

    button.addEventListener("click", function () {
      setOpen(!isOpen());
    });

    function close(returnFocus) {
      if (!isOpen()) return;
      setOpen(false);
      if (returnFocus) button.focus();
    }

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !isOpen()) return;
      if (button === document.activeElement || panel.contains(document.activeElement)) {
        event.stopPropagation();
        close(true);
      }
    });

    document.addEventListener("focusout", function () {
      window.setTimeout(function () {
        if (!isOpen()) return;
        const active = document.activeElement;
        if (active === button || panel.contains(active)) return;
        if (active === document.body) return;
        close(false);
      }, 0);
    });

    document.addEventListener("pointerdown", function (event) {
      if (!isOpen()) return;
      if (button.contains(event.target) || panel.contains(event.target)) return;
      close(false);
    });

    return { close: close, isOpen: isOpen };
  }

  disclosure("agents-button", "agents-menu", "hidden");
  disclosure("menu-button", "site-panel", "data-open");

  /* ---------- cookie preferences ---------- */

  const COOKIE_NAME = "relayo_cookies";

  function readChoice() {
    const found = document.cookie.split("; ").find(function (entry) {
      return entry.indexOf(COOKIE_NAME + "=") === 0;
    });
    if (!found) return null;
    try {
      return JSON.parse(decodeURIComponent(found.slice(COOKIE_NAME.length + 1)));
    } catch (error) {
      return null;
    }
  }

  function writeChoice(choice) {
    const value = encodeURIComponent(JSON.stringify(choice));
    document.cookie =
      COOKIE_NAME + "=" + value + "; path=/; max-age=31536000; SameSite=Lax";
  }

  (function cookies() {
    if (!cookiePanel) return;
    const settings = document.getElementById("cookie-settings");
    const settingsButton = document.getElementById("cookie-settings-button");
    const rejectButton = document.getElementById("cookie-reject");
    const acceptButton = document.getElementById("cookie-accept");
    const confirmButton = document.getElementById("cookie-confirm");
    const reopenButton = document.getElementById("cookie-reopen");
    const boxes = {
      performance: document.getElementById("cookie-performance"),
      functional: document.getElementById("cookie-functional"),
      targeting: document.getElementById("cookie-targeting"),
    };
    let dismissible = false;

    function measure() {
      const height = cookiePanel.hidden ? 0 : cookiePanel.offsetHeight;
      document.documentElement.style.setProperty("--cookie-h", height + "px");
    }

    function show(fromFooter) {
      const choice = readChoice() || { performance: false, functional: false, targeting: false };
      Object.keys(boxes).forEach(function (key) {
        if (boxes[key]) boxes[key].checked = Boolean(choice[key]);
      });
      settings.hidden = !fromFooter;
      confirmButton.hidden = !fromFooter;
      dismissible = Boolean(fromFooter);
      cookiePanel.hidden = false;
      measure();
    }

    function hide(returnFocus) {
      cookiePanel.hidden = true;
      measure();
      if (returnFocus && reopenButton) reopenButton.focus();
    }

    function save(choice) {
      writeChoice(choice);
      hide(dismissible);
    }

    settingsButton.addEventListener("click", function () {
      settings.hidden = false;
      confirmButton.hidden = false;
      measure();
    });
    rejectButton.addEventListener("click", function () {
      save({ performance: false, functional: false, targeting: false });
    });
    acceptButton.addEventListener("click", function () {
      save({ performance: true, functional: true, targeting: true });
    });
    confirmButton.addEventListener("click", function () {
      save({
        performance: Boolean(boxes.performance && boxes.performance.checked),
        functional: Boolean(boxes.functional && boxes.functional.checked),
        targeting: Boolean(boxes.targeting && boxes.targeting.checked),
      });
    });
    if (reopenButton) {
      reopenButton.addEventListener("click", function () {
        show(true);
        settingsButton.focus();
      });
    }
    cookiePanel.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && dismissible) hide(true);
    });
    window.addEventListener("resize", measure);

    if (readChoice() === null) show(false);
  })();

  /* ---------- home carousel ---------- */

  (function carousel() {
    const track = document.getElementById("slide-track");
    if (!track) return;
    const slides = Array.prototype.slice.call(track.querySelectorAll(".slide"));
    const previous = document.getElementById("usecase-prev");
    const next = document.getElementById("usecase-next");
    const status = document.getElementById("usecase-status");
    const dots = Array.prototype.slice.call(document.querySelectorAll(".dot"));
    const names = data.slides || [];
    let index = 0;

    function render() {
      track.style.transform = "translateX(" + -index * 100 + "%)";
      slides.forEach(function (slide, position) {
        const current = position === index;
        if (current) {
          slide.removeAttribute("inert");
          slide.removeAttribute("aria-hidden");
        } else {
          slide.setAttribute("inert", "");
          slide.setAttribute("aria-hidden", "true");
        }
      });
      dots.forEach(function (dot, position) {
        dot.classList.toggle("dot-on", position === index);
      });
      setDisabled(previous, index === 0);
      setDisabled(next, index === slides.length - 1);
      if (status) {
        status.textContent =
          "Use case " + (index + 1) + " of " + slides.length + ": " + (names[index] || "");
      }
    }

    function setDisabled(button, disabled) {
      if (!button) return;
      if (disabled) button.setAttribute("aria-disabled", "true");
      else button.removeAttribute("aria-disabled");
    }

    function move(step) {
      const wanted = index + step;
      if (wanted < 0 || wanted > slides.length - 1) return;
      index = wanted;
      render();
    }

    previous.addEventListener("click", function () {
      move(-1);
    });
    next.addEventListener("click", function () {
      move(1);
    });

    const region = track.closest(".usecases");
    region.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft") {
        move(-1);
      } else if (event.key === "ArrowRight") {
        move(1);
      }
    });

    let startX = 0;
    let startY = 0;
    let tracking = false;
    const viewport = track.parentElement;
    viewport.addEventListener(
      "touchstart",
      function (event) {
        if (event.touches.length !== 1) return;
        tracking = true;
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
      },
      { passive: true }
    );
    viewport.addEventListener(
      "touchend",
      function (event) {
        if (!tracking) return;
        tracking = false;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        if (Math.abs(dx) < 50 || Math.abs(dx) <= Math.abs(dy)) return;
        move(dx < 0 ? 1 : -1);
      },
      { passive: true }
    );

    render();
  })();

  /* ---------- before, during and after ---------- */

  (function narrative() {
    const section = document.getElementById("narrative");
    if (!section) return;
    const steps = Array.prototype.slice.call(section.querySelectorAll(".step"));
    const panels = Array.prototype.slice.call(section.querySelectorAll(".step-panel"));
    const progress = document.getElementById("narrative-progress");
    let current = -1;

    function heldMode() {
      return window.matchMedia("(min-width: 768px)").matches && !reduced.matches;
    }

    function fromThirds() {
      const rect = section.getBoundingClientRect();
      const span = section.offsetHeight - window.innerHeight;
      const travelled = span > 0 ? (-rect.top) / span : 0;
      const ratio = Math.min(Math.max(travelled, 0), 1);
      if (progress) progress.style.width = ratio * 100 + "%";
      return Math.min(2, Math.max(0, Math.floor(ratio * 3)));
    }

    function fromMiddle() {
      const middle = window.innerHeight / 2;
      let best = 0;
      let bestDistance = Infinity;
      panels.forEach(function (panel, position) {
        const rect = panel.getBoundingClientRect();
        if (rect.top <= middle && rect.bottom >= middle) {
          best = position;
          bestDistance = 0;
          return;
        }
        const distance = Math.min(Math.abs(rect.top - middle), Math.abs(rect.bottom - middle));
        if (distance < bestDistance) {
          bestDistance = distance;
          best = position;
        }
      });
      return best;
    }

    function update() {
      const index = heldMode() ? fromThirds() : fromMiddle();
      if (index === current) return;
      current = index;
      steps.forEach(function (step, position) {
        if (position === index) step.setAttribute("aria-current", "step");
        else step.removeAttribute("aria-current");
      });
      panels.forEach(function (panel, position) {
        panel.setAttribute("data-current", position === index ? "true" : "false");
      });
    }

    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    reduced.addEventListener("change", update);
    update();
  })();

  /* ---------- connected tools strip ---------- */

  (function toolStrip() {
    const strip = document.getElementById("tool-strip");
    const button = document.getElementById("tool-pause");
    if (!strip || !button) return;
    let paused = false;

    function apply() {
      strip.setAttribute("data-paused", paused ? "true" : "false");
      button.textContent = paused ? "Play tool strip" : "Pause tool strip";
    }

    button.addEventListener("click", function () {
      paused = !paused;
      apply();
    });
    ["pointerenter", "focusin"].forEach(function (name) {
      strip.addEventListener(name, function () {
        strip.setAttribute("data-hover", "true");
        if (!paused) strip.setAttribute("data-paused", "true");
      });
    });
    ["pointerleave", "focusout"].forEach(function (name) {
      strip.addEventListener(name, function () {
        strip.removeAttribute("data-hover");
        if (!paused) strip.setAttribute("data-paused", "false");
      });
    });
    apply();
  })();
})();
