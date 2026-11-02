// Tessel public pages: hero switch, menus, tabs, calculator, view-as reader.
"use strict";

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

/* star chip, cached one hour */
(function stars() {
  var chip = $("#star-num");
  if (!chip) return;
  var cached = null;
  try { cached = JSON.parse(localStorage.getItem("tessel-stars")); } catch (e) {}
  function render(count) {
    if (count === null || count === undefined) { chip.textContent = "Star"; return; }
    if (count < 1000) { chip.textContent = "Star " + count; return; }
    var narrow = window.innerWidth < 768;
    if (narrow) {
      var v = Math.round(count / 100) / 10;
      chip.textContent = "Star " + (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) + "k";
    } else {
      chip.textContent = "Star " + count.toLocaleString("en-US");
    }
  }
  var fresh = cached && (Date.now() - cached.at < 3600000);
  if (fresh) { render(cached.count); return; }
  fetch("/api/code-host/repo").then(function (r) { return r.json(); }).then(function (body) {
    var count = body.data && body.data.stargazers_count;
    render(count);
    try { localStorage.setItem("tessel-stars", JSON.stringify({count: count, at: Date.now()})); }
    catch (e) {}
  }).catch(function () { render(null); });
})();

/* hero view switch by arrow keys and space */
(function hero() {
  var inputs = $$('input[name="hero-view"]');
  if (!inputs.length) return;
  var text = $("#hero-text"), graph = $("#hero-graph");
  function show(value) {
    var isGraph = value === "graph";
    text.hidden = isGraph;
    graph.hidden = !isGraph;
    if (isGraph) graph.classList.add("visible");
  }
  inputs.forEach(function (input, i) {
    input.addEventListener("change", function () { show(input.value); });
    input.addEventListener("keydown", function (e) {
      var dir = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 :
        (e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0);
      if (!dir) return;
      e.preventDefault();
      var next = inputs[(i + dir + inputs.length) % inputs.length];
      next.checked = true;
      next.focus();
      show(next.value);
    });
  });
})();

/* resources menu */
(function menu() {
  var btn = $("#resources-btn"), menu = $("#resources-menu");
  if (!btn) return;
  function open() { btn.setAttribute("aria-expanded", "true"); menu.hidden = false; }
  function close(refocus) { btn.setAttribute("aria-expanded", "false"); menu.hidden = true;
    if (refocus) btn.focus(); }
  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (menu.hidden) open(); else close(true);
  });
  btn.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault();
      if (menu.hidden) open(); else close(true); }
    if (e.key === "Escape" && !menu.hidden) close(true);
  });
  document.addEventListener("click", function (e) {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) close(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !menu.hidden) close(true);
  });
})();

/* header rule on scroll, section in view */
(function scroll() {
  var header = $(".pub-header");
  if (!header) return;
  function onScroll() {
    var hero = $("#hero");
    var past = hero && (window.scrollY > hero.offsetHeight - 80);
    header.classList.toggle("scrolled", past);
  }
  onScroll();
  window.addEventListener("scroll", onScroll, {passive: true});

  var links = $$(".pub-nav .navlink");
  var sections = ["architecture", "benchmarks", "pricing", "faq"].map(function (id) {
    return document.getElementById(id);
  }).filter(Boolean);
  function inView() {
    var marked = 0;
    links.forEach(function (l) { l.removeAttribute("aria-current");
      l.classList.remove("current"); });
    for (var i = 0; i < sections.length; i++) {
      var rect = sections[i].getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.4 && rect.bottom > 0) marked = i + 1;
    }
    if (marked) {
      var id = sections[marked - 1].id;
      var link = $('.pub-nav .navlink[href="#' + id + '"]');
      if (link) link.setAttribute("aria-current", "true");
      if (id === "faq") {
        var btn = $("#resources-btn");
        if (btn) { btn.style.color = "var(--ink)"; }
      }
    }
  }
  inView();
  window.addEventListener("scroll", inView, {passive: true});
  var reveal = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) { entry.target.classList.add("revealed"); }
    });
  }, {threshold: 0.2});
  $$(".section").forEach(function (s) { reveal.observe(s); });
})();

