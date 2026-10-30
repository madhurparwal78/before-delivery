// Public pages: header menu, star chip, section marks, hero views, tabs, FAQ, price calculator, reveals,
// the "View this page as" reader and the contact form. Every feature upgrades markup that works without it.
(() => {
  "use strict";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const motion = (el, frames, options) => (!reduce.matches && el.animate ? el.animate(frames, options) : null);
  const GENERIC = "Something went wrong. Try again.";
  const enter = (el) => {
    el.classList.remove("entering");
    void el.offsetWidth;
    el.classList.add("entering");
  };

  // ---- star chip --------------------------------------------------------------------------------
  const STAR_KEY = "tessel-stars";
  const HOUR = 3600 * 1000;
  function compactCount(n) {
    if (n < 1000) return String(n);
    const tenths = Math.floor(n / 100 + 0.5);
    return `${tenths % 10 === 0 ? tenths / 10 : (tenths / 10).toFixed(1)}k`;
  }
  function showStars(n) {
    const full = $("[data-star-full]");
    const compact = $("[data-star-compact]");
    if (full) full.textContent = n.toLocaleString("en-US");
    if (compact) compact.textContent = compactCount(n);
  }
  async function stars() {
    if (!$("[data-star-chip]")) return;
    try {
      const saved = JSON.parse(localStorage.getItem(STAR_KEY) || "null");
      if (saved && Number.isInteger(saved.count) && Date.now() - saved.at < HOUR) return showStars(saved.count);
    } catch { /* an unreadable saved value is read again below */ }
    try {
      const res = await fetch("/api/code-host/repo");
      const body = await res.json();
      if (!body.success) return;
      const count = body.data.stargazers_count;
      localStorage.setItem(STAR_KEY, JSON.stringify({ count, at: Date.now() }));
      showStars(count);
    } catch { /* the chip keeps reading Star */ }
  }

  // ---- header: Resources menu, phone sheet, section marks, header rule -----------------------
  function menus() {
    const button = $(".menu-button");
    const panel = $("#resources-menu");
    if (button && panel) {
      const setOpen = (open) => {
        button.setAttribute("aria-expanded", String(open));
        panel.hidden = !open;
      };
      button.addEventListener("click", () => setOpen(panel.hidden));
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !panel.hidden) {
          setOpen(false);
          button.focus();
        }
      });
      document.addEventListener("click", (e) => {
        if (!panel.hidden && !button.contains(e.target) && !panel.contains(e.target)) setOpen(false);
      });
      panel.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
    }
    const toggle = $(".menu-toggle");
    const sheet = $("#phone-sheet");
    if (toggle && sheet) {
      toggle.addEventListener("click", () => {
        const open = sheet.hidden;
        sheet.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
      });
      sheet.addEventListener("click", (e) => {
        if (e.target.closest("a")) {
          sheet.hidden = true;
          toggle.setAttribute("aria-expanded", "false");
        }
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !sheet.hidden) {
          sheet.hidden = true;
          toggle.setAttribute("aria-expanded", "false");
          toggle.focus();
        }
      });
    }
  }

  function sectionMarks() {
    const header = $("#site-header");
    const hero = $("#hero");
    const tracked = $$("[data-section]", header)
      .map((el) => ({ el, section: document.getElementById(el.dataset.section) }))
      .filter((t) => t.section);
    const update = () => {
      const line = header.getBoundingClientRect().bottom + 8;
      let current = null;
      for (const t of tracked) {
        const r = t.section.getBoundingClientRect();
        if (r.top <= line && r.bottom > line) current = t;
      }
      for (const t of tracked) {
        if (t === current) t.el.setAttribute("aria-current", "true");
        else t.el.removeAttribute("aria-current");
      }
      if (hero) header.classList.toggle("past-hero", hero.getBoundingClientRect().bottom <= header.getBoundingClientRect().bottom);
    };
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  // ---- hero views, tabs, FAQ -----------------------------------------------------------------------
  function heroViews() {
    const radios = $$('input[name="hero-view"]');
    const show = () => {
      const chosen = radios.find((r) => r.checked)?.value || "text";
      for (const panel of $$("[data-hero-view]")) {
        panel.hidden = panel.dataset.heroView !== chosen;
        if (!panel.hidden) enter(panel);
      }
    };
    radios.forEach((r) => r.addEventListener("change", show));
  }

  function tabs() {
    for (const list of $$("[data-tabs]")) {
      const buttons = $$('[role="tab"]', list);
      const choose = (button, focus) => {
        for (const b of buttons) {
          const on = b === button;
          b.setAttribute("aria-selected", String(on));
          b.tabIndex = on ? 0 : -1;
          const panel = document.getElementById(b.getAttribute("aria-controls"));
          if (on && panel.hidden) enter(panel);
          panel.hidden = !on;
        }
        if (focus) button.focus();
      };
      buttons.forEach((b, i) => {
        b.addEventListener("click", () => choose(b, false));
        b.addEventListener("keydown", (e) => {
          const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: buttons.length - 1 }[e.key];
          if (next === undefined) return;
          e.preventDefault();
          choose(buttons[(next + buttons.length) % buttons.length], true);
        });
      });
    }
  }

  function faq() {
    for (const q of $$(".faq-q")) {
      q.addEventListener("click", () => {
        const open = q.getAttribute("aria-expanded") !== "true";
        q.setAttribute("aria-expanded", String(open));
        document.getElementById(q.getAttribute("aria-controls")).hidden = !open;
      });
    }
  }

  // ---- price calculator (the browser counterpart of the pricing arithmetic) ------------------------
  const PLANS = { ship: { rate: 50, minimum: 2500 }, scale: { rate: 25, minimum: 30000 } };
  const ONTOLOGY_RATE = 500;
  const AMOUNT = /^\d+(\.\d)?$/;
  const CALC_ERROR = "Enter a number from 0 to 100000 with at most one decimal";
  function tenths(raw) {
    if (raw === "") return 0;
    if (!AMOUNT.test(raw)) return null;
    const [whole, fraction = "0"] = raw.split(".");
    const value = Number(whole) * 10 + Number(fraction);
    return value <= 1000000 ? value : null;
  }
  const dollars = (cents) => `$${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
  function calculator() {
    const form = $("[data-calculator]");
    if (!form) return;
    const fields = [$("#calc-storage"), $("#calc-tokens")];
    const update = () => {
      const values = fields.map((input) => {
        const v = tenths(input.value);
        const error = document.getElementById(input.getAttribute("aria-describedby"));
        error.textContent = v === null ? CALC_ERROR : "";
        if (v === null) input.setAttribute("aria-invalid", "true");
        else input.removeAttribute("aria-invalid");
        return v;
      });
      if (values.includes(null)) return;
      const [g, m] = values;
      for (const [plan, { rate, minimum }] of Object.entries(PLANS)) {
        const usage = Math.ceil((g * rate) / 10) + Math.ceil((m * ONTOLOGY_RATE) / 10);
        const figure = $(`[data-estimate="${plan}"]`, form);
        const text = dollars(Math.max(usage, minimum));
        if (figure.textContent !== text) {
          figure.textContent = text;
          motion(figure, [{ color: "#ff571a" }, { color: "#ffffff" }], { duration: 420, easing: "ease-out" });
        }
        $(`[data-minimum="${plan}"]`, form).hidden = usage >= minimum;
      }
    };
    fields.forEach((input) => input.addEventListener("input", update));
    form.addEventListener("submit", (e) => e.preventDefault());
    update();
  }

  // ---- reveals and latency lanes ---------------------------------------------------------------------
  function reveals() {
    if (!("IntersectionObserver" in window)) return;
    // Sections reveal when a person scrolls them in; a script scrolling the page shows them as they are.
    let person = false;
    for (const kind of ["wheel", "touchmove", "keydown", "pointerdown"]) {
      window.addEventListener(kind, () => { person = true; }, { passive: true });
    }
    const below = $$(".reveal").filter((s) => s.getBoundingClientRect().top > window.innerHeight);
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const section = entry.target;
        io.unobserve(section);
        if (!person) continue;
        section.classList.add("in");
        motion(section, [{ opacity: 0, transform: "translateY(24px)" }, { opacity: 1, transform: "none" }],
          { duration: 420, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
      }
    }, { rootMargin: "0px 0px 12% 0px" });
    below.forEach((s) => io.observe(s));
    const lanes = $(".lanes");
    if (lanes) {
      new IntersectionObserver((entries) => {
        for (const entry of entries) lanes.classList.toggle("running", entry.isIntersecting);
      }).observe(lanes);
    }
  }

  // ---- View this page as -----------------------------------------------------------------------------
  function reader() {
    const box = $("#reader");
    const radios = $$('input[name="view-as"]');
    if (!box || !radios.length) return;
    const path = box.dataset.path;
    const setAddress = (open) => {
      const url = new URL(location.href);
      if (open) url.searchParams.set("view", "ai");
      else url.searchParams.delete("view");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    };
    const sizeLine = (bytes, chars) => {
      const kb = (Math.floor((bytes * 10) / 1024 + 0.5) / 10).toFixed(1);
      const t = Math.floor(chars / 4);
      return `${kb} KB \u00b7 ~${t < 1000 ? t : (Math.floor(t / 100) / 10).toFixed(1) + "k"} tokens`;
    };
    const render = (raw, textBody) => {
      box.replaceChildren();
      const bar = document.createElement("div");
      bar.className = "reader-bar";
      const req = document.createElement("div");
      req.className = "reader-request";
      const get = document.createElement("p");
      get.className = "reader-get";
      get.textContent = `GET ${path}`;
      const accept = document.createElement("p");
      accept.className = "reader-accept";
      accept.textContent = "Accept: text/markdown";
      req.append(get, accept);
      const size = document.createElement("p");
      size.className = "reader-size";
      size.textContent = sizeLine(raw.byteLength, [...textBody].length);
      const actions = document.createElement("div");
      actions.className = "reader-actions";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "capsule capsule-secondary";
      copy.textContent = "Copy";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(textBody);
          copy.textContent = "Copied";
        } catch {
          copy.textContent = "Copy failed";
        }
      });
      const rawLink = document.createElement("a");
      rawLink.className = "inline-link";
      rawLink.href = `${path}?md`;
      rawLink.textContent = "Raw";
      actions.append(copy, rawLink);
      bar.append(req, size, actions);
      const lines = document.createElement("ol");
      lines.className = "md-lines";
      const all = textBody.split("\n");
      if (all[all.length - 1] === "") all.pop();
      all.forEach((line, i) => {
        const li = document.createElement("li");
        li.className = "md-line";
        const no = document.createElement("span");
        no.className = "md-no";
        no.setAttribute("aria-hidden", "true");
        no.textContent = String(i + 1);
        const content = document.createElement("span");
        content.className = "md-text";
        const heading = /^(#{1,6})( .*)$/.exec(line);
        if (heading) {
          li.classList.add("md-heading");
          const mark = document.createElement("span");
          mark.className = "md-mark";
          mark.textContent = heading[1];
          content.append(mark, heading[2]);
        } else {
          content.textContent = line;
        }
        li.append(no, content);
        lines.append(li);
      });
      box.append(bar, lines);
    };
    const open = async () => {
      box.hidden = false;
      setAddress(true);
      try {
        const res = await fetch(`${path}?md`, { headers: { Accept: "text/markdown" } });
        const raw = await res.arrayBuffer();
        render(raw, new TextDecoder("utf-8").decode(raw));
      } catch {
        box.textContent = GENERIC;
      }
    };
    const close = () => {
      box.hidden = true;
      setAddress(false);
      const human = radios.find((r) => r.value === "human");
      human.checked = true;
    };
    radios.forEach((r) => r.addEventListener("change", () => (r.value === "ai" && r.checked ? open() : close())));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !box.hidden) close(); });
    if (radios.find((r) => r.value === "ai").checked) open();
  }

  // ---- contact form -------------------------------------------------------------------------------
  function contact() {
    const form = $("[data-contact]");
    if (!form) return;
    const alertBox = $("[data-form-alert]", form);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (form.dataset.busy) return;
      form.dataset.busy = "1";
      alertBox.hidden = true;
      for (const el of $$("[data-error-for]", form)) el.textContent = "";
      for (const el of $$("[aria-invalid]", form)) el.removeAttribute("aria-invalid");
      const body = { email: form.email.value, message: form.message.value, website: form.website.value };
      try {
        const res = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const answer = await res.json();
        if (answer.success) {
          const thanks = document.createElement("p");
          thanks.className = "thanks";
          thanks.setAttribute("role", "status");
          thanks.textContent = "Thanks. We will reply within one business day.";
          form.replaceWith(thanks);
          return;
        }
        const target = answer.error.field && $(`[data-error-for="${answer.error.field}"]`, form);
        if (target) {
          target.textContent = answer.error.message;
          form[answer.error.field].setAttribute("aria-invalid", "true");
          form[answer.error.field].focus();
        } else {
          alertBox.textContent = answer.error.message;
          alertBox.hidden = false;
        }
      } catch {
        alertBox.textContent = GENERIC;
        alertBox.hidden = false;
      } finally {
        delete form.dataset.busy;
      }
    });
  }

  stars();
  menus();
  sectionMarks();
  heroViews();
  tabs();
  faq();
  calculator();
  reveals();
  reader();
  contact();
})();
