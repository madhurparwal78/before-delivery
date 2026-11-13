/* Northfall Reference Desk — public interactions.
   No third-party script runs; everything here is original. */

(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ------------------------------------------------ heading arrival lines
     A level-one heading arrives one line at a time, rising from behind a
     mask; a reduced-motion reader sees the end state at once. */

  function splitHeading(heading) {
    if (heading.dataset.split === "done") return;
    var text = heading.textContent;
    var width = heading.clientWidth || 1;
    var fontSize = parseFloat(getComputedStyle(heading).fontSize);
    var perChar = fontSize * 0.44;
    var charsPerLine = Math.max(6, Math.floor(width / perChar));
    var words = text.split(" ");
    var lines = [];
    var current = "";
    words.forEach(function (word) {
      var candidate = current ? current + " " + word : word;
      if (candidate.length > charsPerLine && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    });
    if (current) lines.push(current);
    heading.textContent = "";
    lines.forEach(function (line) {
      var span = document.createElement("span");
      span.className = "heading-line";
      span.textContent = line;
      heading.appendChild(span);
    });
    heading.dataset.split = "done";
  }

  document.querySelectorAll("[data-arrival]").forEach(splitHeading);

  /* ---------------------------------------------------------------- menu */

  var menuButton = document.querySelector(".menu-button");
  var primaryNav = document.querySelector(".primary-nav");

  function closeMenu(returnFocus) {
    if (!primaryNav || !primaryNav.classList.contains("open")) return;
    primaryNav.classList.remove("open");
    if (menuButton) menuButton.setAttribute("aria-expanded", "false");
    if (returnFocus && menuButton) menuButton.focus();
  }

  if (menuButton && primaryNav) {
    menuButton.addEventListener("click", function () {
      var open = primaryNav.classList.toggle("open");
      menuButton.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      if (primaryNav.classList.contains("open")) {
        closeMenu(true);
      } else if (cookieNotice && cookieNoticeShown &&
                 cookieNotice.contains(document.activeElement)) {
        dismissCookieNotice(true);
      }
    });
    primaryNav.addEventListener("click", function (event) {
      if (event.target.closest("a")) closeMenu(false);
    });
    // Crossing from narrow to a wider layout closes the menu state.
    var menuQuery = window.matchMedia("(max-width: 639px)");
    var onWidthChange = function (event) {
      if (!event.matches) {
        closeMenu(false);
        primaryNav.style.removeProperty("display");
      }
    };
    if (menuQuery.addEventListener) menuQuery.addEventListener("change", onWidthChange);
    else if (menuQuery.addListener) menuQuery.addListener(onWidthChange);
  }

  /* -------------------------------------------------------- cookie notice
     The only client-side state on public routes: one marker recording that
     the notice has been answered. It holds the answer, never an identity. */

  var cookieNotice = document.getElementById("cookie-notice");
  var cookieNoticeShown = false;

  function showCookieNotice() {
    if (!cookieNotice) return;
    cookieNotice.hidden = false;
    cookieNotice.classList.add("shown");
    cookieNoticeShown = true;
  }

  function dismissCookieNotice(moveFocus) {
    if (!cookieNotice) return;
    cookieNotice.classList.add("hiding");
    cookieNotice.classList.remove("shown");
    cookieNoticeShown = false;
    // A hidden element leaves the tab order and the accessibility tree from
    // the moment closing starts.
    setTimeout(function () {
      cookieNotice.hidden = true;
      cookieNotice.classList.remove("hiding");
    }, reduceMotion.matches ? 0 : 560);
    try { localStorage.setItem("northfall-cookie-answered", "1"); }
    catch (error) { /* private mode: the notice simply returns next visit */ }
    if (moveFocus) {
      var main = document.getElementById("main");
      if (main) main.focus();
    }
  }

  if (cookieNotice) {
    var answered = false;
    try { answered = localStorage.getItem("northfall-cookie-answered") === "1"; }
    catch (error) { /* read nothing */ }
    if (!answered) setTimeout(showCookieNotice, 400);
    var accept = cookieNotice.querySelector(".cookie-accept");
    var close = cookieNotice.querySelector(".cookie-close");
    if (accept) accept.addEventListener("click", function () { dismissCookieNotice(false); });
    if (close) close.addEventListener("click", function () { dismissCookieNotice(true); });
  }

  /* ------------------------------------------------------------ chapters
     With script running the first chapter starts open and the rest closed;
     with no script all are open and the buttons do nothing harmful. */

  var chapterButtons = document.querySelectorAll(".chapter-toggle");
  chapterButtons.forEach(function (button) {
    var body = document.getElementById(button.getAttribute("aria-controls"));
    if (!body) return;
    if (!body.hasAttribute("hidden") && !button.closest(".chapter").id) {
      /* already open server-side */
    }
    body.hidden = button.getAttribute("aria-expanded") !== "true";
    button.addEventListener("click", function () {
      var expanded = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!expanded));
      body.hidden = expanded;
    });
  });

  function openChapter(id, moveFocus) {
    chapterButtons.forEach(function (button) {
      if (button.closest(".chapter").id !== id) return;
      button.setAttribute("aria-expanded", "true");
      var body = document.getElementById(button.getAttribute("aria-controls"));
      if (body) body.hidden = false;
      if (moveFocus) button.focus();
    });
  }

  function chapterBelowHeader(id) {
    var chapter = document.getElementById(id);
    if (!chapter) return;
    var header = document.querySelector(".site-header");
    var top = header ? header.offsetHeight : 72;
    var y = chapter.getBoundingClientRect().top + window.scrollY - top - 20;
    window.scrollTo(0, Math.max(0, y));
  }

  var chapterNav = document.querySelector(".chapter-nav");
  if (chapterNav) {
    chapterNav.addEventListener("click", function (event) {
      var link = event.target.closest("a[href^='#']");
      if (!link) return;
      var id = link.getAttribute("href").slice(1);
      if (!document.getElementById(id)) return;
      event.preventDefault();
      openChapter(id, false);
      chapterBelowHeader(id);
      var button = document.querySelector('#' + CSS.escape(id) + ' .chapter-toggle');
      if (button) button.focus();
      history.pushState(null, "", "#" + id);
    });
  }

  function applyFragment(moveFocus) {
    var hash = decodeURIComponent(window.location.hash.slice(1));
    if (!hash || !document.getElementById(hash)) return;
    openChapter(hash, moveFocus);
    if (moveFocus) {
      requestAnimationFrame(function () { chapterBelowHeader(hash); });
    }
  }

  window.addEventListener("popstate", function () { applyFragment(true); });
  window.addEventListener("hashchange", function () { applyFragment(false); });
  applyFragment(false);
  if (window.location.hash) {
    requestAnimationFrame(function () { chapterBelowHeader(decodeURIComponent(window.location.hash.slice(1))); });
  }

  /* --------------------------------------------------------- copy buttons
     The confirmation lasts about two seconds from the latest activation,
     timed per card; focus stays on the button. */

  var COPY_LABELS = {
    copy: "Click to copy address",
    copied: "Copied to the clipboard",
    refused: "Copy not available"
  };
  if (document.documentElement.lang === "fi") {
    COPY_LABELS = {
      copy: "Kopioi osoite",
      copied: "Kopioitu leikepöydälle",
      refused: "Kopiointi ei onnistu"
    };
  }

  document.querySelectorAll(".copy-button").forEach(function (button) {
    var label = button.querySelector(".copy-label");
    var timer = null;
    var resting = COPY_LABELS.copy;

    function setText(text) {
      if (label) label.textContent = text;
      button.setAttribute("aria-label", text);
    }

    function confirmCopy(kind) {
      setText(COPY_LABELS[kind]);
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        setText(resting);
        timer = null;
      }, 2000);
    }

    button.addEventListener("click", function () {
      var address = button.dataset.address || "";
      var done = function () { confirmCopy("copied"); };
      var refused = function () {
        confirmCopy("refused");
        var card = button.closest(".directory-card");
        var text = card && card.querySelector(".address-text");
        if (text) {
          var range = document.createRange();
          range.selectNodeContents(text);
          var selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
        // selecting the address can move focus to the document; the
        // button keeps it, and focus never leaves the control
        button.focus();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(address).then(done, function () {
          if (document.execCommand) {
            tryCopyLegacy(address, done, refused);
          } else {
            refused();
          }
        });
      } else {
        tryCopyLegacy(address, done, refused);
      }
    });
  });

  function tryCopyLegacy(address, done, refused) {
    var input = document.createElement("textarea");
    input.value = address;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (error) { ok = false; }
    document.body.removeChild(input);
    if (ok) done(); else refused();
  }

  /* -------------------------------------------------------- enquiry form
     Five states: at rest, in flight, success, refused, outage. The alert
     region empties when each send begins, so a repeated result is a fresh
     change. A double click sends one request. */

  var form = document.getElementById("enquiry-form");
  var statusRegion = document.getElementById("enquiry-status");
  var alertRegion = document.getElementById("enquiry-alert");
  var fi = document.documentElement.lang === "fi";
  var inFlight = false;
  var fields = ["email", "phone", "reference", "agreed"];
  var errorCopy = {
    email: "Enter a work address the desk can reply to",
    phone: "Enter a telephone number of at least ten characters",
    reference: "Choose a reference from the library",
    agreed: "Tick the box to agree to the privacy statement"
  };
  var fiErrorCopy = {
    email: "Anna työosoite, johon toimisto voi vastata",
    phone: "Anna vähintään kymmenen merkin puhelinnumero",
    reference: "Valitse referenssi kirjastosta",
    agreed: "Hyväksy tietosuojaseloste valitsemalla ruutu"
  };
  var copy = fi ? {
    sending: "Lähetetään…",
    refused: "Tarkista merkityt kentät ja lähetä uudelleen.",
    outage: "Toimisto ei voi juuri nyt ottaa vastaan tiedusteluja. Mitään ei lähetetty; yritä pian uudelleen.",
    success: "Kiitos, toimisto vastaa osoitteesta hello@example.com",
    errors: fiErrorCopy
  } : {
    sending: "Sending…",
    refused: "Check the marked fields and send again.",
    outage: "The desk cannot take enquiries right now. Nothing was sent; please try again shortly.",
    success: "Thank you, the desk will reply from hello@example.com",
    errors: errorCopy
  };

  function clearFieldErrors() {
    fields.forEach(function (name) {
      var input = form.querySelector('[name="' + name + '"]');
      var error = document.getElementById("enquiry-" + name + "-error");
      if (input) input.removeAttribute("aria-invalid");
      if (error) {
        error.hidden = true;
        error.textContent = "";
        if (input) input.removeAttribute("aria-describedby");
      }
    });
  }

  function showFieldErrors(errors) {
    var first = null;
    fields.forEach(function (name) {
      var input = form.querySelector('[name="' + name + '"]');
      var error = document.getElementById("enquiry-" + name + "-error");
      var message = errors[name];
      if (!input || !error) return;
      if (message) {
        if (!first) first = input;
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", error.id);
        error.textContent = fi ? copy.errors[name] : message;
        error.hidden = false;
      }
    });
    if (first) first.focus();
  }

  if (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (inFlight) return;
      inFlight = true;
      var button = form.querySelector(".submit-button");
      var restingLabel = button.textContent;
      button.disabled = true;
      button.textContent = copy.sending;
      alertRegion.textContent = "";
      clearFieldErrors();

      var payload = {
        email: form.email.value,
        agreed: form.agreed.checked
      };
      if (form.phone.value) payload.phone = form.phone.value;
      var reference = form.reference.value;
      if (reference) payload.reference = reference;

      fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (response) {
        inFlight = false;
        button.disabled = false;
        button.textContent = restingLabel;
        if (response.status === 201) {
          statusRegion.textContent = copy.success;
          statusRegion.classList.add("filled");
          form.hidden = true;
          statusRegion.setAttribute("tabindex", "-1");
          statusRegion.focus();
          return null;
        }
        if (response.status === 422) {
          return response.json().then(function (data) {
            alertRegion.textContent = copy.refused;
            showFieldErrors(data.errors || {});
          });
        }
        if (response.status === 503) {
          alertRegion.textContent = copy.outage;
          return null;
        }
        alertRegion.textContent = copy.outage;
        return null;
      }).catch(function () {
        inFlight = false;
        button.disabled = false;
        button.textContent = restingLabel;
        alertRegion.textContent = copy.outage;
      });
    });
  }

  /* --------------------------------------------------- the home signature
     The promise line stays put while the featured strip travels upward:
     the line moves about a quarter as far as the strip over the first
     screen of scroll. Reduced motion holds the end state at once. */

  var hero = document.querySelector(".hero");
  var heroTitle = document.querySelector(".hero-title");
  var heroStrip = document.querySelector(".hero-strip");
  var heroInner = document.querySelector(".hero-inner");

  function scrollEffects() {
    if (!hero || !heroStrip || !heroTitle) return;
    if (reduceMotion.matches) {
      heroStrip.style.transform = "";
      heroTitle.style.transform = "";
      return;
    }
    var y = window.scrollY;
    var heroHeight = hero.offsetHeight || window.innerHeight;
    var progress = Math.min(1, Math.max(0, y / heroHeight));
    heroStrip.style.transform = "translateY(" + (-progress * heroHeight * 0.5) + "px)";
    heroTitle.style.transform = "translateY(" + (-progress * heroHeight * 0.125) + "px)";
    if (heroInner) heroInner.style.transform = "translateY(" + (-progress * heroHeight * 0.125) + "px)";
  }

  var ticking = false;
  window.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      scrollEffects();
      yearMarker();
      ticking = false;
    });
  }, { passive: true });

  /* ------------------------------------------------------- story year marker
     One year span shows at a time; it changes as each dated chapter
     crosses the middle of the window. With reduced motion every marker is
     printed beside its own chapter. */

  function yearMarker() {
    var markers = document.querySelectorAll(".year-marker span[data-year]");
    if (!markers.length) return;
    var chapters = document.querySelectorAll(".story-chapter");
    if (reduceMotion.matches) {
      markers.forEach(function (marker) { marker.hidden = false; });
      return;
    }
    if (!chapters.length) return;
    var mid = window.innerHeight / 2;
    var active = 0;
    chapters.forEach(function (chapter, index) {
      if (chapter.getBoundingClientRect().top <= mid) active = index;
    });
    markers.forEach(function (marker, index) {
      marker.hidden = index !== active;
    });
  }

  /* -------------------------------------------- live reduced-motion changes
     The preference is followed live, with no reload. */

  function onMotionChange() {
    scrollEffects();
    yearMarker();
  }
  if (reduceMotion.addEventListener) reduceMotion.addEventListener("change", onMotionChange);
  else if (reduceMotion.addListener) reduceMotion.addListener(onMotionChange);

  scrollEffects();
  yearMarker();
})();