/* use case tabs and comparison tabs, arrow keys, home and end */
(function tabs() {
  $$(".tabs").forEach(function (group) {
    var tabs = $$("button[role='tab']", group);
    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { select(i); });
      tab.addEventListener("keydown", function (e) {
        var next = null;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % tabs.length;
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + tabs.length) % tabs.length;
        if (e.key === "Home") next = 0;
        if (e.key === "End") next = tabs.length - 1;
        if (next === null) return;
        e.preventDefault();
        select(next);
        tabs[next].focus();
      });
    });
    function select(i) {
      tabs.forEach(function (t, j) { t.setAttribute("aria-selected", String(j === i)); });
      var container = group.parentElement;
      $$(".tab-panel", container).forEach(function (p) {
        p.hidden = p.getAttribute("data-panel") !== tabs[i].id;
      });
    }
  });
})();

/* faq */
(function faq() {
  $$(".faq-q").forEach(function (q) {
    q.addEventListener("click", function () {
      var open = q.getAttribute("aria-expanded") === "true";
      var answer = document.getElementById(q.getAttribute("aria-controls"));
      q.setAttribute("aria-expanded", String(!open));
      answer.hidden = open;
    });
  });
})();

/* price calculator, same arithmetic as the server */
(function calculator() {
  var gb = $("#calc-gb"), mt = $("#calc-mt");
  if (!gb || !mt) return;
  var error = $("#calc-error");
  var shipOut = $("#calc-ship"), scaleOut = $("#calc-scale");
  var lastShip = null, lastScale = null;
  function money(cents) {
    var sign = cents < 0 ? "-$" : "$";
    var abs = Math.abs(cents);
    return sign + Math.floor(abs / 100).toLocaleString("en-US") +
      "." + String(abs % 100).padStart(2, "0");
  }
  function parse(v) {
    if (!/^\d{0,6}(\.\d)?$/.test(v)) return null;
    var n = Number(v);
    if (!isFinite(n) || n < 0 || n > 100000) return null;
    return n;
  }
  function estimate(gbVal, mVal, rate, minimum) {
    var g10 = Math.round(gbVal * 10);
    var m10 = Math.round(mVal * 10);
    var storage = Math.ceil(g10 * rate / 10);
    var ontology = Math.ceil(m10 * 500 / 10);
    var usage = storage + ontology;
    return {usage: usage, billed: Math.max(usage, minimum), min: usage < minimum};
  }
  function update() {
    var g = parse(gb.value), m = parse(mt.value);
    if (g === null || m === null) {
      error.hidden = false;
      error.textContent = "Enter a number from 0 to 100000 with at most one decimal";
      return;
    }
    error.hidden = true;
    var ship = estimate(g, m, 50, 2500);
    var scale = estimate(g, m, 25, 30000);
    function fill(el, plan, which) {
      el.innerHTML = money(plan.billed) + (plan.min ?
        ' <span class="min-applies">minimum applies</span>' : "");
      if (which !== lastShip && which === "ship") { el.classList.remove("flash");
        void el.offsetWidth; el.classList.add("flash"); lastShip = which; }
    }
    shipOut.innerHTML = money(ship.billed) + (ship.min ?
      ' <span class="min-applies">minimum applies</span>' : "");
    scaleOut.innerHTML = money(scale.billed) + (scale.min ?
      ' <span class="min-applies">minimum applies</span>' : "");
    if (lastShip !== ship.billed) { shipOut.classList.remove("flash"); void shipOut.offsetWidth;
      shipOut.classList.add("flash"); lastShip = ship.billed; }
    if (lastScale !== scale.billed) { scaleOut.classList.remove("flash"); void scaleOut.offsetWidth;
      scaleOut.classList.add("flash"); lastScale = scale.billed; }
  }
  gb.addEventListener("input", update);
  mt.addEventListener("input", update);
  update();
})();

