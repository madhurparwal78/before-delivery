/** Wayticket client: progressive enhancement over the server-rendered pages. */

type El = HTMLElement;

const $ = <T extends El = HTMLElement>(sel: string, root: ParentNode | El = document): T | null =>
  root.querySelector(sel) as T | null;
const $$ = <T extends El = HTMLElement>(sel: string, root: ParentNode | El = document): T[] =>
  [...root.querySelectorAll(sel)] as T[];

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function announce(message: string): void {
  const region = $<HTMLElement>('[data-part="announcements"]');
  if (!region) return;
  region.textContent = "";
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}

function openOverlay(name: string): void {
  const el = $(`[data-overlay="${name}"]`);
  if (!el) return;
  el.hidden = false;
  el.classList.add("is-open");
  const first = el.querySelector<HTMLElement>("input, select, textarea, button:not(.close)");
  if (first) first.focus();
  else (el.querySelector<HTMLElement>("button") as HTMLElement).focus();
}

function closeOverlay(name: string, restoreFocus = true): void {
  const el = $(`[data-overlay="${name}"]`);
  if (!el || el.hidden) return;
  const opener = document.querySelector<HTMLElement>(`[data-open="${name}"]`);
  el.classList.remove("is-open");
  const done = () => {
    el.hidden = true;
  };
  if (reducedMotion()) done();
  else setTimeout(done, 320);
  if (restoreFocus && opener) opener.focus();
}

function isHidden(el: Element): boolean {
  return el.hasAttribute("hidden");
}

// ---------- public site behaviours ----------
function initPublic(): void {
  const page = document.body.dataset.page ?? "";
  const isPublic = ["/", "/occasions/school", "/occasions/weddings", "/occasions/company", "/occasions/festivals", "/fleet", "/terms"].includes(page);
  if (!isPublic) return;

  const topBar = $<HTMLElement>('[data-part="phone-top-bar"]');
  const slimBar = $<HTMLElement>('[data-part="slim-bar"]');
  const onScroll = () => {
    const y = window.scrollY;
    if (slimBar) {
      if (y >= 200) {
        if (slimBar.hidden) {
          slimBar.hidden = false;
          slimBar.classList.add("is-down");
        }
      } else if (!slimBar.hidden) {
        slimBar.hidden = true;
        slimBar.classList.remove("is-down");
      }
    }
    if (topBar) topBar.classList.toggle("shadow", y >= 25);
    const back = $<HTMLElement>('[data-back-to-top]');
    if (back) back.hidden = y < 600;
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const message = $<HTMLElement>('[data-part="message-us"]');
  if (message && !reducedMotion()) {
    let plays = 0;
    const timer = setInterval(() => {
      message.classList.add("ringing");
      setTimeout(() => message.classList.remove("ringing"), 640);
      plays++;
      if (plays >= 3) clearInterval(timer);
    }, 900);
  }

  // Sections rise once.
  const sections = $$("[data-observe]");
  const seen = new WeakSet<Element>();
  const riseObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && !seen.has(e.target)) {
        seen.add(e.target);
        if (!reducedMotion()) e.target.classList.add("section-rise");
      }
    }
  });
  sections.forEach((s) => {
    const r = s.getBoundingClientRect();
    if (r.top < window.innerHeight) seen.add(s);
    else riseObserver.observe(s);
  });

  // Client marks move only on press.
  let marksIndex = 0;
  const marksList = $<HTMLElement>("[data-marks-list]");
  const updateMarks = () => {
    if (!marksList) return;
    const items = $$("li", marksList);
    items.forEach((li, i) => {
      li.hidden = !(i >= marksIndex && i < marksIndex + 2);
    });
    for (const btn of $$("[data-marks]")) {
      const dir = (btn as HTMLElement).dataset.marks;
      const atEnd = dir === "earlier" ? marksIndex === 0 : marksIndex + 2 >= items.length;
      btn.setAttribute("aria-disabled", atEnd ? "true" : "false");
    }
  };
  document.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest("[data-marks]") as HTMLElement | null;
    if (!btn) return;
    const dir = btn.dataset.marks;
    const items = $$("li", marksList ?? document);
    if (dir === "earlier" && marksIndex > 0) marksIndex--;
    if (dir === "later" && marksIndex + 2 < items.length) marksIndex++;
    updateMarks();
    btn.focus();
  });
  updateMarks();

  // Rail tracking.
  const rail = $<HTMLElement>("[data-rail]");
  if (rail) {
    const links = $$("[data-rail-link]", rail);
    const sectionIds = links.map((a) => (a as HTMLAnchorElement).hash.slice(1));
    const onRailScroll = () => {
      let currentIdx = sectionIds.length - 1;
      for (let i = 0; i < sectionIds.length; i++) {
        const sec = document.getElementById(sectionIds[i]);
        if (sec && sec.getBoundingClientRect().top <= 120) currentIdx = i;
      }
      links.forEach((a, i) => {
        if (i === currentIdx) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      });
    };
    window.addEventListener("scroll", onRailScroll, { passive: true });
    onRailScroll();
    links.forEach((a) =>
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        const target = document.getElementById((a as HTMLAnchorElement).hash.slice(1));
        if (target) {
          target.scrollIntoView({ behavior: "auto", block: "start" });
          const y = window.scrollY;
          window.scrollTo(0, y - 90);
        }
        links.forEach((x) => x.removeAttribute("aria-current"));
        a.setAttribute("aria-current", "true");
      })
    );
  }

  // Accordions.
  for (const acc of $$("[data-accordion]")) {
    const btn = $<HTMLButtonElement>("button", acc);
    const panel = $(".accordion-panel", acc) as HTMLElement | null;
    if (!btn || !panel) continue;
    if (window.location.hash === "#" + panel.id) {
      btn.setAttribute("aria-expanded", "true");
      panel.hidden = false;
    }
    btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", open ? "false" : "true");
      panel.hidden = open;
    });
  }
}

