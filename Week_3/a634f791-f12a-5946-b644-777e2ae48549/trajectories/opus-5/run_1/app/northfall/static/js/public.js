/* Public-page behaviour. Every page reads correctly before this runs. */
(function () {
  "use strict";

  var root = document.documentElement;
  var header = document.querySelector(".site-header");
  var main = document.getElementById("main");
  var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  var wideQuery = window.matchMedia("(min-width: 640px)");
  var COOKIE_KEY = "northfall.cookie-notice";

  function reduced() {
    return motionQuery.matches;
  }

  /* ---------- the fixed header and the room the notice needs ---------- */

  function measureHeader() {
    if (!header) return;
    root.classList.remove("header-static");
    var height = header.offsetHeight;
    if (height > window.innerHeight * 0.3) {
      // Enlarged text can make the header taller than the reading area, and a
      // fixed header that deep would hide whatever takes focus beneath it.
      root.classList.add("header-static");
      height = 0;
    }
    root.style.setProperty("--header-h", height + "px");
  }

  function noticeSpace(px) {
    root.style.setProperty("--notice-space", px + "px");
  }

  /* ---------- keeping every keyboard stop in the clear ---------- */

  function floatingBottom() {
    var notice = document.querySelector("[data-cookie-notice]");
    if (!notice || notice.hidden || notice.inert) return window.innerHeight;
    var rect = notice.getBoundingClientRect();
    return rect.height ? rect.top : window.innerHeight;
  }

  function keepClear(element) {
    if (!element || !element.getBoundingClientRect) return;
    if (header && header.contains(element)) return;
    var notice = document.querySelector("[data-cookie-notice]");
    if (notice && notice.contains(element)) return;
    var rect = element.getBoundingClientRect();
    if (!rect.height && !rect.width) return;
    var top = header ? header.getBoundingClientRect().bottom + 8 : 8;
    var bottom = floatingBottom() - 8;
    if (rect.top < top) {
      window.scrollBy(0, rect.top - top);
    } else if (rect.bottom > bottom && rect.height < bottom - top) {
      window.scrollBy(0, rect.bottom - bottom);
    }
  }

  document.addEventListener("focusin", function (event) {
    window.requestAnimationFrame(function () {
      keepClear(event.target);
    });
  });

  /* ---------- the cookie notice ---------- */

  function setUpCookieNotice() {
    var notice = document.querySelector("[data-cookie-notice]");
    if (!notice) return;
    var answered = false;
    try {
      answered = !!window.localStorage.getItem(COOKIE_KEY);
    } catch (error) {
      answered = false;
    }
    if (answered) {
      notice.hidden = true;
      return;
    }
    root.classList.remove("cookie-answered");
    window.requestAnimationFrame(function () {
      notice.classList.add("is-shown");
      noticeSpace(notice.offsetHeight + 24);
    });
    new window.ResizeObserver(function () {
      if (!notice.inert && !notice.hidden) noticeSpace(notice.offsetHeight + 24);
    }).observe(notice);

    function dismiss() {
      notice.setAttribute("aria-hidden", "true");
      notice.inert = true;
      notice.classList.remove("is-shown");
      noticeSpace(0);
      try {
        window.localStorage.setItem(COOKIE_KEY, "answered");
      } catch (error) {
        /* a browser that refuses storage simply shows the notice again */
      }
      if (reduced()) {
        notice.hidden = true;
      } else {
        window.setTimeout(function () {
          if (notice.inert) notice.hidden = true;
        }, 700);
      }
      if (main) main.focus();
    }

    notice.querySelector("[data-cookie-accept]").addEventListener("click", dismiss);
    notice.querySelector("[data-cookie-close]").addEventListener("click", dismiss);
    notice.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      }
    });
  }

  /* ---------- the folded navigation ---------- */

  function setUpMenu() {
    var button = document.querySelector("[data-menu-button]");
    var panel = document.querySelector("[data-menu-panel]");
    if (!button || !panel) return;

    function setOpen(open) {
      button.setAttribute("aria-expanded", open ? "true" : "false");
      panel.classList.toggle("is-open", open);
    }

    button.addEventListener("click", function () {
      setOpen(button.getAttribute("aria-expanded") !== "true");
    });
    panel.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        setOpen(false);
        button.focus();
      }
    });
    button.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        setOpen(false);
        button.focus();
      }
    });
    wideQuery.addEventListener("change", function () {
      setOpen(false);
    });
  }

  /* ---------- chapter panels ---------- */

  function setUpChapters() {
    var chapters = Array.prototype.slice.call(document.querySelectorAll("[data-chapter]"));
    if (!chapters.length) return;

    function parts(chapter) {
      return {
        toggle: chapter.querySelector("[data-chapter-toggle]"),
        body: chapter.querySelector("[data-chapter-body]")
      };
    }

    function open(chapter, animate) {
      var bits = parts(chapter);
      bits.toggle.setAttribute("aria-expanded", "true");
      var body = bits.body;
      body.hidden = false;
      body.inert = false;
      body.removeAttribute("aria-hidden");
      if (!animate || reduced()) {
        body.style.height = "auto";
        return;
      }
      var target = body.scrollHeight;
      body.style.height = "0px";
      window.requestAnimationFrame(function () {
        body.style.height = target + "px";
      });
      body.addEventListener("transitionend", function done(event) {
        if (event.propertyName !== "height") return;
        body.removeEventListener("transitionend", done);
        if (!body.inert) body.style.height = "auto";
      });
    }

    function close(chapter, animate) {
      var bits = parts(chapter);
      bits.toggle.setAttribute("aria-expanded", "false");
      var body = bits.body;
      body.setAttribute("aria-hidden", "true");
      body.inert = true;
      if (!animate || reduced()) {
        body.hidden = true;
        body.style.height = "";
        return;
      }
      body.style.height = body.scrollHeight + "px";
      window.requestAnimationFrame(function () {
        body.style.height = "0px";
      });
      body.addEventListener("transitionend", function done(event) {
        if (event.propertyName !== "height") return;
        body.removeEventListener("transitionend", done);
        if (body.inert) {
          body.hidden = true;
          body.style.height = "";
        }
      });
    }

    chapters.forEach(function (chapter, position) {
      var bits = parts(chapter);
      if (position === 0) {
        open(chapter, false);
      } else {
        close(chapter, false);
      }
      bits.toggle.addEventListener("click", function () {
        if (bits.toggle.getAttribute("aria-expanded") === "true") {
          close(chapter, true);
        } else {
          open(chapter, true);
        }
      });
    });

    function place(chapter) {
      var top = chapter.getBoundingClientRect().top + window.scrollY;
      var clearance = (header ? header.offsetHeight : 0) + 24;
      window.scrollTo(0, Math.max(0, top - clearance));
    }

    function reveal(fragment, moveFocus) {
      var chapter = document.getElementById(fragment);
      if (!chapter || !chapter.hasAttribute("data-chapter")) return;
      open(chapter, false);
      if (moveFocus) parts(chapter).toggle.focus();
      place(chapter);
      window.setTimeout(function () {
        place(chapter);
      }, 0);
      carryFragment(fragment);
    }

    document.querySelectorAll("[data-chapter-jump]").forEach(function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        var fragment = link.getAttribute("data-chapter-jump");
        if (window.location.hash !== "#" + fragment) {
          window.history.pushState(null, "", "#" + fragment);
        }
        reveal(fragment, true);
      });
    });

    window.addEventListener("hashchange", function () {
      reveal(window.location.hash.slice(1), false);
    });
    window.addEventListener("popstate", function () {
      reveal(window.location.hash.slice(1), false);
    });

    if (window.location.hash.length > 1) {
      reveal(window.location.hash.slice(1), false);
    }
  }

  function carryFragment(fragment) {
    var switcher = document.querySelector(".language-switch");
    if (!switcher) return;
    var href = switcher.getAttribute("href").split("#")[0];
    switcher.setAttribute("href", fragment ? href + "#" + fragment : href);
    var alternate = document.querySelector('link[rel="alternate"]');
    if (alternate) {
      var base = alternate.getAttribute("href").split("#")[0];
      alternate.setAttribute("href", fragment ? base + "#" + fragment : base);
    }
  }

  /* ---------- heading arrival ---------- */

  function splitHeading(heading) {
    if (heading.dataset.split === "done") return;
    var words = heading.textContent.trim().split(/\s+/);
    heading.textContent = "";
    var markers = words.map(function (word, position) {
      var span = document.createElement("span");
      span.textContent = word;
      span.style.display = "inline-block";
      heading.appendChild(span);
      if (position < words.length - 1) heading.appendChild(document.createTextNode(" "));
      return span;
    });
    var lines = [];
    var lastTop = null;
    markers.forEach(function (span) {
      var top = span.offsetTop;
      if (lastTop === null || Math.abs(top - lastTop) > 2) {
        lines.push([]);
        lastTop = top;
      }
      lines[lines.length - 1].push(span.textContent);
    });
    heading.textContent = "";
    lines.forEach(function (line, position) {
      var mask = document.createElement("span");
      mask.className = "line-mask";
      var inner = document.createElement("span");
      inner.className = "line-inner";
      inner.textContent = line.join(" ") + (position < lines.length - 1 ? " " : "");
      inner.style.animationDelay = position * 0.1 + "s";
      mask.appendChild(inner);
      heading.appendChild(mask);
    });
    heading.dataset.split = "done";
    heading.classList.add("is-arriving");
  }

  /* ---------- the promise line and the featured strip ---------- */

  function setUpPromise() {
    var promise = document.querySelector("[data-promise-line]");
    if (!promise) return;
    var pending = false;

    function apply() {
      pending = false;
      if (reduced()) {
        promise.style.transform = "";
        return;
      }
      var travel = Math.min(window.scrollY, window.innerHeight);
      promise.style.transform = "translate3d(0," + travel * 0.75 + "px,0)";
    }

    window.addEventListener(
      "scroll",
      function () {
        if (pending) return;
        pending = true;
        window.requestAnimationFrame(apply);
      },
      { passive: true }
    );
    apply();
    return apply;
  }

  /* ---------- the year marker on the story route ---------- */

  function setUpYearMarker() {
    var marker = document.querySelector("[data-year-marker]");
    var chapters = Array.prototype.slice.call(document.querySelectorAll("[data-story-chapter]"));
    if (!marker || !chapters.length) return;
    var pending = false;

    function apply() {
      pending = false;
      if (reduced()) return;
      var middle = window.innerHeight / 2;
      var chosen = chapters[0];
      chapters.forEach(function (chapter) {
        var rect = chapter.getBoundingClientRect();
        if (rect.top <= middle) chosen = chapter;
      });
      var span = chosen.getAttribute("data-span");
      if (marker.textContent !== span) marker.textContent = span;
    }

    window.addEventListener(
      "scroll",
      function () {
        if (pending) return;
        pending = true;
        window.requestAnimationFrame(apply);
      },
      { passive: true }
    );
    apply();
    return apply;
  }

  /* ---------- copy an address ---------- */

  function setUpCopyButtons() {
    document.querySelectorAll("[data-copy-button]").forEach(function (button) {
      var timer = null;
      var card = button.closest(".manager-card");

      function restore() {
        button.textContent = button.getAttribute("data-copy-label");
      }

      function hold(label) {
        button.textContent = label;
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(restore, 2000);
      }

      function selectAddress() {
        var address = card && card.querySelector("[data-copy-address]");
        if (!address) return;
        var range = document.createRange();
        range.selectNodeContents(address);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }

      button.addEventListener("click", function () {
        var value = button.getAttribute("data-copy-value");
        var writer =
          navigator.clipboard && navigator.clipboard.writeText
            ? navigator.clipboard.writeText(value)
            : Promise.reject(new Error("no clipboard"));
        writer.then(
          function () {
            hold(button.getAttribute("data-copy-done"));
          },
          function () {
            hold(button.getAttribute("data-copy-failed"));
            selectAddress();
          }
        );
      });
    });
  }

  /* ---------- the enquiry form ---------- */

  function setUpEnquiryForm() {
    var form = document.querySelector("[data-enquiry-form]");
    if (!form) return;
    var copy = JSON.parse(document.querySelector("[data-enquiry-copy]").textContent);
    var alertRegion = form.querySelector("[data-enquiry-alert]");
    var statusRegion = document.querySelector("[data-enquiry-status]");
    var submit = form.querySelector("[data-enquiry-submit]");
    var label = form.querySelector("[data-submit-label]");
    var order = ["email", "phone", "reference", "agreed"];
    var inFlight = false;

    function fieldOf(name) {
      return form.querySelector('[name="' + name + '"]');
    }

    function clearFieldErrors() {
      order.forEach(function (name) {
        var field = fieldOf(name);
        var message = form.querySelector('[data-field-error="' + name + '"]');
        if (message) message.textContent = "";
        if (field) field.removeAttribute("aria-invalid");
      });
    }

    function showFieldErrors(errors) {
      clearFieldErrors();
      var first = null;
      order.forEach(function (name) {
        if (!errors[name]) return;
        var field = fieldOf(name);
        var message = form.querySelector('[data-field-error="' + name + '"]');
        if (message) message.textContent = copy.errors[name] || errors[name];
        if (field) field.setAttribute("aria-invalid", "true");
        if (!first) first = field;
      });
      alertRegion.textContent = copy.refused;
      if (first) first.focus();
    }

    function settle() {
      inFlight = false;
      submit.disabled = false;
      label.textContent = copy.submit;
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (inFlight) return;
      inFlight = true;
      alertRegion.textContent = "";
      submit.disabled = true;
      label.textContent = copy.pending;

      var body = {
        email: fieldOf("email").value,
        agreed: fieldOf("agreed").checked
      };
      var phone = fieldOf("phone").value.trim();
      if (phone) body.phone = phone;
      var reference = fieldOf("reference").value;
      if (reference) body.reference = reference;

      window
        .fetch("/api/enquiries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        })
        .then(function (response) {
          return response
            .json()
            .catch(function () {
              return {};
            })
            .then(function (payload) {
              return { status: response.status, payload: payload };
            });
        })
        .then(function (result) {
          if (result.status === 201) {
            clearFieldErrors();
            statusRegion.textContent = copy.success;
            form.remove();
            statusRegion.focus();
            return;
          }
          if (result.status === 422 && result.payload.errors) {
            settle();
            showFieldErrors(result.payload.errors);
            return;
          }
          settle();
          alertRegion.textContent = copy.outage;
        })
        .catch(function () {
          settle();
          alertRegion.textContent = copy.outage;
        });
    });
  }

  /* ---------- live motion preference ---------- */

  function applyMotionPreference() {
    root.classList.toggle("reduce-motion", reduced());
    var heading = document.querySelector("h1[data-split-lines]");
    if (heading) {
      if (reduced()) {
        heading.classList.remove("is-arriving");
      } else {
        splitHeading(heading);
      }
    }
  }

  measureHeader();
  window.addEventListener("resize", measureHeader);
  if (header) new window.ResizeObserver(measureHeader).observe(header);
  applyMotionPreference();
  setUpCookieNotice();
  setUpMenu();
  setUpChapters();
  setUpCopyButtons();
  setUpEnquiryForm();
  var refreshPromise = setUpPromise();
  var refreshMarker = setUpYearMarker();

  motionQuery.addEventListener("change", function () {
    applyMotionPreference();
    if (refreshPromise) refreshPromise();
    if (refreshMarker) refreshMarker();
  });
})();
