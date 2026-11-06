/* Northpier Studio front-end: covers, motion, cookie card, composer, studio. */
(function () {
  "use strict";
  var root = document;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $(sel, scope) { return (scope || root).querySelector(sel); }
  function $all(sel, scope) { return Array.prototype.slice.call((scope || root).querySelectorAll(sel)); }
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) { Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); }); }
    if (text !== undefined) { node.textContent = text; }
    return node;
  }

  /* ------------------------------------------------ text counting (rule 15) */
  function countText(value) {
    var norm = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return Array.from(norm).length;
  }
  window.npCountText = countText;

  /* -------------------------------------------------------- statement enter */
  function wrapLetters(node) {
    var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
    var texts = [];
    while (walker.nextNode()) { texts.push(walker.currentNode); }
    texts.forEach(function (t) {
      var frag = document.createDocumentFragment();
      Array.from(t.data).forEach(function (ch) {
        if (ch === " ") { frag.appendChild(document.createTextNode(" ")); return; }
        frag.appendChild(el("span", { class: "letter" }, ch));
      });
      t.parentNode.replaceChild(frag, t);
    });
    return $all(".letter", node);
  }

  function statementEnter(node) {
    if (!node) return;
    var letters = wrapLetters(node);
    if (reduced) {
      letters.forEach(function (s) { s.classList.add("shown"); });
      return;
    }
    letters.forEach(function (span, i) {
      setTimeout(function () { span.classList.add("shown"); }, 12 * i);
    });
  }

  function labelEnter() {
    $all(".reveal-item").forEach(function (item, i) {
      if (reduced) { item.classList.add("revealed"); return; }
      setTimeout(function () { item.classList.add("revealed"); }, 60 * i);
    });
  }

  /* -------------------------------------------------------------- covers */
  var THEME_GROUNDS = {
    orange: "#ef8a3f", violet: "#8e8cf5", lemon: "#dfe343", clay: "#d3a88c",
    sand: "#e6d9c4", ink: "#101114", mist: "#e2e5ec"
  };
  var INK_ON = { orange: "#17181c", violet: "#10102a", lemon: "#17181c", clay: "#17181c", sand: "#17181c", ink: "#f2f3f7", mist: "#17181c" };

  function seededBands(seed) {
    var n = 2 + (seed % 3);
    var bands = [];
    var state = seed;
    function rnd() { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x7fffffff; }
    for (var i = 0; i < n; i++) {
      bands.push({ y: 12 + rnd() * 70, h: 5 + rnd() * 12, x: -8 + rnd() * 30, w: 60 + rnd() * 50, o: 0.07 + rnd() * 0.08 });
    }
    return bands;
  }

  function drawCover(holder) {
    var theme = holder.getAttribute("data-theme") || "mist";
    var seed = parseInt(holder.getAttribute("data-cover-seed") || "7", 10) || 7;
    var initials = holder.getAttribute("data-initials") || "N";
    var wide = holder.classList.contains("cover-wide") || holder.classList.contains("cover-small");
    var canvas = el("canvas", { class: "cover-canvas", "aria-hidden": "true" });
    var ground = THEME_GROUNDS[theme] || "#e2e5ec";
    var ink = INK_ON[theme] || "#17181c";
    var w = 640, h = 480;
    if (holder.classList.contains("cover-wide")) { w = 960; h = 410; }
    if (holder.classList.contains("cover-thumb")) { w = 480; h = 360; }
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, w, h);
    var bands = seededBands(Math.abs(seed));
    bands.forEach(function (b) {
      ctx.fillStyle = "rgba(0,0,0," + b.o + ")";
      ctx.fillRect((b.x / 100) * w, (b.y / 100) * h, (b.w / 100) * w, (b.h / 100) * h);
    });
    var glowX = (20 + (Math.abs(seed) % 50)) / 100 * w;
    var glowY = (15 + (Math.abs(seed * 7) % 45)) / 100 * h;
    var grad = ctx.createRadialGradient(glowX, glowY, 10, glowX, glowY, w * 0.5);
    grad.addColorStop(0, "rgba(255,255,255,0.5)");
    grad.addColorStop(0.45, "rgba(255,255,255,0.14)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    holder.textContent = "";
    holder.appendChild(canvas);
    holder.appendChild(el("span", { class: "cover-initials", "aria-hidden": "true" }, initials));
    holder.style.color = ink;
  }

  function drawAllCovers() {
    $all(".cover").forEach(drawCover);
  }

  /* -------------------------------------------------------------- rotator */
  var ROTATOR = ["Intelligent products", "Brands with purpose", "Sites that move"];
  function startRotator() {
    var holder = $("[data-rotator]");
    if (!holder) return;
    if (reduced) return;
    var index = 0;
    setInterval(function () {
      index = (index + 1) % ROTATOR.length;
      holder.style.transition = "opacity 0.45s cubic-bezier(0.22,1,0.36,1), transform 0.45s cubic-bezier(0.22,1,0.36,1)";
      holder.style.opacity = "0";
      holder.style.transform = "translateY(-0.4em)";
      setTimeout(function () {
        holder.textContent = ROTATOR[index];
        holder.style.transform = "translateY(0.4em)";
        requestAnimationFrame(function () {
          holder.style.opacity = "1";
          holder.style.transform = "translateY(0)";
        });
      }, 450);
    }, 3000);
  }

  /* --------------------------------------------------------------- glow reel */
  function startGlow() {
    var reel = $(".glow-reel");
    if (!reel) return;
    if (reduced) return;
    reel.style.animation = "np-drift 20s linear infinite";
  }
  var style = document.createElement("style");
  style.textContent = "@keyframes np-drift {0% {transform: translate(0,0) scale(1);} 25% {transform: translate(6%, -4%) scale(1.08);} 50% {transform: translate(-5%, 5%) scale(0.95);} 75% {transform: translate(-7%, -6%) scale(1.05);} 100% {transform: translate(0,0) scale(1);}}";
  document.head.appendChild(style);

  /* ----------------------------------------------------------- header roll */
  function headerRoll() {
    $all(".site-nav a").forEach(function (link) {
      link.addEventListener("mouseenter", function () {
        if (reduced) return;
        var text = link.textContent;
        link.textContent = "";
        Array.from(text).forEach(function (ch, i) {
          var span = el("span", { class: "roll-letter" }, ch);
          span.style.display = "inline-block";
          span.style.transition = "transform 0.45s cubic-bezier(0.22,1,0.36,1)";
          link.appendChild(span);
          setTimeout(function () { span.style.transform = "translateY(-0.9em)"; }, 12 * i);
          setTimeout(function () {
            span.style.transform = "translateY(0)";
            span.textContent = ch;
          }, 12 * i + 450);
        });
        setTimeout(function () { link.textContent = text; }, 12 * text.length + 950);
      });
    });
  }

  /* ---------------------------------------------------------- cookie card */
  function cookieCard() {
    var card = $(".cookie-card");
    if (!card) return;
    if (document.cookie.indexOf("np_consent=") >= 0) return;
    card.hidden = false;
    setTimeout(function () { card.classList.add("shown"); }, reduced ? 0 : 1000);
    function choose(value) {
      var expires = new Date(Date.now() + 365 * 864e5).toUTCString();
      document.cookie = "np_consent=" + value + "; path=/; expires=" + expires + "; SameSite=Lax";
      card.classList.remove("shown");
      setTimeout(function () { card.remove(); }, 500);
    }
    $(".cookie-reject", card).addEventListener("click", function () { choose("rejected"); });
    $(".cookie-accept", card).addEventListener("click", function () { choose("accepted"); });
  }

  /* ---------------------------------------------------------------- menu */
  function menu() {
    var button = $(".menu-button");
    var sheet = $("#menu-sheet");
    if (!button || !sheet) return;
    var lastFocus = null;
    function open() {
      sheet.hidden = false;
      if (!reduced) {
        sheet.style.transition = "opacity 0.45s";
        sheet.style.opacity = "0";
        requestAnimationFrame(function () { sheet.style.opacity = "1"; });
      }
      button.setAttribute("aria-expanded", "true");
      lastFocus = document.activeElement;
      var first = $("a", sheet);
      if (first) first.focus();
    }
    function close() {
      if (!reduced) {
        sheet.style.opacity = "0";
        setTimeout(function () { sheet.hidden = true; }, 450);
      } else { sheet.hidden = true; }
      button.setAttribute("aria-expanded", "false");
      button.focus();
    }
    button.addEventListener("click", function () {
      if (sheet.hidden) open(); else close();
    });
    var closeButton = $(".menu-close", sheet);
    if (closeButton) closeButton.addEventListener("click", close);
    sheet.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab") return;
      var focusables = $all("a, button", sheet);
      if (!focusables.length) return;
      var first = focusables[0], last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }

  /* ------------------------------------------------------------- greetings */
  function greeting() {
    var stockholm = $("[data-greeting='stockholm']");
    var reykjavik = $("[data-greeting='reykjavik']");
    if (!stockholm || !reykjavik) return;
    var months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    function two(n) { return (n < 10 ? "0" : "") + n; }
    function stockholmLine(d) {
      var h = d.getHours();
      var t = two(d.getHours()) + ":" + two(d.getMinutes());
      if (h < 12) return "God morgon, klockan är " + t;
      if (h < 18) return "God eftermiddag, klockan är " + t;
      return "God kväll, klockan är " + t;
    }
    function reykjavikLine(d) {
      var h = d.getHours();
      var ampm = h < 12 ? "AM" : "PM";
      var h12 = h % 12 === 0 ? 12 : h % 12;
      var t = h12 + ":" + two(d.getMinutes()) + " " + ampm;
      if (h < 12) return "Góðan daginn, klukkan er " + t;
      if (h < 18) return "Góðan dag, klukkan er " + t;
      return "Gott kvöld, klukkan er " + t;
    }
    function update() {
      try {
        var now = new Date();
        var s = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Stockholm" }));
        var r = new Date(now.toLocaleString("en-US", { timeZone: "Atlantic/Reykjavik" }));
        stockholm.textContent = stockholmLine(s);
        reykjavik.textContent = reykjavikLine(r);
      } catch (err) { /* keep the server-rendered greeting */ }
    }
    update();
    setInterval(update, 15000);
  }

  /* ------------------------------------------------------------- composer */
  function composer() {
    var form = $("[data-composer]");
    if (!form) return;
    var message = $("#message");
    var counter = $("#counter");
    var sendButton = $(".send-button", form);
    var statusOut = $("#send-status");
    var idemField = $("[data-idem]", form);
    var idemKey = null;
    var sending = false;

    function mintKey() {
      var bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      return Array.from(bytes).map(function (b) {
        return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[b % 64];
      }).join("");
    }
    function ensureKey() {
      if (!idemKey) {
        idemKey = mintKey();
        if (idemField) idemField.value = idemKey;
      }
      return idemKey;
    }

    function refreshCounter() {
      if (!message || !counter) return;
      counter.textContent = countText(message.value) + " / 2000";
    }

    function validEmail(value) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
    }

    function invalidChars(value) {
      return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
    }

    function fieldValid() {
      var name = $("#name"), email = $("#email");
      var services = $all("input[name='services']:checked", form);
      var budget = $("#budget"), timeline = $("#timeline");
      if (!name.value.trim()) return false;
      if (invalidChars(name.value)) return false;
      if (!validEmail(email.value) || invalidChars(email.value)) return false;
      if (invalidChars($("#company").value)) return false;
      if (!services.length) return false;
      if (!budget.value || !timeline.value) return false;
      if (countText(message.value) < 20 || countText(message.value) > 2000) return false;
      if (invalidChars(message.value.replace(/[\t\n\r]/g, ""))) return false;
      return true;
    }

    function refreshSend() {
      sendButton.disabled = sending || !fieldValid();
    }

    form.addEventListener("input", function (event) {
      if (event.target === message) refreshCounter();
      ensureKey();
      refreshSend();
    });
    form.addEventListener("change", refreshSend);

    $all(".starter-card").forEach(function (card) {
      card.addEventListener("click", function () {
        var pressed = card.getAttribute("aria-pressed") === "true";
        $all(".starter-card").forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
        if (!pressed) {
          card.setAttribute("aria-pressed", "true");
          var services = card.getAttribute("data-services").split(",");
          $all("input[name='services']", form).forEach(function (box) {
            box.checked = services.indexOf(box.value) >= 0;
          });
        } else {
          $all("input[name='services']", form).forEach(function (box) { box.checked = false; });
        }
        ensureKey();
        refreshSend();
        var target = ["#name", "#email", "#budget", "#timeline", "#message"]
          .map(function (sel) { return $(sel); })
          .find(function (node) { return node && !node.value; });
        if (target) target.focus();
      });
    });

    function showFieldError(field, text) {
      var holder = $("[data-for='" + field + "']", form);
      if (!holder) return;
      holder.textContent = text;
      var input = $("#" + field, form) || $("[name='" + field + "']", form);
      if (input) {
        input.setAttribute("aria-invalid", "true");
        if (input.getAttribute("aria-describedby") === null) {
          input.setAttribute("aria-describedby", holder.id || "");
        }
      }
    }
    function clearFieldErrors() {
      $all(".field-message", form).forEach(function (m) { m.textContent = ""; });
      $all("[aria-invalid]", form).forEach(function (i) { i.removeAttribute("aria-invalid"); });
    }

    function payload() {
      return {
        name: $("#name").value,
        email: $("#email").value,
        company: $("#company").value,
        services: $all("input[name='services']:checked", form).map(function (b) { return b.value; }),
        budget: $("#budget").value,
        timeline: $("#timeline").value,
        message: message.value
      };
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (sending) return;
      if (!fieldValid()) { refreshSend(); return; }
      sending = true;
      refreshSend();
      statusOut.textContent = "Sending your inquiry...";
      var key = ensureKey();
      fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(payload())
      }).then(function (res) {
        return res.json().then(function (body) { return { status: res.status, body: body }; });
      }).then(function (result) {
        sending = false;
        if (result.status === 201 || result.status === 200) {
          statusOut.textContent = "Inquiry sent.";
          renderConfirmation(result.body);
          return;
        }
        refreshSend();
        var err = result.body && result.body.error;
        if (err && err.field) {
          clearFieldErrors();
          showFieldError(err.field, err.message);
          var input = $("#" + err.field, form);
          if (input) input.focus();
          statusOut.textContent = "Check the highlighted field.";
        } else {
          statusOut.textContent = (err && err.message) || "The studio desk is unavailable. Try again shortly.";
        }
      }).catch(function () {
        sending = false;
        refreshSend();
        statusOut.textContent = "The studio desk is unavailable. Try again shortly.";
      });
    });

    function renderConfirmation(body) {
      var first = (body.reference && "") || "";
      var composer = $(".composer");
      var name = $("#name").value.trim().split(/\s+/)[0] || "";
      var wrap = el("section", { class: "confirmation", "aria-labelledby": "confirm-heading" });
      var heading = el("h1", { class: "confirm-heading", id: "confirm-heading" },
        "Thanks, " + name + ". We have your inquiry.");
      var ref = el("p", { class: "confirm-reference" }, "Reference " + body.reference);
      var keep = el("p", { class: "confirm-keep" }, "Keep this link to follow your inquiry:");
      var row = el("div", { class: "confirm-link-row" });
      var label = el("label", { class: "visually-hidden", for: "status-link" }, "Status link");
      var input = el("input", { class: "status-link-input", id: "status-link", type: "text", readonly: "readonly", value: body.status_url });
      var copy = el("button", { class: "copy-link", type: "button" }, "Copy link");
      row.appendChild(label); row.appendChild(input); row.appendChild(copy);
      var open = el("p", { class: "confirm-open" });
      open.appendChild(el("a", { href: "/inquiry/" + body.status_token }, "Open status page"));
      var statusLine = el("p", { class: "send-status", id: "send-status", role: "status", "aria-live": "polite" }, "Inquiry sent.");
      wrap.appendChild(heading); wrap.appendChild(ref); wrap.appendChild(keep);
      wrap.appendChild(row); wrap.appendChild(open); wrap.appendChild(statusLine);
      composer.replaceWith(wrap);
      copy.addEventListener("click", function () {
        var done = function () { statusLine.textContent = "Link copied."; };
        var fail = function () { statusLine.textContent = "Copy the link from the field above."; };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(input.value).then(done, fail);
        } else {
          input.select();
          try { document.execCommand("copy"); done(); } catch (err) { fail(); }
        }
      });
      heading.focus && heading.setAttribute("tabindex", "-1");
      heading.focus();
    }

    refreshCounter();
    refreshSend();
  }

  /* ---------------------------------------------------------- status page */
  function statusPage() {
    var main = $("[data-status-token]");
    if (!main) return;
    var token = main.getAttribute("data-status-token");
    var known = main.getAttribute("data-status");
    var labelFor = { new: "New", in_review: "In review", call_booked: "Call booked", won: "Won", declined: "Declined" };
    var heading = $("[data-status-label]");
    var line = $("[data-status-line]");
    var historyList = $("[data-history]");
    function lineFor(status, data) {
      if (status === "call_booked" && data && data.call_at) {
        return "Your intro call is booked for " + callTimeLabel(data.call_at) + " Stockholm time.";
      }
      if (status === "declined" && data && data.decline_reason) {
        var reasons = { outside_services: "Outside our services", timeline: "Timeline does not fit", budget: "Budget does not fit", fully_booked: "Fully booked" };
        return "We are not the right fit this time: " + (reasons[data.decline_reason] || "") + ". Thank you for thinking of us.";
      }
      var lines = {
        new: "We have your inquiry and will look at it shortly.",
        in_review: "We are reading through your project and may get in touch with questions.",
        won: "We are starting together. We will be in touch with next steps."
      };
      return lines[status] || "";
    }
    function callTimeLabel(iso) {
      var d = new Date(iso);
      var local = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Stockholm" }));
      var days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      var months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
      var hh = ("0" + local.getHours()).slice(-2);
      var mm = ("0" + local.getMinutes()).slice(-2);
      return days[local.getDay()] + " " + local.getDate() + " " + months[local.getMonth()] + ", " + hh + ":" + mm;
    }
    function shortDate(iso) {
      var d = new Date(iso);
      var local = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Stockholm" }));
      var months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
      return local.getDate() + " " + months[local.getMonth()] + " " + local.getFullYear();
    }
    function renderHistory(items) {
      historyList.textContent = "";
      items.forEach(function (item) {
        var li = el("li", { class: "history-item", "data-history-item": "" });
        li.appendChild(el("span", { class: "pill pill-" + item.status }, labelFor[item.status] || item.status));
        li.appendChild(el("span", { class: "history-date" }, shortDate(item.created_at)));
        historyList.appendChild(li);
      });
    }
    setInterval(function () {
      fetch("/api/inquiries/status/" + encodeURIComponent(token), { headers: { "Accept": "application/json" } })
        .then(function (res) { if (!res.ok) throw new Error("gone"); return res.json(); })
        .then(function (data) {
          if (data.status === known) return;
          known = data.status;
          if (heading) {
            heading.textContent = labelFor[data.status] || data.status;
            if (!reduced) statementEnter(heading);
          }
          if (line) line.textContent = lineFor(data.status, data);
          renderHistory(data.history);
        })
        .catch(function () { /* keep what is shown; retry next recheck */ });
    }, 15000);
  }

  /* --------------------------------------------------------------- sign in */
  function signin() {
    var form = $("[data-signin]");
    if (!form) return;
    var errorOut = $("[data-signin-error]");
    var statusOut = $("[data-signin-status]");
    var next = form.querySelector("input[name='next']").value;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      statusOut.textContent = "Signing in...";
      if (errorOut) { errorOut.hidden = true; errorOut.textContent = ""; }
      fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: $("#email").value, password: $("#password").value })
      }).then(function (res) {
        return res.json().then(function (body) { return { status: res.status, body: body, headers: res.headers }; });
      }).then(function (result) {
        if (result.status === 200) {
          window.location.assign(next || "/studio");
          return;
        }
        var message = (result.body && result.body.error && result.body.error.message) || "Incorrect email or password.";
        statusOut.textContent = message;
        if (errorOut) { errorOut.textContent = message; errorOut.hidden = false; }
        $("#password").value = "";
      }).catch(function () {
        statusOut.textContent = "The studio desk is unavailable. Try again shortly.";
      });
    });
  }

  function signout() {
    var button = $("[data-signout]");
    if (!button) return;
    button.addEventListener("click", function () {
      fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
        .then(function () { window.location.assign("/studio/signin?signed_out=1"); })
        .catch(function () { window.location.assign("/studio/signin?signed_out=1"); });
    });
  }

  /* ------------------------------------------------------------------ boot */
  function boot() {
    drawAllCovers();
    labelEnter();
    $all("[data-statement]").forEach(function (node) { statementEnter(node); });
    startRotator();
    startGlow();
    headerRoll();
    cookieCard();
    menu();
    greeting();
    composer();
    statusPage();
    signin();
    signout();
    if (window.npStudioBoot) window.npStudioBoot($, $all, el, reduced);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
})();