// ---------- overlays: search, menus ----------
function initOverlays(): void {
  document.addEventListener("click", (ev) => {
    const opener = (ev.target as HTMLElement).closest("[data-open]") as HTMLElement | null;
    if (opener) {
      openOverlay(opener.dataset.open ?? "");
      return;
    }
    const closer = (ev.target as HTMLElement).closest("[data-close]") as HTMLElement | null;
    if (closer) {
      closeOverlay(closer.dataset.close ?? "");
      return;
    }
    const overlayRoot = (ev.target as HTMLElement).closest("[data-overlay]") as HTMLElement | null;
    if (overlayRoot && overlayRoot.classList.contains("overlay-menu") && ev.target === overlayRoot) {
      closeOverlay(overlayRoot.dataset.overlay ?? "");
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    const open = $$("[data-overlay]").filter((el) => !isHidden(el));
    if (open.length === 0) return;
    const inner = open[open.length - 1];
    const comboList = $<HTMLElement>(".combo-list:not([hidden])", inner);
    const calendar = $<HTMLElement>(".calendar:not([hidden])", inner);
    if (comboList) {
      comboList.hidden = true;
      return;
    }
    if (calendar) {
      calendar.hidden = true;
      return;
    }
    closeOverlay(inner.dataset.overlay ?? "");
  });

  const form = $<HTMLFormElement>("[data-search]");
  if (form) {
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const input = $("input", form) as HTMLInputElement;
      const results = $<HTMLElement>("[data-results]");
      if (!results) return;
      results.textContent = "";
      const r = await fetch(`/api/public/search?q=${encodeURIComponent(input.value)}`);
      const data = (await r.json()) as { results?: { title: string; path: string; excerpt: string }[]; error?: { message: string } };
      if (data.error) {
        results.innerHTML = `<li><p>${escape(data.error.message)}</p></li>`;
        announce(data.error.message);
        return;
      }
      const list = data.results ?? [];
      const copy = list.length === 0 ? `Nothing found for that search.` : `${list.length} results found.`;
      if (list.length === 0) {
        results.innerHTML = `<li><p>Nothing found for that search.</p></li>`;
      } else {
        results.innerHTML = list.map((x) => `<li><a href="${x.path}">${escape(x.title)}</a><p>${escape(x.excerpt)}</p></li>`).join("");
      }
      announce(copy);
    });
  }
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------- address combobox ----------
function initComboboxes(): void {
  for (const holder of $$("[data-combobox]")) {
    const input = $<HTMLInputElement>("input", holder);
    const list = $<HTMLElement>(".combo-list", holder);
    if (!input || !list) continue;
    const cache = new Map<string, { id: string; text: string }[]>();
    let seq = 0;
    let lastQuery = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const closeList = () => {
      list.hidden = true;
      input.removeAttribute("aria-activedescendant");
    };
    const openList = () => {
      list.hidden = false;
    };
    const ask = async () => {
      const q = input.value.trim();
      if (q.length < 3) {
        closeList();
        return;
      }
      if (cache.has(q)) {
        render(cache.get(q)!);
        return;
      }
      const my = ++seq;
      try {
        const r = await fetch(`/api/public/address/find?q=${encodeURIComponent(q)}`);
        const data = (await r.json()) as { suggestions?: { id: string; text: string }[]; error?: { message: string } };
        if (my !== seq) return;
        if (data.error) {
          announce(data.error.message);
          closeList();
          return;
        }
        cache.set(q, data.suggestions ?? []);
        render(cache.get(q)!);
      } catch {
        if (my === seq) {
          announce("We could not check this address. You can carry on and type it in full.");
          closeList();
        }
      }
    };
    const render = (items: { id: string; text: string }[]) => {
      list.innerHTML = items.map((x, i) => `<li role="option" id="${input.id}-opt-${i}" data-id="${x.id}" aria-selected="false">${escape(x.text)}</li>`).join("");
      if (items.length === 0) {
        closeList();
        announce("We could not check this address. You can carry on and type it in full.");
        return;
      }
      openList();
      input.setAttribute("aria-expanded", "true");
      announce(`${items.length} suggestions.`);
    };
    input.addEventListener("input", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(ask, 300);
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        if (!list.hidden) {
          closeList();
          ev.stopPropagation();
        }
        return;
      }
      if (list.hidden) return;
      const options = $$<HTMLElement>("li", list);
      const current = options.findIndex((o) => o.getAttribute("aria-selected") === "true");
      let next = current;
      if (ev.key === "ArrowDown") next = Math.min(current + 1, options.length - 1);
      else if (ev.key === "ArrowUp") next = Math.max(current - 1, 0);
      else if (ev.key === "Enter" || ev.key === "Tab") {
        if (current >= 0) {
          ev.preventDefault();
          choose(options[current]);
        }
        return;
      } else return;
      ev.preventDefault();
      options.forEach((o, i) => o.setAttribute("aria-selected", i === next ? "true" : "false"));
      if (options[next]) input.setAttribute("aria-activedescendant", options[next].id);
    });
    const choose = async (li: HTMLElement) => {
      const id = li.dataset.id ?? "";
      try {
        const r = await fetch(`/api/public/address/get/${encodeURIComponent(id)}`);
        const data = (await r.json()) as { text?: string };
        if (data.text) input.value = data.text;
      } catch {
        /* keep typed text */
      }
      closeList();
      input.dispatchEvent(new Event("change", { bubbles: true }));
      lastQuery = "";
      void lastQuery;
    };
    list.addEventListener("click", (ev) => {
      const li = (ev.target as HTMLElement).closest("li");
      if (li) choose(li as HTMLElement);
    });
    document.addEventListener("click", (ev) => {
      if (!holder.contains(ev.target as Node)) closeList();
    });
  }
}

