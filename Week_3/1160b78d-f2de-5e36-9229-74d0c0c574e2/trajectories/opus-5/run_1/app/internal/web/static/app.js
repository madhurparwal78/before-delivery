// Switchlamp screens: one socket per page, server-owned countdowns, and the
// keyboard paths the brief names.
(() => {
  "use strict";

  const viewer = document.getElementById("viewer-data");
  if (viewer) {
    document.body.dataset.zone = viewer.dataset.zone || "UTC";
    document.body.dataset.me = viewer.dataset.me || "";
    document.body.dataset.role = viewer.dataset.role || "";
  }
  const page = document.body.dataset.page || "";
  const live = document.getElementById("live-updates");
  const seen = new Set();
  let lastSeq = Number(document.body.dataset.lastSeq || 0);

  // ---------------------------------------------------------------- helpers

  function announce(text) {
    if (!live || !text) return;
    const line = document.createElement("p");
    line.textContent = text;
    live.appendChild(line);
    while (live.children.length > 20) live.removeChild(live.firstChild);
  }

  async function api(method, path, body, headers) {
    const options = { method, headers: Object.assign({ "Content-Type": "application/json" }, headers || {}) };
    if (body !== undefined && body !== null) options.body = JSON.stringify(body);
    const response = await fetch(path, options);
    let payload = null;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (err) {
        payload = null;
      }
    }
    return { ok: response.ok, status: response.status, body: payload, headers: response.headers };
  }

  // pending disables the control that started an async action until the reply
  // arrives, so a double click makes one request.
  async function pending(control, run) {
    if (!control) return run();
    if (control.disabled) return undefined;
    control.disabled = true;
    control.setAttribute("aria-busy", "true");
    const slow = window.setTimeout(() => announce("Working on it."), 1000);
    try {
      return await run();
    } finally {
      window.clearTimeout(slow);
      control.disabled = false;
      control.removeAttribute("aria-busy");
    }
  }

  function showProblems(scope, errors) {
    const box = (scope || document).querySelector('[aria-label="Problems to fix"]');
    if (!box) return;
    box.innerHTML = "";
    const entries = Object.entries(errors || {});
    if (!entries.length) {
      box.hidden = true;
      return;
    }
    const list = document.createElement("ul");
    entries.forEach(([field, sentence]) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = sentence;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const target = document.getElementById(fieldToId(field));
        if (target) target.focus();
      });
      item.appendChild(link);
      list.appendChild(item);
      const field_target = document.getElementById(fieldToId(field));
      if (field_target && field_target.parentElement) {
        let note = field_target.parentElement.querySelector(".field-error");
        if (!note) {
          note = document.createElement("span");
          note.className = "field-error";
          field_target.parentElement.appendChild(note);
        }
        note.textContent = sentence;
      }
    });
    box.appendChild(list);
    box.hidden = false;
  }

  function fieldToId(field) {
    return field.replace(/\./g, "-").replace(/_/g, "-");
  }

  function countdownText(seconds) {
    if (seconds < 0) seconds = 0;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
  }

  function localLabel(instant, zone) {
    const date = new Date(instant);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short",
    }).formatToParts(date);
    const get = (type) => (parts.find((p) => p.type === type) || {}).value || "";
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} ${get("timeZoneName")}`;
  }

  function clockTime(instant, zone) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(instant));
  }

  // Dialogs keep focus inside, close on Escape and give focus back.
  function openDialog(dialog, opener) {
    if (!dialog) return;
    dialog.returnFocusTo = opener || document.activeElement;
    dialog.showModal();
    const first = dialog.querySelector("input, select, textarea, button");
    if (first) first.focus();
  }

  function closeDialog(dialog) {
    if (!dialog || !dialog.open) return;
    dialog.close();
    const opener = dialog.returnFocusTo;
    if (opener && document.contains(opener)) opener.focus();
  }

  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog(dialog);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll(
        'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
      )).filter((el) => !el.disabled && el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  });

  // ---------------------------------------------------------------- socket

  const listeners = {};
  function on(type, handler) {
    (listeners[type] = listeners[type] || []).push(handler);
  }

  function openSocket() {
    const needsSocket = document.body.dataset.stakeholder !== "true" &&
      !["sign-in", "status", "ack", "unsubscribe", "not-found"].includes(page);
    if (!needsSocket) return;
    let socket = null;
    let ready = false;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/api/live?after=${lastSeq}`);
      socket.addEventListener("open", () => {
        ready = true;
        socket.send(JSON.stringify({ type: "hello" }));
      });
      socket.addEventListener("message", (event) => {
        let message = null;
        try {
          message = JSON.parse(event.data);
        } catch (err) {
          return;
        }
        if (message.type !== "countdown") {
          if (seen.has(message.seq)) return;
          seen.add(message.seq);
          if (message.seq > lastSeq) lastSeq = message.seq;
        }
        (listeners[message.type] || []).forEach((handler) => handler(message));
      });
      socket.addEventListener("close", (event) => {
        ready = false;
        if (event.code === 4401) {
          window.location.href = "/sign-in?signed-out=1";
          return;
        }
        if (event.code === 4403) {
          window.location.href = "/?role-changed=1";
          return;
        }
        window.setTimeout(connect, 700);
      });
    };
    connect();
    window.sendLive = (value) => {
      if (ready && socket) socket.send(JSON.stringify(value));
    };
  }

  on("incident", (message) => {
    if (message.data && message.data.announce) announce(message.data.announce);
  });

  // ---------------------------------------------------------------- chrome

  const signOut = document.getElementById("sign-out");
  if (signOut) {
    signOut.addEventListener("click", () => pending(signOut, async () => {
      await api("DELETE", "/api/session");
      window.location.href = "/sign-in?signed-out=1";
    }));
  }

  async function refreshNotices() {
    const holder = document.getElementById("notices-for-you");
    if (!holder) return;
    const response = await api("GET", "/api/incidents?status=triggered&limit=100");
    if (!response.ok || !response.body) return;
    const mine = (response.body.items || []).filter((item) =>
      (item.holders || []).some((h) => h.name === document.body.dataset.me));
    holder.textContent = `${mine.length} incidents need you`;
  }

  // ---------------------------------------------------------------- sign in

  const signInForm = document.getElementById("sign-in-form");
  if (signInForm) {
    signInForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = signInForm.querySelector('button[type="submit"]');
      await pending(button, async () => {
        const response = await api("POST", "/api/session", {
          email: document.getElementById("email").value,
          password: document.getElementById("password").value,
        });
        if (response.ok) {
          window.location.href = "/oncall";
          return;
        }
        showProblems(signInForm, { email: "That email and password do not match." });
      });
    });
  }

  // ---------------------------------------------------------------- status

  if (page === "status") {
    const subscribe = document.getElementById("subscribe-form");
    if (subscribe) {
      subscribe.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = subscribe.querySelector('button[type="submit"]');
        await pending(button, async () => {
          const email = document.getElementById("subscribe-email").value;
          const response = await api("POST", "/api/status/subscribers", { email });
          const result = document.getElementById("subscribe-result");
          if (response.ok) {
            showProblems(subscribe, {});
            result.textContent = "You are subscribed to status updates.";
            return;
          }
          result.textContent = "";
          showProblems(subscribe, (response.body || {}).errors);
        });
      });
    }

    let statusTag = null;
    const poll = async () => {
      const headers = statusTag ? { "If-None-Match": statusTag } : {};
      const response = await fetch("/api/status", { headers });
      if (response.status === 304) return;
      statusTag = response.headers.get("ETag");
      const view = await response.json();
      paintStatus(view);
    };
    const paintStatus = (view) => {
      const headline = document.getElementById("status-headline");
      if (headline && headline.textContent !== view.headline) headline.textContent = view.headline;
      const services = document.getElementById("status-services");
      if (services) {
        services.innerHTML = "";
        view.services.forEach((service) => {
          const item = document.createElement("li");
          item.innerHTML = `<span class="service-name"></span> <span class="status-word"></span>`;
          item.querySelector(".service-name").textContent = service.name;
          item.querySelector(".status-word").textContent = service.status;
          services.appendChild(item);
        });
      }
      const banners = document.getElementById("maintenance-banners");
      if (banners) {
        banners.innerHTML = "";
        (view.maintenance || []).forEach((window_) => {
          const bar = document.createElement("p");
          bar.setAttribute("role", "status");
          bar.setAttribute("aria-label", "Maintenance banner");
          bar.className = "notice-bar";
          bar.textContent = `Maintenance on ${window_.service} until ${localLabel(window_.ends_at, "America/Chicago")}`;
          banners.appendChild(bar);
        });
      }
      const updates = document.getElementById("status-updates");
      if (updates) {
        updates.innerHTML = "";
        if (!view.updates.length) {
          const empty = document.createElement("li");
          empty.className = "empty";
          empty.textContent = "No updates published.";
          updates.appendChild(empty);
        }
        view.updates.forEach((update) => {
          const item = document.createElement("li");
          const title = document.createElement("h3");
          title.textContent = update.title;
          const state = document.createElement("p");
          state.className = "status-word";
          state.textContent = update.state_label || update.state;
          const body = document.createElement("p");
          body.textContent = update.body;
          const at = document.createElement("p");
          at.className = "mono";
          at.textContent = update.published_at ? localLabel(update.published_at, "America/Chicago") : "";
          item.append(title, state, body, at);
          updates.appendChild(item);
        });
      }
      swapPlate(view.plate);
    };
    const swapPlate = (plate) => {
      const frame = document.getElementById("plate-frame");
      if (!frame || frame.dataset.plate === plate) return;
      frame.dataset.plate = plate;
      const dusk = frame.querySelector(".plate-dusk");
      const night = frame.querySelector(".plate-night");
      const shown = plate === "night" ? night : dusk;
      const hidden = plate === "night" ? dusk : night;
      shown.hidden = false;
      shown.removeAttribute("aria-hidden");
      shown.style.opacity = "0";
      window.requestAnimationFrame(() => {
        shown.style.opacity = "1";
      });
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const finish = () => {
        hidden.hidden = true;
        hidden.setAttribute("aria-hidden", "true");
      };
      if (reduced) finish();
      else window.setTimeout(finish, 900);
    };
    window.setInterval(poll, 5000);
  }

  // ---------------------------------------------------------------- export

  window.switchlamp = {
    api, announce, pending, showProblems, countdownText, localLabel, clockTime,
    openDialog, closeDialog, on, page,
  };

  // At phone width the fixed action bar never hides the focused field.
  document.addEventListener("focusin", (event) => {
    if (!window.matchMedia("(max-width: 599px)").matches) return;
    const field = event.target;
    if (!field.matches || !field.matches("input, select, textarea")) return;
    const bar = document.querySelector(".phone-bar");
    if (!bar) return;
    const box = field.getBoundingClientRect();
    const barTop = bar.getBoundingClientRect().top;
    if (box.bottom > barTop) {
      window.scrollBy({ top: box.bottom - barTop + 16 });
    }
  });

  openSocket();
  if (page === "incidents" || page === "incident") refreshNotices();
})();
