/* Site chrome: the Agents menu, the Menu button, the cookie preferences,
   the home narrative, the use-case carousel and the tools strip. Everything
   runs from this origin only. */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  function byId(id) { return document.getElementById(id); }

  /* Agents menu */

  var agentsButton = byId("agents-button");
  var agentsMenu = byId("agents-menu");

  function openAgents(open) {
    agentsButton.setAttribute("aria-expanded", open ? "true" : "false");
    agentsMenu.classList.toggle("open", open);
  }

  if (agentsButton) {
    agentsButton.addEventListener("click", function () {
      var open = agentsButton.getAttribute("aria-expanded") === "true";
      openAgents(!open);
    });
    document.addEventListener("click", function (event) {
      if (!agentsMenu.contains(event.target) &&
          event.target !== agentsButton) {
        openAgents(false);
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" &&
          agentsButton.getAttribute("aria-expanded") === "true") {
        openAgents(false);
        agentsButton.focus();
      }
    });
    agentsMenu.addEventListener("keydown", function (event) {
      if (event.key === "Tab") {
        var links = agentsMenu.querySelectorAll("a");
        var last = links[links.length - 1];
        if (event.target === last && !event.shiftKey) {
          openAgents(false);
        }
      }
    });
  }

  /* Menu button, below 1024 wide */

  var menuButton = byId("menu-button");
  var mainNav = byId("main-nav");

  if (menuButton && mainNav) {
    menuButton.addEventListener("click", function () {
      var open = mainNav.classList.toggle("open");
      menuButton.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && mainNav.classList.contains("open")) {
        mainNav.classList.remove("open");
        menuButton.setAttribute("aria-expanded", "false");
        menuButton.focus();
      }
    });
  }

  /* Cookie preferences */

  var COOKIE_NAME = "relayo-cookie-choice";

  function readChoice() {
    var parts = document.cookie.split(";");
    for (var i = 0; i < parts.length; i += 1) {
      var pair = parts[i].trim();
      if (pair.indexOf(COOKIE_NAME + "=") === 0) {
        try {
          return JSON.parse(decodeURIComponent(
            pair.slice(COOKIE_NAME.length + 1)
          ));
        } catch (err) {
          return null;
        }
      }
    }
    return null;
  }

  function writeChoice(value) {
    var text = encodeURIComponent(JSON.stringify(value));
    document.cookie = COOKIE_NAME + "=" + text +
      "; path=/; max-age=31536000; SameSite=Lax";
  }

  var cookiePanel = byId("cookie-panel");
  var cookieDialog = byId("cookie-dialog");
  var choiceView = byId("cookie-choice-view");
  var settingsView = byId("cookie-settings-view");
  var footerCookieButton = byId("footer-cookie-button");
  var opener = null;

  function showPanel() {
    if (cookiePanel) {
      cookiePanel.hidden = false;
      requestAnimationFrame(function () {
        cookiePanel.classList.add("open");
      });
    }
  }

  function hidePanel() {
    if (cookiePanel) {
      cookiePanel.classList.remove("open");
      cookiePanel.hidden = true;
    }
  }

  function showSettings() {
    choiceView.hidden = true;
    settingsView.hidden = false;
  }

  function showChoice() {
    settingsView.hidden = true;
    choiceView.hidden = false;
  }

  function openDialog() {
    opener = document.activeElement;
    var saved = readChoice();
    byId("cat-performance").checked = !!(saved && saved.performance);
    byId("cat-functional").checked = !!(saved && saved.functional);
    byId("cat-targeting").checked = !!(saved && saved.targeting);
    showChoice();
    cookieDialog.hidden = false;
    cookieDialog.classList.add("open");
    byId("dialog-settings-button").focus();
  }

  function closeDialog() {
    cookieDialog.classList.remove("open");
    cookieDialog.hidden = true;
    if (opener) { opener.focus(); }
  }

  function saveChoice(performance, functional, targeting) {
    writeChoice({
      performance: performance,
      functional: functional,
      targeting: targeting,
    });
  }

  function bind(id, handler) {
    var element = byId(id);
    if (element) { element.addEventListener("click", handler); }
  }

  bind("cookie-settings-button", function () { openDialog(); });
  bind("cookie-reject-button", function () {
    saveChoice(false, false, false); hidePanel();
  });
  bind("cookie-accept-button", function () {
    saveChoice(true, true, true); hidePanel();
  });
  bind("footer-cookie-button", function () { openDialog(); });
  bind("dialog-settings-button", function () { showSettings(); });
  bind("dialog-reject-button", function () {
    saveChoice(false, false, false); closeDialog();
  });
  bind("dialog-accept-button", function () {
    saveChoice(true, true, true); closeDialog();
  });
  bind("cookie-confirm-button", function () {
    saveChoice(
      byId("cat-performance").checked,
      byId("cat-functional").checked,
      byId("cat-targeting").checked
    );
    closeDialog();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && cookieDialog &&
        !cookieDialog.hidden) {
      closeDialog();
    }
  });

  cookieDialog.addEventListener("click", function (event) {
    if (event.target === cookieDialog) { closeDialog(); }
  });

  if (readChoice() === null) {
    showPanel();
  }

  /* The current use case announcement (home) */

  var track = byId("carousel-track");
  var slides = track ? Array.prototype.slice.call(
    track.querySelectorAll(".carousel-slide")
  ) : [];
  var currentStatus = byId("current-use-case");
  var current = 0;
  var names = ["Sales Agent", "Education Agent", "Media Agent",
               "SDR Agent", "Recruiting Agent"];

  function announce() {
    if (currentStatus) {
      currentStatus.textContent = "Use case " + (current + 1) + " of " +
        slides.length + ": " + names[current];
    }
  }

  function showSlide(index) {
    current = Math.max(0, Math.min(slides.length - 1, index));
    slides.forEach(function (slide, position) {
      slide.hidden = position !== current;
    });
    var dots = document.querySelectorAll(".dot");
    dots.forEach(function (dot, position) {
      dot.classList.toggle("current", position === current);
    });
    byId("prev-use-case").setAttribute(
      "aria-disabled", current === 0 ? "true" : "false"
    );
    byId("next-use-case").setAttribute(
      "aria-disabled", current === slides.length - 1 ? "true" : "false"
    );
    announce();
  }

  if (track) {
    byId("prev-use-case").addEventListener("click", function () {
      showSlide(current - 1);
    });
    byId("next-use-case").addEventListener("click", function () {
      showSlide(current + 1);
    });
    track.closest(".carousel").addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft") { showSlide(current - 1); }
      if (event.key === "ArrowRight") { showSlide(current + 1); }
    });
    /* Touch: one slide per qualifying horizontal swipe; a vertical swipe
       scrolls the page as usual. */
    var startX = 0;
    var startY = 0;
    track.addEventListener("touchstart", function (event) {
      if (event.touches.length === 1) {
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
      }
    }, { passive: true });
    track.addEventListener("touchend", function (event) {
      var touch = event.changedTouches[0];
      var dx = touch.clientX - startX;
      var dy = touch.clientY - startY;
      if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)) {
        showSlide(dx < 0 ? current + 1 : current - 1);
      }
    }, { passive: true });
    showSlide(0);
  }

  /* The before, during and after narrative (home) */

  var narrative = byId("narrative");
  if (narrative) {
    var panels = [
      byId("step-panel-0"), byId("step-panel-1"), byId("step-panel-2"),
    ];
    var progress = document.createElement("div");
    progress.className = "progress-line";
    var list = byId("step-list");
    list.insertBefore(progress, list.firstChild);

    function markCurrent(step) {
      for (var index = 0; index < 3; index += 1) {
        var item = list.children[index + 1];
        if (!item) { break; }
        if (index === step) {
          item.setAttribute("aria-current", "step");
        } else {
          item.removeAttribute("aria-current");
        }
      }
    }

    function stackedMode() {
      return window.matchMedia("(max-width: 767px)").matches;
    }

    function updateNarrative() {
      var section = narrative.getBoundingClientRect();
      var viewport = window.innerHeight;
      if (stackedMode() || reduced.matches) {
        /* Stacked: each panel shows at once; the current step is the one
           crossing the middle of the viewport. */
        var middle = viewport / 2;
        var current = -1;
        panels.forEach(function (panel, index) {
          var box = panel.getBoundingClientRect();
          panel.hidden = false;
          if (box.top <= middle && box.bottom >= middle) { current = index; }
        });
        if (current === -1) {
          current = section.top > middle ? 0 : 2;
        }
        markCurrent(current);
        progress.style.height = "0";
        return;
      }
      var distance = section.height - viewport;
      var scrolled = Math.min(
        Math.max(viewport - section.top, 0), distance
      );
      var third = distance / 3;
      var step = Math.min(2, Math.floor(scrolled / third));
      markCurrent(step);
      progress.style.height = (scrolled / distance) * 100 + "%";
      panels.forEach(function (panel, index) {
        panel.hidden = index !== step;
      });
    }

    panels.forEach(function (panel) { panel.hidden = false; });
    window.addEventListener("scroll", updateNarrative, { passive: true });
    window.addEventListener("resize", updateNarrative);
    updateNarrative();
  }

  /* The connected-tools strip (the one named loop) */

  var pauseButton = byId("pause-tools");
  var strip = document.querySelector(".tools-strip");
  if (pauseButton && strip) {
    pauseButton.addEventListener("click", function () {
      var paused = strip.classList.toggle("paused");
      pauseButton.textContent = paused ? "Play tool strip" :
        "Pause tool strip";
    });
  }

  /* Keep focused elements clear of the sticky header and the cookie panel */

  document.addEventListener("focusin", function (event) {
    var target = event.target;
    if (!target.getBoundingClientRect) { return; }
    var box = target.getBoundingClientRect();
    var header = document.querySelector(".site-header");
    var headerHeight = header ? header.getBoundingClientRect().bottom : 0;
    var panelHeight = cookiePanel && !cookiePanel.hidden ?
      window.innerHeight - cookiePanel.getBoundingClientRect().top : 0;
    var pad = 12;
    if (box.top < headerHeight + pad) {
      window.scrollBy({ top: box.top - headerHeight - pad,
        behavior: reduced.matches ? "auto" : "smooth" });
    } else if (box.bottom > window.innerHeight - panelHeight - pad) {
      window.scrollBy({ top: box.bottom - (window.innerHeight -
        panelHeight - pad),
        behavior: reduced.matches ? "auto" : "smooth" });
    }
  });
}());