// ---------- boot ----------
function boot(): void {
  initPublic();
  initOverlays();
  initComboboxes();
  const page = document.body.dataset.page ?? "";
  if (document.body.hasAttribute("data-desk-shell")) initDeskShell();
  if (page === "/quote/route" || page === "/quote/when" || page === "/quote/details") initQuoteForm();
  if (document.body.dataset.page === "private") initPrivate();
}

document.addEventListener("DOMContentLoaded", boot);

function initDeskShell(): void {
  // sign out, change password, wipe
  document.addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "sign-out") {
      await fetch("/api/auth/sign-out", { method: "POST" });
      window.location.href = "/sign-in";
      return;
    }
    if (action === "change-password") {
      openOverlay("change-password");
    }
  });
  const holder = $<HTMLElement>("[data-dialogs]");
  if (holder && !$(".change-password-dialog", holder)) {
    holder.insertAdjacentHTML(
      "beforeend",
      `<div class="dialog change-password-dialog" data-overlay="change-password" role="dialog" aria-modal="true" aria-labelledby="cp-title" hidden>
        <h2 id="cp-title">Change password</h2>
        <form data-change-password novalidate>
          <div class="field"><label class="field-label" for="cpCurrent">Current password</label><input id="cpCurrent" type="password" class="input" autocomplete="current-password"></div>
          <div class="field"><label class="field-label" for="cpNew">New password</label><input id="cpNew" type="password" class="input" autocomplete="new-password"></div>
          <div class="dialog-actions"><button type="submit" class="primary">Save password</button><button type="button" data-close="change-password">Close</button></div>
        </form>
      </div>`
    );
    const form = $<HTMLFormElement>("[data-change-password]");
    form?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = form.querySelector("button[type=submit]") as HTMLButtonElement;
      btn.textContent = "Working…";
      btn.setAttribute("aria-disabled", "true");
      const r = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: ($("#cpCurrent") as HTMLInputElement).value, newPassword: ($("#cpNew") as HTMLInputElement).value }),
      });
      btn.textContent = "Save password";
      btn.removeAttribute("aria-disabled");
      if (r.ok) {
        announce("Password changed.");
        closeOverlay("change-password");
      } else {
        const data = await r.json();
        announce(data.error?.message ?? "That did not save. Try again.");
      }
    });
  }
}