/* view this page as */
(function viewAs() {
  var group = $("#view-as");
  if (!group) return;
  var path = group.getAttribute("data-path");
  var radios = $$("input", group);
  function apply(value, push) {
    if (value === "ai") {
      if (push) window.location.href = path + "?view=ai";
    } else if (push) {
      window.location.href = path;
    }
  }
  radios.forEach(function (r) {
    r.addEventListener("change", function () { apply(r.value, true); });
    r.addEventListener("keydown", function (e) {
      var other = radios[0] === r ? radios[1] : radios[0];
      if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowUp" ||
          e.key === "ArrowDown") {
        e.preventDefault();
        other.checked = true;
        other.focus();
        apply(other.value, true);
      }
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && $("#reader")) {
      window.location.href = path;
    }
  });
  var close = $("#reader-close");
  if (close) close.addEventListener("click", function () {
    window.location.href = path; });
  var copy = $("#reader-copy");
  if (copy) copy.addEventListener("click", function () {
    var body = $(".reader-body").innerText;
    if (navigator.clipboard) navigator.clipboard.writeText(body);
  });
})();

/* contact form answering in place when scripts are on */
(function contact() {
  var form = $("#contact-form");
  if (!form) return;
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var fd = new FormData(form);
    fetch("/api/contact", {method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({email: fd.get("email"), message: fd.get("message"),
        website: fd.get("website") || ""})}).then(function (r) {
      return r.json().then(function (body) { return {status: r.status, body: body}; });
    }).then(function (res) {
      if (res.body.success) {
        form.outerHTML = '<p class="thanks" role="status">Thanks. We will reply within ' +
          'one business day.</p>';
      } else {
        var err = res.body.error || {};
        var target = err.field === "email" ? $("#cf-email") : $("#cf-message");
        var note = target.parentElement.querySelector(".field-error");
        if (note) { note.textContent = err.message; note.hidden = false; }
        if (err.code === "RATE_LIMITED") {
          var top = document.createElement("p");
          top.className = "form-error-top";
          top.setAttribute("role", "alert");
          top.textContent = err.message;
          form.parentElement.insertBefore(top, form);
        }
      }
    }).catch(function () {
      var note = document.createElement("p");
      note.className = "field-error";
      note.setAttribute("role", "alert");
      note.textContent = "Something went wrong. Try again.";
      form.parentElement.insertBefore(note, form);
    });
  });
})();

/* sign-in form answering in place */
(function login() {
  var form = $("#login-form");
  if (!form) return;
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var fd = new FormData(form);
    var nextValue = fd.get("next") || "";
    fetch("/api/auth/login", {method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({email: fd.get("email"), password: fd.get("password")})})
      .then(function (r) { return r.json().then(function (b) { return {ok: r.ok, body: b}; }); })
      .then(function (res) {
        if (!res.ok) {
          var top = $(".form-error-top");
          if (!top) {
            top = document.createElement("p");
            top.className = "form-error-top shake";
            top.setAttribute("role", "alert");
            form.parentElement.insertBefore(top, form);
          }
          top.classList.remove("shake");
          void top.offsetWidth;
          top.classList.add("shake");
          top.textContent = res.body.error ? res.body.error.message : "Sign in failed";
          return;
        }
        var token = res.body.data.token;
        document.cookie = "tessel_session=" + token + "; path=/; samesite=Lax";
        var target = "/console";
        if (/^\/console(\/|\?|$)/.test(nextValue) && nextValue.indexOf("\\") === -1 &&
            nextValue.indexOf("//") === -1 && !/\/\.\.?\/|\/\.\./.test(nextValue) &&
            !/[\x00-\x1f\x7f]/.test(nextValue)) {
          target = nextValue;
        }
        window.location.href = target;
      });
  });
})();