function initQuoteForm(): void {
  const wrap = $<HTMLElement>("[data-quote-form]");
  if (!wrap) return;
  void initCalendar;
}

function initCalendar(): void {
  void 0;
}

function initPrivate(): void {
  const token = document.body.dataset.token ?? "";
  const langSel = $<HTMLSelectElement>("[data-language]");
  if (langSel) {
    langSel.addEventListener("change", () => {
      const url = new URL(window.location.href);
      url.searchParams.set("lang", langSel.value);
      window.location.href = url.toString();
    });
  }
  const qPage = $<HTMLElement>("[data-q-page]");
  if (qPage) {
    document.addEventListener("click", async (ev) => {
      const btn = (ev.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "accept") {
        openOverlay("accept");
        return;
      }
      if (action === "confirm-accept") {
        const name = ($("#acceptName") as HTMLInputElement).value;
        btn.textContent = "Working…";
        const r = await fetch(`/api/q/${token}/accept`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        });
        btn.textContent = "Confirm acceptance";
        const data = await r.json();
        if (r.ok) {
          announce("Quote accepted.");
          window.location.reload();
        } else {
          const msg = $<HTMLElement>("[data-message]");
          if (msg) {
            msg.textContent = data.error?.message ?? "That did not save. Try again.";
            msg.hidden = false;
            msg.focus();
          }
          announce(data.error?.message ?? "That did not save. Try again.");
        }
        return;
      }
      if (action === "deposit-sent") {
        btn.textContent = "Working…";
        const r = await fetch(`/api/q/${token}/deposit-sent`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        if (r.ok) {
          announce("We're checking your payment");
          window.location.reload();
        } else {
          const data = await r.json();
          announce(data.error?.message ?? "That did not save. Try again.");
          btn.textContent = "I've sent the deposit";
        }
        return;
      }
    });
  }
  const rPage = $<HTMLElement>("[data-r-page]");
  if (rPage) {
    const queue: { stopId: string; kind: string; secondsAgo: number; repeatKey: string }[] = [];
    const loadQueue = () => {
      try {
        const saved = localStorage.getItem("wayticket-presses-" + token);
        if (saved) queue.push(...(JSON.parse(saved) as typeof queue));
      } catch {
        /* no storage */
      }
    };
    const saveQueue = () => {
      try {
        localStorage.setItem("wayticket-presses-" + token, JSON.stringify(queue));
      } catch {
        /* no storage */
      }
    };
    const updateWaiting = () => {
      const line = $<HTMLElement>("[data-waiting-line]");
      if (!line) return;
      if (queue.length === 0) {
        line.hidden = true;
        return;
      }
      line.hidden = false;
      const n = queue.length;
      const prefix = langSel?.value === "pl" ? "Do wysłania: " : `${n} waiting to send`;
      line.textContent = langSel?.value === "pl" ? `Do wysłania: ${n}` : prefix;
    };
    loadQueue();
    updateWaiting();
    document.addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest("[data-press]") as HTMLButtonElement | null;
      if (!btn || btn.disabled) return;
      const stopId = btn.dataset.stop ?? "";
      const kind = btn.dataset.press ?? "";
      btn.textContent = "Working…";
      btn.disabled = true;
      btn.setAttribute("aria-disabled", "true");
      const item = {
        stopId,
        kind,
        secondsAgo: 0,
        repeatKey: `${kind}-${stopId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
      sendItem(item, btn);
    });
    const sendItem = async (item: { stopId: string; kind: string; secondsAgo: number; repeatKey: string }, btn: HTMLButtonElement | null) => {
      queue.push(item);
      saveQueue();
      updateWaiting();
      try {
        const r = await fetch(`/api/r/${token}/presses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(item),
        });
        if (r.ok || r.status === 409) {
          const idx = queue.findIndex((x) => x.repeatKey === item.repeatKey);
          if (idx >= 0) queue.splice(idx, 1);
          saveQueue();
          updateWaiting();
          const kind = item.kind;
          const labels: Record<string, [string, string]> = {
            arrived: ["Arrived recorded.", "Zapisano: Na miejscu."],
            boarded: ["Boarded recorded.", "Zapisano: Wsiedli."],
            left: ["Left recorded.", "Zapisano: Odjazd."],
          };
          const pl = langSel?.value === "pl";
          announce(labels[kind] ? (pl ? labels[kind][1] : labels[kind][0]) : "Recorded.");
          if (btn && r.ok) {
            btn.textContent = kind === "arrived" ? (pl ? "Na miejscu" : "Arrived") : kind === "boarded" ? (pl ? "Wsiedli" : "Boarded") : pl ? "Odjazd" : "Left";
          }
        }
      } catch {
        if (btn) {
          const pl = langSel?.value === "pl";
          const text =
            item.kind === "arrived" ? (pl ? "Na miejscu" : "Arrived") : item.kind === "boarded" ? (pl ? "Wsiedli" : "Boarded") : pl ? "Odjazd" : "Left";
          btn.textContent = text;
          btn.disabled = false;
          btn.removeAttribute("aria-disabled");
        }
        const refresh = $<HTMLElement>(".run-refresh");
        if (refresh) refresh.hidden = false;
      }
    };
    const flush = async () => {
      while (queue.length) {
        const item = queue[0];
        item.secondsAgo = 0;
        try {
          const r = await fetch(`/api/r/${token}/presses`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(item),
          });
          if (r.ok || r.status === 409) {
            queue.shift();
            saveQueue();
            updateWaiting();
          } else break;
        } catch {
          break;
        }
      }
      if (queue.length === 0) {
        const refresh = $<HTMLElement>(".run-refresh");
        if (refresh) refresh.hidden = true;
      }
    };
    void flush;
    setInterval(() => {
      flush().catch(() => {});
    }, 4000);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }
}
