"use strict";
(() => {
  // src/ui/types.ts
  var CLASS_LABELS = {
    mark: "Mark",
    spot_icon: "Spot icon",
    pictogram: "Pictogram",
    ui_icon: "UI icon",
    illustration: "Illustration",
    photograph: "Photograph"
  };
  var APPLICATION_LABELS = {
    internal_comms: "Internal comms",
    social: "Social",
    press_article: "Press article",
    event: "Event",
    film: "Film",
    packaging: "Packaging",
    co_brand: "Co-brand",
    merchandise: "Merchandise",
    partnership: "Partnership"
  };
  async function api(path, init) {
    const res = await fetch(path, {
      ...init,
      headers: init?.body instanceof FormData ? void 0 : { "content-type": "application/json" }
    });
    if (res.status === 204) return void 0;
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error(data?.message ?? "Something went wrong.");
      err.code = data?.error;
      err.status = res.status;
      throw err;
    }
    return data;
  }
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (value === void 0 || value === null) continue;
      if (value === true) node.setAttribute(name, "");
      else if (value !== false) node.setAttribute(name, String(value));
    }
    for (const child of children) {
      if (child === null || child === void 0) continue;
      node.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }
  function setStatus(message) {
    const slot = document.getElementById("page-status");
    if (slot) slot.textContent = message;
  }
  function setAlert(message, slot) {
    if (!slot) return;
    slot.replaceChildren();
    const alert = el("div", { class: "alert", role: "alert" }, message);
    slot.append(alert);
  }
  function busyButton(button, label) {
    const original = button.textContent ?? "";
    const disabled = button.disabled;
    button.textContent = label;
    button.disabled = true;
    return () => {
      button.textContent = original;
      button.disabled = disabled;
    };
  }
  async function loadMe() {
    try {
      return await api("/api/me");
    } catch {
      return null;
    }
  }
  function formatDay(date, today) {
    if (!date) return "";
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) return date;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
  }
  function formatDateTime(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      day: "numeric",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t)?.value ?? "0";
    return `${get("day")} ${months[Number(get("month")) - 1]} ${get("year")} ${get("hour")}:${get("minute")}`;
  }

  // src/ui/dialog.ts
  function trapFocus(container, event) {
    if (event.key !== "Tab") return;
    const focusables = focusableIn(container);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !container.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      event.preventDefault();
      first.focus();
    }
  }
  function focusableIn(root) {
    const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return [...root.querySelectorAll(selector)].filter(
      (node) => node.offsetParent !== null || node === document.activeElement
    );
  }
  function openSheet(opts) {
    const backdrop = el("div", { class: "dialog-backdrop" });
    const dialog = el("dialog", { class: "sheet-dialog", "aria-label": opts.label });
    const form = el("form");
    const body = el("div");
    form.append(body);
    const cancelButton = el("button", { type: "button", class: "ghost" }, "Cancel");
    form.append(cancelButton);
    dialog.append(form);
    document.body.append(backdrop, dialog);
    const focusFirst = () => {
      const list = focusableIn(dialog).filter((n) => n !== cancelButton);
      (list[0] ?? cancelButton).focus();
    };
    const close = () => {
      dialog.close();
      dialog.remove();
      backdrop.remove();
      document.removeEventListener("keydown", onKeydown, true);
      opts.opener.focus();
      opts.onClosed?.();
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      trapFocus(dialog, event);
    };
    cancelButton.addEventListener("click", () => close());
    backdrop.addEventListener("click", () => close());
    document.addEventListener("keydown", onKeydown, true);
    opts.build(body);
    dialog.showModal();
    if (dialog.classList.contains("sheet-dialog") && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dialog.animate(
        [
          { transform: "translateY(100%)" },
          { transform: "translateY(0)" }
        ],
        { duration: 250, easing: "cubic-bezier(0.33, 1, 0.68, 1)" }
      );
    }
    setTimeout(focusFirst, 30);
    return { container: dialog, close };
  }
  function openDialog(opts) {
    const dialog = el("dialog", { class: "plain-dialog", "aria-label": opts.label });
    const body = el("div");
    const cancelButton = el("button", { type: "button" }, "Cancel");
    dialog.append(body, cancelButton);
    document.body.append(dialog);
    const close = () => {
      dialog.close();
      dialog.remove();
      document.removeEventListener("keydown", onKeydown, true);
      opts.opener.focus();
      opts.onClosed?.();
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      trapFocus(dialog, event);
    };
    cancelButton.addEventListener("click", () => close());
    document.addEventListener("keydown", onKeydown, true);
    opts.build(body);
    dialog.showModal();
    const focusables = focusableIn(dialog);
    (focusables[0] ?? cancelButton).focus();
    return { container: dialog, close };
  }
  function reducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function isPhone() {
    return window.innerWidth < 768;
  }

  // src/ui/assembly.ts
  function initHome() {
    const stage = document.getElementById("home-stage");
    const opening = document.getElementById("opening-cell");
    const promise = document.getElementById("promise-card");
    const mosaic = document.getElementById("mosaic");
    if (!stage || !opening || !promise || !mosaic) return;
    const cue = document.getElementById("jump-cue");
    if (cue) {
      cue.addEventListener("click", () => {
        jumpToMosaic(mosaic);
      });
    }
    const tiles = [...mosaic.querySelectorAll(".tile")];
    for (const tile of tiles) {
      tile.addEventListener("focus", () => {
        if (!shouldPin()) return;
        jumpToMosaic(mosaic, tile);
      });
    }
    if (!shouldPin()) {
      observeFade();
      return;
    }
    document.body.classList.add("assembling");
    stage.classList.add("pinned");
    document.body.style.setProperty("--stage-height", "2700px");
    let ticking = false;
    const apply = () => {
      ticking = false;
      const progress = Math.min(1, Math.max(0, window.scrollY / 2700));
      setProgress(progress, { opening, promise, mosaic });
    };
    window.addEventListener(
      "scroll",
      () => {
        if (!ticking) {
          ticking = true;
          window.requestAnimationFrame(apply);
        }
      },
      { passive: true }
    );
    apply();
    window.addEventListener("resize", () => {
      if (!shouldPin()) {
        document.body.classList.remove("assembling");
        stage.classList.remove("pinned");
        clearProgress({ opening, promise, mosaic });
      }
    });
    observeFade();
  }
  function shouldPin() {
    return !reducedMotion() && window.innerWidth >= 768;
  }
  function jumpToMosaic(mosaic, tile) {
    const target = tile ?? mosaic.querySelector(".tile");
    if (shouldPin()) {
      window.scrollTo({ top: 2700, behavior: "auto" });
    } else {
      mosaic.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    }
    if (target) {
      if (reducedMotion()) {
        target.focus();
      } else {
        setTimeout(() => target.focus(), shouldPin() ? 0 : 300);
      }
    }
  }
  function setProgress(progress, parts) {
    const { opening, promise, mosaic } = parts;
    const fade = clamp01(progress / 0.2);
    opening.style.opacity = String(1 - fade);
    opening.style.transform = `translateY(${-fade * 24}px)`;
    const sideIn = clamp01((progress - 0.2) / 0.3);
    const mid = clamp01((progress - 0.5) / 0.25);
    const final = clamp01((progress - 0.75) / 0.25);
    const openingOpacity = clamp01(1 - progress / 0.2);
    const cardStart = lerp(14, 26, progress);
    const cardSize = progress < 0.5 ? 500 : lerp(500, 90, mid);
    promise.style.position = "fixed";
    promise.style.left = "50%";
    promise.style.top = "50%";
    promise.style.transform = `translate(-50%, -50%) scale(${cardSize / 500})`;
    promise.style.opacity = progress < 0.75 ? "1" : String(1 - final * 0);
    promise.style.zIndex = "5";
    const sideWidth = progress < 0.5 ? lerp(70, 195, sideIn) : lerp(195, 394, mid);
    const stageWidth = window.innerWidth;
    mosaic.style.setProperty("--side-width", `${sideWidth}px`);
    if (progress >= 1) {
      document.body.classList.remove("assembling");
      stageUnpin(mosaic);
    } else {
      document.body.classList.add("assembling");
    }
    void parts.opening;
  }
  function stageUnpin(mosaic) {
    mosaic.style.setProperty("--side-width", "");
  }
  function clearProgress(parts) {
    parts.opening.style.opacity = "";
    parts.opening.style.transform = "";
    parts.promise.style.position = "";
    parts.promise.style.left = "";
    parts.promise.style.top = "";
    parts.promise.style.transform = "";
    parts.promise.style.opacity = "";
    parts.mosaic.style.removeProperty("--side-width");
  }
  function clamp01(value) {
    return Math.min(1, Math.max(0, value));
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function observeFade() {
    const sections = [document.getElementById("opening-cell"), document.getElementById("promise-card"), document.getElementById("mosaic")].filter(
      (node) => node !== null
    );
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target;
          if (entry.isIntersecting) {
            target.classList.add("fade-in");
            observer.unobserve(target);
          }
        }
      },
      { threshold: 0.15 }
    );
    for (const section of sections) observer.observe(section);
  }
  var styleTag = document.createElement("style");
  styleTag.textContent = `
.fade-in { animation: fadeIn 0.3s ease-out both; }
@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
@media (prefers-reduced-motion: reduce) {
  .fade-in { animation: none; opacity: 1; }
  .assembling #promise-card, .assembling #opening-cell { position: relative !important; left: auto !important; top: auto !important; transform: none !important; }
}
`;
  document.head.append(styleTag);

  // src/ui/figures.ts
  function initWeight() {
    const slider = document.getElementById("weight-slider");
    const readout = document.getElementById("weight-readout");
    const specimen = document.getElementById("weight-specimen");
    const announcement = document.getElementById("weight-announcement");
    if (!slider || !readout || !specimen || !announcement) return;
    let timer;
    let last = Number(slider.value);
    slider.addEventListener("input", () => {
      const value = Number(slider.value);
      last = value;
      readout.textContent = `Weight ${value}`;
      specimen.style.fontWeight = String(value);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        announcement.textContent = `Weight ${last}`;
      }, weightDelay());
    });
  }
  function weightDelay() {
    return window.__weightDelay ?? 300;
  }
  function initWheel() {
    const wheel = document.getElementById("palette-wheel");
    const table = document.getElementById("swatch-table");
    const status = document.getElementById("swatch-filter");
    if (!wheel || !table || !status) return;
    const discs = [...wheel.querySelectorAll(".wheel-disc")];
    const showAll = document.getElementById("show-all");
    if (discs.length === 0) return;
    let focusedIndex = 0;
    let selected = null;
    const applySelection = () => {
      for (const disc of discs) {
        disc.tabIndex = discs.indexOf(disc) === focusedIndex ? 0 : -1;
        disc.setAttribute("aria-pressed", selected === disc.dataset.family ? "true" : "false");
      }
      for (const row of table.querySelectorAll("tbody tr")) {
        const rowFamily = row.dataset.family;
        row.hidden = selected !== null && rowFamily !== selected;
      }
      if (selected) {
        const count = [...table.querySelectorAll("tbody tr")].filter(
          (row) => row.dataset.family === selected
        ).length;
        status.textContent = `${count} swatches in ${selected}`;
      } else {
        const count = table.querySelectorAll("tbody tr").length;
        status.textContent = `${count} swatches`;
      }
    };
    const select = (family) => {
      selected = family;
      applySelection();
    };
    for (const disc of discs) {
      disc.addEventListener("click", () => {
        focusedIndex = discs.indexOf(disc);
        select(disc.dataset.family ?? null);
      });
      disc.addEventListener("keydown", (event) => {
        const index = discs.indexOf(disc);
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          focusedIndex = (index + 1) % discs.length;
          discs[focusedIndex].focus();
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          focusedIndex = (index - 1 + discs.length) % discs.length;
          discs[focusedIndex].focus();
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select(disc.dataset.family ?? null);
        }
      });
    }
    if (showAll) {
      showAll.addEventListener("click", () => {
        select(null);
        status.textContent = "20 swatches";
      });
    }
    applySelection();
  }
  var TRACKS = [
    { property: "Opacity", keyframes: [{ time: 0, value: 0 }, { time: 2, value: 1 }, { time: 10, value: 1 }, { time: 12, value: 0 }] },
    { property: "Scale", keyframes: [{ time: 0, value: 0.8 }, { time: 3, value: 1 }, { time: 12, value: 1 }] },
    { property: "Offset X", keyframes: [{ time: 0, value: -40 }, { time: 4, value: 0 }, { time: 8, value: 0 }, { time: 12, value: 40 }] },
    { property: "Offset Y", keyframes: [{ time: 0, value: 24 }, { time: 3, value: 0 }, { time: 12, value: 0 }] },
    { property: "Rotate", keyframes: [{ time: 0, value: -6 }, { time: 6, value: 0 }, { time: 12, value: 6 }] },
    { property: "Blur", keyframes: [{ time: 0, value: 8 }, { time: 2, value: 0 }, { time: 10, value: 0 }, { time: 12, value: 4 }] }
  ];
  function interpolate(track, time) {
    const frames = track.keyframes;
    if (time <= frames[0].time) return frames[0].value;
    for (let i = 0; i < frames.length - 1; i++) {
      const a = frames[i];
      const b = frames[i + 1];
      if (time >= a.time && time <= b.time) {
        const span = b.time - a.time;
        const t = span === 0 ? 0 : (time - a.time) / span;
        return a.value + (b.value - a.value) * t;
      }
    }
    return frames[frames.length - 1].value;
  }
  function roundHalfUp(value) {
    return Math.sign(value) * Math.round(Math.abs(value) * 100 + Number.EPSILON) / 100;
  }
  function mmss(seconds) {
    const whole = Math.round(seconds);
    return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
  }
  function initMotion() {
    const tracks = document.getElementById("tracks");
    const playhead = document.getElementById("playhead");
    const timeline = document.getElementById("timeline");
    const readout = document.getElementById("playhead-readout");
    const keyframes = document.getElementById("keyframes");
    const valuesBody = document.getElementById("values-body");
    const playButton = document.getElementById("play-button");
    if (!tracks || !playhead || !timeline || !readout || !keyframes || !valuesBody || !playButton) return;
    for (const track of TRACKS) {
      tracks.append(el("li", {}, `${track.property}, ${track.keyframes.length} keyframes`));
    }
    for (const track of TRACKS) {
      for (const frame of track.keyframes) {
        const button = el("button", { type: "button" }, `${track.property} keyframe at ${mmss(frame.time)}`);
        button.addEventListener("click", () => {
          playhead.value = String(frame.time);
          render2();
        });
        keyframes.append(button);
      }
    }
    let playing = false;
    let startValue = 0;
    let startTime = 0;
    const render2 = () => {
      const value = Number(playhead.value);
      readout.textContent = `${mmss(value)} / 00:12`;
      valuesBody.replaceChildren();
      for (const track of TRACKS) {
        const interpolated = interpolate(track, value);
        const rounded = roundHalfUp(interpolated);
        valuesBody.append(
          el("tr", {}, el("th", { scope: "row" }, track.property), el("td", {}, rounded.toFixed(2)))
        );
      }
    };
    playhead.addEventListener("input", render2);
    const pointToTime = (event) => {
      const rect = timeline.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      return Math.round(ratio * 12);
    };
    timeline.addEventListener("pointerdown", (event) => {
      if (event.target === playhead) return;
      playhead.value = String(pointToTime(event));
      render2();
      const move = (moveEvent) => {
        playhead.value = String(pointToTime(moveEvent));
        render2();
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    const stop = () => {
      playing = false;
      playButton.textContent = "Play";
    };
    playButton.addEventListener("click", () => {
      if (playing) {
        stop();
        return;
      }
      if (reducedMotion()) {
        playhead.value = "12";
        render2();
        return;
      }
      playing = true;
      playButton.textContent = "Pause";
      startValue = Number(playhead.value);
      startTime = performance.now();
      const step = () => {
        if (!playing) return;
        const elapsed = (performance.now() - startTime) / 1e3;
        const next = startValue + elapsed;
        if (next >= 12) {
          playhead.value = "12";
          render2();
          stop();
          return;
        }
        playhead.value = String(Math.floor(next));
        render2();
        window.requestAnimationFrame(step);
      };
      window.requestAnimationFrame(step);
    });
    render2();
    initCurve();
  }
  var DEFAULT_CURVE = { x1: 0.3, y1: 0, x2: 0.2, y2: 1 };
  function printedCurve(curve) {
    return `cubic-bezier(${curve.x1.toFixed(2)}, ${curve.y1.toFixed(2)}, ${curve.x2.toFixed(2)}, ${curve.y2.toFixed(2)})`;
  }
  function initCurve() {
    const plot = document.getElementById("curve-plot");
    const svg = document.getElementById("curve-svg");
    const handle1 = document.getElementById("handle-1");
    const handle2 = document.getElementById("handle-2");
    const value1 = document.getElementById("handle-1-value");
    const value2 = document.getElementById("handle-2-value");
    const printed = document.getElementById("printed-curve");
    const reset = document.getElementById("reset-curve");
    const replay = document.getElementById("replay-curve");
    const demo = document.getElementById("curve-demo");
    const block = document.getElementById("demo-block");
    if (!plot || !svg || !handle1 || !handle2 || !value1 || !value2 || !printed || !reset || !replay || !demo || !block) return;
    const state = { ...DEFAULT_CURVE };
    const position = () => {
      return state;
    };
    const plotPoint = (x, y) => {
      const left = x / 1 * 320 - 16;
      const top = (1 - (y + 0.5) / 2) * 320 - 16;
      return { left, top };
    };
    const draw = () => {
      const { x1, y1, x2, y2 } = state;
      handle1.style.left = `${x1 / 1 * 320 - 16}px`;
      handle1.style.top = `${(1 - (y1 + 0.5) / 2) * 320 - 16}px`;
      handle2.style.left = `${x2 / 1 * 320 - 16}px`;
      handle2.style.top = `${(1 - (y2 + 0.5) / 2) * 320 - 16}px`;
      value1.textContent = `x ${x1.toFixed(2)}, y ${y1.toFixed(2)}`;
      value2.textContent = `x ${x2.toFixed(2)}, y ${y2.toFixed(2)}`;
      handle1.setAttribute("aria-describedby", "handle-1-value");
      handle2.setAttribute("aria-describedby", "handle-2-value");
      const p1 = plotPoint(x1, y1);
      const p2 = plotPoint(x2, y2);
      const path = `M 0 320 C ${(p1.left + 16).toFixed(1)} ${(p1.top + 16).toFixed(1)}, ${(p2.left + 16).toFixed(1)} ${(p2.top + 16).toFixed(1)}, 320 0`;
      svg.innerHTML = `<path d="${path}" stroke="#17161C" stroke-width="2" fill="none"></path>`;
      printed.textContent = printedCurve(state);
      const curve = printedCurve(state);
      demo.style.setProperty("--demo-curve", curve);
    };
    const snap = (value) => Math.round(value * 100) / 100;
    const moveTo = (handle, x, y) => {
      const clampedX = Math.min(1, Math.max(0, snap(x)));
      const clampedY = Math.min(1.5, Math.max(-0.5, snap(y)));
      if (handle === "h1") {
        state.x1 = clampedX;
        state.y1 = clampedY;
      } else {
        state.x2 = clampedX;
        state.y2 = clampedY;
      }
      draw();
    };
    const pointerFrom = (event) => {
      const rect = plot.getBoundingClientRect();
      const width = rect.width || 320;
      const height = rect.height || 320;
      const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / width));
      const y = Math.min(1.5, Math.max(-0.5, (1 - (event.clientY - rect.top) / height) * 2 - 0.5));
      return { x, y };
    };
    const wireHandle = (button, which) => {
      button.addEventListener("keydown", (event) => {
        const step = event.shiftKey ? 0.1 : 0.01;
        const key = which === "h1" ? { x: state.x1, y: state.y1 } : { x: state.x2, y: state.y2 };
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          moveTo(which, key.x + (event.key === "ArrowRight" ? step : -step), key.y);
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          moveTo(which, key.x, key.y + (event.key === "ArrowUp" ? step : -step));
        }
      });
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const move = (moveEvent) => {
          const point = pointerFrom(moveEvent);
          moveTo(which, point.x, point.y);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
    };
    wireHandle(handle1, "h1");
    wireHandle(handle2, "h2");
    reset.addEventListener("click", () => {
      state.x1 = DEFAULT_CURVE.x1;
      state.y1 = DEFAULT_CURVE.y1;
      state.x2 = DEFAULT_CURVE.x2;
      state.y2 = DEFAULT_CURVE.y2;
      draw();
    });
    const playDemo = () => {
      const curve = printedCurve(state);
      block.style.transition = "none";
      block.style.transform = "translateX(0)";
      if (reducedMotion()) {
        block.style.transition = "none";
        block.style.transform = `translateX(calc(100% - 40px))`;
        return;
      }
      window.requestAnimationFrame(() => {
        block.style.transition = `transform 1s ${curve}`;
        block.style.transform = `translateX(calc(100% - 40px))`;
      });
    };
    replay.addEventListener("click", playDemo);
    block.addEventListener("transitionend", () => {
      if (block.style.transform.includes("100%")) {
        window.setTimeout(() => {
          block.style.transition = "none";
          block.style.transform = "translateX(0)";
        }, 400);
      }
    });
    draw();
  }
  function initRuleFocus() {
    const rule = window.__focusRule;
    if (!rule) return;
    const item = document.getElementById(rule);
    if (!item) return;
    item.scrollIntoView({ block: "center", behavior: "auto" });
    item.setAttribute("tabindex", "-1");
    item.focus();
  }

  // src/ui/library.ts
  var me = null;
  async function initLibrary() {
    me = await loadMe();
    const classFilter = document.getElementById("class-filter");
    const search = document.getElementById("asset-search");
    const results = document.getElementById("library-results");
    const root = document.getElementById("cards-root");
    if (!classFilter || !search || !results || !root) return;
    classFilter.append(el("option", { value: "" }, "All classes"));
    for (const [key, label] of Object.entries(CLASS_LABELS)) {
      classFilter.append(el("option", { value: key }, label));
    }
    const state = { cards: [], filters: { className: "", availability: [], q: "" } };
    const fetchCards = async () => {
      const params = new URLSearchParams();
      if (state.filters.className) params.set("class", state.filters.className);
      for (const badge of state.filters.availability) params.append("availability", badge);
      if (state.filters.q) params.set("q", state.filters.q);
      const data = await api(`/api/library?${params.toString()}`);
      state.cards = data.cards;
      renderCards();
      const countSentence = `${data.count} ${data.count === 1 ? "asset" : "assets"}`;
      const extras = [];
      if (state.filters.className) extras.push(CLASS_LABELS[state.filters.className] ?? "");
      for (const badge of ["Available", "Request required", "Restricted", "Retired"]) {
        if (state.filters.availability.includes(badge)) extras.push(badge);
      }
      if (state.filters.q) extras.push(`matching "${state.filters.q}"`);
      results.textContent = extras.length > 0 ? `${countSentence}, ${extras.join(", ")}` : countSentence;
    };
    const renderCards = () => {
      root.replaceChildren();
      if (state.cards.length === 0) {
        const empty = el("div", { class: "empty-cell field-stone" }, el("p", {}, "No assets match these filters."));
        root.append(empty);
        return;
      }
      for (const card of state.cards) {
        root.append(cardNode(card, fetchCards));
      }
    };
    classFilter.addEventListener("change", () => {
      state.filters.className = classFilter.value;
      void fetchCards();
    });
    search.addEventListener("input", () => {
      state.filters.q = search.value;
      void fetchCards();
    });
    for (const [id, badge] of [
      ["filter-available", "Available"],
      ["filter-request", "Request required"],
      ["filter-restricted", "Restricted"],
      ["filter-retired", "Retired"]
    ]) {
      const box = document.getElementById(id);
      if (!box) continue;
      box.addEventListener("change", () => {
        if (box.checked) {
          state.filters.availability.push(badge);
        } else {
          state.filters.availability = state.filters.availability.filter((b) => b !== badge);
        }
        void fetchCards();
      });
    }
    window.addEventListener("rulehouse:library-updated", () => void fetchCards());
    await fetchCards();
  }
  function badgeClass(badge) {
    if (badge === "Available") return "badge-available";
    if (badge === "Request required") return "badge-request";
    if (badge === "Restricted") return "badge-restricted";
    return "badge-retired";
  }
  function badgeGlyph(badge) {
    if (badge === "Available") return "\u2713";
    if (badge === "Request required") return "\u26BF";
    if (badge === "Restricted") return "\u25AF";
    return "\u25D4";
  }
  function cardNode(card, refresh) {
    const body = el("div", {});
    const article = el(
      "article",
      { class: "card", "aria-label": `${card.cardName}, ${card.badge}` },
      el("h3", {}, card.cardName),
      el("p", { class: "licence" }, `${card.classLabel} \xB7 ${card.licenceName}`),
      el("span", { class: `badge ${badgeClass(card.badge)}` }, `${badgeGlyph(card.badge)} ${card.badge}`)
    );
    if (card.badge === "Available") {
      for (const derivative of card.derivatives) {
        const download = el("button", { type: "button" }, `Download ${derivative.fileName}`);
        const alertSlot = el("div", { class: "alert-slot" });
        download.addEventListener("click", async () => {
          const restore = busyButton(download, "Saving");
          try {
            const link = await api(`/api/derivatives/${derivative.id}/link`, {
              method: "POST",
              body: "{}"
            });
            const expires = new Date(link.expiresAt);
            const expiresAt = new Intl.DateTimeFormat("en-GB", {
              timeZone: me?.timeZone ?? "Europe/Berlin",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false
            }).format(expires);
            const line = el("p", { class: "link-line" }, `Link expires at ${expiresAt} `, el("a", { href: link.url }, `Download again: ${derivative.fileName}`));
            if (body.contains(alertSlot)) alertSlot.before(line);
            else article.append(line);
            window.location.href = link.url;
          } catch (err) {
            setAlert(err instanceof Error ? err.message : "Something went wrong.", alertSlot);
          } finally {
            restore();
          }
        });
        article.append(download);
      }
    } else {
      const disabled = el("button", { type: "button", disabled: "disabled", "aria-describedby": `reason-${card.assetId}-${card.variantId ?? "base"}` }, card.reason ?? "");
      disabled.setAttribute("aria-label", "Download");
      article.append(disabled);
    }
    if (me?.principal.role === "agency") {
      const requestButton = el("button", { type: "button" }, "Request use");
      if (!card.canRequest) {
        requestButton.disabled = true;
        if (card.requestReason) {
          requestButton.setAttribute("aria-describedby", `request-reason-${card.assetId}`);
          article.append(el("span", { id: `request-reason-${card.assetId}`, class: "grant-line" }, card.requestReason));
        }
      } else {
        requestButton.addEventListener("click", () => {
          void openRequestDialog(card, refresh);
        });
      }
      article.append(requestButton);
    }
    if (card.grant) {
      article.append(
        el("p", { class: "grant-line" }, `Grant ${card.grant.id} \xB7 ${card.grant.statusLabel} \xB7 ends ${card.grant.notAfter}`)
      );
    }
    article.append(body);
    return article;
  }
  var dialogKey = "";
  async function openRequestDialog(card, refresh) {
    const meNow = me ?? await loadMe();
    if (!meNow) return;
    const territories = meNow.organisation?.engagement.territories ?? [];
    const engagementEnd = meNow.organisation?.engagement.endsOn ?? null;
    dialogKey = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const rules = await api("/api/rules");
    const alertSlot = el("div", { class: "alert-slot" });
    const notices = el("p", { id: "request-notices", role: "status", "aria-live": "polite", class: "notice-slot" });
    const application = el("select", { id: "application" });
    for (const [value, label] of Object.entries(APPLICATION_LABELS)) {
      application.append(el("option", { value }, label));
    }
    application.value = "social";
    const territoriesGroup = el("div", { role: "group", "aria-label": "Territories" });
    const territoryBoxes = [];
    for (const code of territories) {
      const box = el("input", { type: "checkbox", value: code, id: `territory-${code}` });
      territoryBoxes.push(box);
      territoriesGroup.append(el("label", { class: "check", for: `territory-${code}` }, box, ` ${code}`));
    }
    if (territoryBoxes.length > 0) territoryBoxes[0].checked = true;
    const start = el("input", { type: "date", id: "campaign-start" });
    start.value = meNow.today;
    const end = el("input", { type: "date", id: "campaign-end" });
    const rulesGroup = el("div", { role: "group", "aria-label": "Cited rules" });
    const ruleBoxes = [];
    for (const rule of rules.rules) {
      const box = el("input", { type: "checkbox", value: rule.identifier, id: `rule-${rule.identifier}` });
      ruleBoxes.push(box);
      rulesGroup.append(el("label", { class: "check", for: `rule-${rule.identifier}` }, box, ` ${rule.identifier}`));
    }
    const note = el("textarea", { id: "note", rows: "3" });
    const engagementNotice = () => {
      if (!engagementEnd) {
        notices.textContent = "";
        return;
      }
      if (end.value && end.value > engagementEnd) {
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(engagementEnd);
        const formatted = match ? `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}` : engagementEnd;
        notices.textContent = `Your engagement ends on ${formatted}, so any grant will end by then.`;
      } else {
        notices.textContent = "";
      }
    };
    end.addEventListener("change", engagementNotice);
    const submit = el("button", { type: "submit", class: "primary" }, "Submit request");
    const form = el(
      "form",
      { id: "request-form" },
      el("label", { class: "field", for: "application" }, el("span", {}, "Application"), application),
      territoriesGroup,
      el("label", { class: "field", for: "campaign-start" }, el("span", {}, "Campaign start"), start),
      el("label", { class: "field", for: "campaign-end" }, el("span", {}, "Campaign end"), end),
      rulesGroup,
      el("label", { class: "field", for: "note" }, el("span", {}, "Note"), note),
      notices,
      submit,
      alertSlot
    );
    const opener = document.activeElement;
    const handle = openDialog({
      label: `Request ${card.cardName}`,
      build: (container) => {
        container.append(form);
      },
      opener
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const restore = busyButton(submit, "Saving");
      clearAlerts();
      const territories2 = territoryBoxes.filter((box) => box.checked).map((box) => box.value);
      const cited = ruleBoxes.filter((box) => box.checked).map((box) => box.value);
      try {
        const created = await api("/api/requests", {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: dialogKey,
            assetId: card.assetId,
            variantId: card.variantId,
            applicationClass: application.value,
            territories: territories2,
            campaignStartsOn: start.value,
            campaignEndsOn: end.value,
            citedRules: cited,
            note: note.value,
            submit: true
          })
        });
        setStatus(`${created.id} submitted.`);
        handle.close();
        window.location.href = `/requests/${created.id}`;
      } catch (err) {
        setAlert(err instanceof Error ? err.message : "Something went wrong.", alertSlot);
      } finally {
        restore();
      }
    });
    function clearAlerts() {
      setAlert("", alertSlot);
    }
  }

  // src/ui/request.ts
  var CONDITION_KINDS = {
    clear_space: "Clear space",
    no_recolour: "No recolour",
    attribution: "Attribution",
    proof_required: "Proof required",
    territory: "Territory",
    expiry_override: "Expiry override"
  };
  var me2 = null;
  async function initRequest() {
    me2 = await loadMe();
    const root = document.getElementById("request-root");
    if (!root) return;
    const match = /\/requests\/([^/]+)$/.exec(window.location.pathname);
    if (!match) return;
    const id = decodeURIComponent(match[1]);
    const live = el("p", { id: "request-updates", role: "alert", "aria-live": "assertive", class: "sr-only" });
    document.body.append(live);
    const state = { detail: null, lastState: "" };
    const load = async () => {
      const detail = await api(`/api/requests/${encodeURIComponent(id)}`);
      state.detail = detail;
      render(root, detail);
      if (state.lastState && state.lastState !== detail.state) {
        live.textContent = `${detail.id} is now ${detail.stateLabel}.`;
      }
      state.lastState = detail.state;
    };
    window.addEventListener("rulehouse:request-updated", (event) => {
      const payload = event.detail ?? {};
      if (!payload.requestId || payload.requestId === id) void load();
    });
    window.addEventListener("rulehouse:library-updated", () => void load());
    await load();
  }
  function render(root, detail) {
    const grid = el("div", { class: "request-grid" });
    const main = el("section", { class: "request-main" });
    main.append(
      el("h1", { id: "request-heading" }, detail.id),
      el("p", { id: "request-state", role: "status" }, detail.stateLabel),
      el("p", {}, `Held by ${detail.holder.displayName}`)
    );
    if (detail.deadline) {
      main.append(el("p", {}, `Due ${formatDateTime2(detail.deadline)}`));
    }
    if (detail.escalation === "no_eligible_reviewer") {
      main.append(el("p", {}, "Escalated: no eligible reviewer"));
    } else if (detail.escalation === "deadline_missed") {
      main.append(el("p", {}, "Escalated: deadline missed"));
    }
    const details = el("div", { class: "cell" });
    details.append(el("h2", {}, "Details"));
    const list = el("dl");
    const add = (term, value) => {
      list.append(el("dt", {}, term), el("dd", {}, value));
    };
    add("Asset", detail.cardName);
    add("Application", detail.applicationLabel);
    add("Territories", detail.territories.join(", "));
    add("Campaign start", formatDay(detail.campaignStartsOn, ""));
    add("Campaign end", formatDay(detail.campaignEndsOn, ""));
    add("Requester", `${detail.requester.displayName} (${detail.requester.organisationName})`);
    if (detail.submittedAt) add("Submitted", formatDateTime2(detail.submittedAt));
    if (detail.note) add("Note", detail.note);
    details.append(list);
    main.append(details);
    const cited = el("div", { class: "cell" });
    cited.append(el("h2", {}, "Cited rules"));
    const citedList = el("ul");
    for (const rule of detail.citedRules) {
      citedList.append(el("li", {}, el("a", { href: `/rules/${encodeURIComponent(rule.identifier)}` }, rule.identifier)));
    }
    cited.append(citedList);
    main.append(cited);
    const stagesCell = el("div", { class: "cell" });
    stagesCell.append(el("h2", {}, "Stages"));
    const stageList = el("ol");
    for (const stage of detail.stages) {
      const line = el("li", {}, `Stage ${stage.n}: ${stage.label}`);
      if (stage.assigneeName) line.append(` \u2014 ${stage.assigneeName}`);
      if (stage.decision) line.append(` \u2014 ${stage.decisionLabel}`);
      if (stage.comment) line.append(` \u2014 ${stage.comment}`);
      stageList.append(line);
    }
    stagesCell.append(stageList);
    main.append(stagesCell);
    const conditionsCell = el("div", { class: "cell" });
    conditionsCell.append(el("h2", {}, "Conditions"));
    if (detail.conditions.length === 0) {
      conditionsCell.append(el("p", {}, "No conditions."));
    } else {
      const conditionList = el("ul");
      for (const condition of detail.conditions) {
        conditionList.append(el("li", {}, condition.text));
      }
      conditionsCell.append(conditionList);
    }
    main.append(conditionsCell);
    if (detail.grant) {
      const grantCell = el("div", { class: "cell", role: "region", "aria-label": "Grant" });
      grantCell.append(
        el("h2", {}, "Grant"),
        el("p", {}, `${detail.grant.id} \xB7 ${detail.grant.statusLabel}`),
        el("p", {}, `Ends ${formatDay(detail.grant.notAfter, "")}`)
      );
      for (const condition of detail.grant.conditions) {
        grantCell.append(el("p", {}, condition.text));
      }
      main.append(grantCell);
    }
    if (detail.proofs.length > 0 || detail.grant?.status === "pending_proof") {
      const proofsCell = el("div", { class: "cell", role: "region", "aria-label": "Proofs" });
      proofsCell.append(el("h2", {}, "Proofs"));
      for (const proof of detail.proofs) {
        const row = el("p", {}, `${proof.fileName} \u2014 ${proof.statusLabel}`);
        if (proof.reason) row.append(` \u2014 ${proof.reason}`);
        proofsCell.append(row);
      }
      if (detail.grant?.status === "pending_proof" && me2?.principal.id === detail.requester.id) {
        const fileInput = el("input", { type: "file", id: "proof-file", "aria-label": "Proof file" });
        const upload = el("button", { type: "button" }, "Upload proof");
        const slot = el("div", { class: "alert-slot" });
        upload.addEventListener("click", async () => {
          const file = fileInput.files?.[0];
          if (!file) return;
          const restore = busyButton(upload, "Uploading");
          try {
            const form = new FormData();
            form.append("file", file);
            const res = await fetch(`/api/grants/${detail.grant.id}/proofs`, { method: "POST", body: form });
            if (!res.ok) {
              const data = await res.json();
              throw new Error(data?.message ?? "Something went wrong.");
            }
            setStatus("Proof uploaded. Waiting for review.");
            window.dispatchEvent(new CustomEvent("rulehouse:refresh-request"));
          } catch (err) {
            setAlert(err instanceof Error ? err.message : "Something went wrong.", slot);
          } finally {
            restore();
          }
        });
        proofsCell.append(
          el("label", { class: "field", for: "proof-file" }, el("span", {}, "Proof file"), fileInput),
          upload,
          slot
        );
      }
      main.append(proofsCell);
    }
    if (me2?.principal.id === detail.requester.id) {
      if (["draft", "routed", "under_review", "changes_requested"].includes(detail.state)) {
        const withdraw = el("button", { type: "button" }, "Withdraw request");
        withdraw.addEventListener("click", async () => {
          const restore = busyButton(withdraw, "Saving");
          try {
            await api(`/api/requests/${detail.id}/withdraw`, { method: "POST", body: "{}" });
            setStatus(`${detail.id} withdrawn.`);
            window.dispatchEvent(new CustomEvent("rulehouse:refresh-request"));
          } catch (err) {
            setAlert(err instanceof Error ? err.message : "Something went wrong.", null);
          } finally {
            restore();
          }
        });
        main.append(withdraw);
      }
      if (detail.state === "changes_requested") {
        const resubmit = el("button", { type: "button" }, "Resubmit request");
        resubmit.addEventListener("click", async () => {
          const restore = busyButton(resubmit, "Saving");
          try {
            await api(`/api/requests/${detail.id}/resubmit`, { method: "POST", body: "{}" });
            setStatus(`${detail.id} resubmitted.`);
            window.dispatchEvent(new CustomEvent("rulehouse:refresh-request"));
          } catch (err) {
            setAlert(err instanceof Error ? err.message : "Something went wrong.", null);
          } finally {
            restore();
          }
        });
        main.append(resubmit);
      }
    }
    grid.append(main);
    const open = detail.stages.find((stage) => stage.decision === null);
    const canDecide = me2 && open && (me2.principal.role === "owner" || me2.principal.id === open.assigneeName);
    const decide = () => buildDecisionPanel(detail, open);
    if (open && canDecide) {
      if (isPhone()) {
        const button = el("button", { type: "button", class: "decide-button" }, "Decide");
        button.addEventListener("click", () => {
          openSheet({
            label: `Decide ${detail.id}`,
            build: (body) => {
              body.append(decide());
            },
            opener: button,
            onClosed: () => void 0
          });
        });
        grid.append(el("section", { class: "decision-panel mobile-panel", "aria-label": "Decision" }));
        document.body.append(button);
      } else {
        grid.append(el("section", { class: "decision-panel desktop-panel", role: "region", "aria-label": "Decision" }, decide()));
      }
    }
    root.replaceChildren(grid);
  }
  function buildDecisionPanel(detail, open) {
    const panel = el("div", { class: "decision-body" });
    const slot = el("div", { class: "alert-slot" });
    if (detail.stageReason) panel.append(el("p", {}, detail.stageReason));
    if (detail.grantPreview) {
      if (detail.grantPreview.zeroLength) {
        panel.append(
          el("p", {}, `This grant would end on ${formatDay(detail.grantPreview.notAfter, "")}, before it starts. Approving records the decision but grants nothing.`)
        );
      } else {
        panel.append(
          el("p", {}, `Grant will end on ${formatDay(detail.grantPreview.notAfter, "")} (${detail.grantPreview.cap})`)
        );
      }
    }
    const comment = el("textarea", { id: "decision-comment", rows: "3", "aria-label": "Comment" });
    const kind = el("select", { id: "condition-kind" });
    for (const [value2, label] of Object.entries(CONDITION_KINDS)) {
      kind.append(el("option", { value: value2 }, label));
    }
    const value = el("input", { type: "text", id: "condition-value", "aria-label": "Condition value" });
    const addCondition = el("button", { type: "button" }, "Add condition");
    addCondition.addEventListener("click", async () => {
      const restore = busyButton(addCondition, "Saving");
      try {
        await api(`/api/requests/${detail.id}/conditions`, {
          method: "POST",
          body: JSON.stringify({ kind: kind.value, value: value.value || null })
        });
        setStatus("Condition added.");
        value.value = "";
        window.dispatchEvent(new CustomEvent("rulehouse:refresh-request"));
      } catch (err) {
        setAlert(err instanceof Error ? err.message : "Something went wrong.", slot);
      } finally {
        restore();
      }
    });
    const decide = (decision) => {
      return async (event) => {
        const button = event.currentTarget;
        const restore = busyButton(button, "Saving");
        try {
          await api(`/api/requests/${detail.id}/stages/${open?.n ?? 1}/decision`, {
            method: "POST",
            body: JSON.stringify({ decision, comment: comment.value || null })
          });
          setStatus("Decision saved.");
          window.dispatchEvent(new CustomEvent("rulehouse:refresh-request"));
        } catch (err) {
          setAlert(err instanceof Error ? err.message : "Something went wrong.", slot);
        } finally {
          restore();
        }
      };
    };
    const approve = el("button", { type: "button", class: "primary" }, "Approve");
    approve.addEventListener("click", (event) => void decide("approve")(event));
    const reject = el("button", { type: "button" }, "Reject");
    reject.addEventListener("click", (event) => void decide("reject")(event));
    const requestChanges = el("button", { type: "button" }, "Request changes");
    requestChanges.addEventListener("click", (event) => void decide("request_changes")(event));
    panel.append(
      el("label", { class: "field" }, el("span", {}, "Comment"), comment),
      approve,
      reject,
      requestChanges,
      el("label", { class: "field" }, el("span", {}, "Condition"), kind),
      el("label", { class: "field" }, el("span", {}, "Condition value"), value),
      addCondition,
      slot
    );
    return panel;
  }
  window.addEventListener("rulehouse:refresh-request", () => {
    void initRequest();
  });
  function formatDateTime2(iso) {
    const date = new Date(iso);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: me2?.timeZone ?? "Europe/Berlin",
      day: "numeric",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t)?.value ?? "0";
    return `${get("day")} ${months[Number(get("month")) - 1]} ${get("year")} ${get("hour")}:${get("minute")}`;
  }

  // src/ui/lists.ts
  async function initRequests() {
    const me3 = await loadMe();
    const root = document.getElementById("requests-root");
    if (!root) return;
    const data = await api("/api/requests");
    if (data.requests.length === 0) {
      root.replaceChildren(
        el("div", { class: "empty-cell field-stone" }, el("p", {}, "You have no requests yet."))
      );
      return;
    }
    const table = el("table", { class: "data", "aria-label": "My requests" });
    const head = el("thead");
    head.append(
      el(
        "tr",
        {},
        el("th", { scope: "col" }, "Request"),
        el("th", { scope: "col" }, "Asset"),
        el("th", { scope: "col" }, "Application"),
        el("th", { scope: "col" }, "State"),
        el("th", { scope: "col" }, "Due")
      )
    );
    const body = el("tbody");
    for (const request of data.requests) {
      body.append(
        el(
          "tr",
          {},
          el("td", {}, el("a", { href: `/requests/${request.id}` }, request.id)),
          el("td", {}, request.cardName),
          el("td", {}, request.applicationLabel),
          el("td", {}, request.stateLabel),
          el("td", {}, request.deadline ? formatDateTime(request.deadline) : "")
        )
      );
    }
    table.append(head, body);
    root.replaceChildren(table);
  }
  async function initQueue() {
    const me3 = await loadMe();
    const root = document.getElementById("queue-root");
    if (!root) return;
    const status = el("p", { id: "queue-updates", role: "status", "aria-live": "polite", class: "sr-only" });
    root.before(status);
    const load = async () => {
      const data = await api("/api/queue");
      const known = new Set(currentIds(root));
      if (data.rows.length === 0 && !root.querySelector(".empty-cell")) {
        root.replaceChildren(el("div", { class: "empty-cell field-stone" }, el("p", {}, "Nothing is waiting for you.")));
        return;
      }
      if (data.rows.length === 0) return;
      const phone = window.innerWidth < 768;
      root.replaceChildren(phone ? queueCards(data.rows) : queueTable(data.rows));
      const nowIds = new Set(data.rows.map((row) => row.requestId));
      for (const id of nowIds) {
        if (!known.has(id)) status.textContent = `${id} added to your queue.`;
      }
      for (const id of known) {
        if (!nowIds.has(id)) status.textContent = `${id} left your queue.`;
      }
    };
    window.addEventListener("rulehouse:queue-updated", () => void load());
    window.addEventListener("rulehouse:library-updated", () => void load());
    await load();
  }
  function currentIds(root) {
    return [...Array.from(root.querySelectorAll("a"))].map((link) => /\/requests\/(.+)$/.exec(link.getAttribute("href") ?? "")?.[1]).filter((value) => Boolean(value));
  }
  function queueTable(rows) {
    const table = el("table", { class: "data", "aria-label": "Review queue" });
    const head = el("thead");
    head.append(
      el(
        "tr",
        {},
        el("th", { scope: "col" }, "Request"),
        el("th", { scope: "col" }, "Asset"),
        el("th", { scope: "col" }, "Application"),
        el("th", { scope: "col" }, "Requester"),
        el("th", { scope: "col" }, "Stage"),
        el("th", { scope: "col" }, "Due")
      )
    );
    const body = el("tbody");
    for (const row of rows) {
      body.append(
        el(
          "tr",
          {},
          el("td", {}, el("a", { href: `/requests/${row.requestId}` }, row.requestId)),
          el("td", {}, row.cardName),
          el("td", {}, row.applicationLabel),
          el("td", {}, `${row.requesterName} (${row.organisationName})`),
          el("td", {}, row.stageLabel),
          el("td", {}, `Due ${formatDateTime(row.deadline)}`)
        )
      );
    }
    table.append(head, body);
    return table;
  }
  function queueCards(rows) {
    const list = el("div", { class: "queue-cards", role: "list", "aria-label": "Review queue" });
    for (const row of rows) {
      list.append(
        el(
          "div",
          { class: "queue-card", role: "listitem" },
          el("a", { href: `/requests/${row.requestId}` }, row.requestId),
          el("p", {}, row.cardName),
          el("p", {}, row.applicationLabel),
          el("p", {}, `${row.requesterName} (${row.organisationName})`),
          el("p", {}, row.stageLabel),
          el("p", {}, `Due ${formatDateTime(row.deadline)}`)
        )
      );
    }
    return list;
  }

  // src/ui/editor.ts
  async function initEditor() {
    const me3 = await loadMe();
    const root = document.getElementById("editor-root");
    if (!root) return;
    const match = /\/editor\/([^/]+)$/.exec(window.location.pathname);
    const slug = match ? decodeURIComponent(match[1]) : "logo";
    const layout = el("div", { class: "editor-layout" });
    const side = el("section", { class: "cell" });
    const main = el("section", { class: "cell" });
    layout.append(side, main);
    root.replaceChildren(layout);
    const versionsSlot = el("div");
    const formSlot = el("div");
    side.append(el("h2", {}, "Versions"), versionsSlot);
    main.append(formSlot);
    const load = async () => {
      const { versions } = await api(`/api/chapters/${slug}/versions`);
      versionsSlot.replaceChildren(el(
        "ul",
        { role: "list", "aria-label": "Versions" },
        ...versions.map((version) => el("li", {}, `Version ${version.number} \u2014 ${version.stateWord}`))
      ));
      const draft = versions.find((v) => ["draft", "in_review", "approved"].includes(v.state));
      const startButton = el("button", { type: "button" }, `Start version ${(versions.at(-1)?.number ?? 0) + 1}`);
      if (draft || me3?.principal.role !== "author") {
        startButton.disabled = true;
      }
      startButton.addEventListener("click", async () => {
        const restore = busyButton(startButton, "Saving");
        try {
          await api(`/api/chapters/${slug}/versions`, { method: "POST", body: "{}" });
          setStatus("Draft saved.");
          await load();
        } catch (err) {
          setAlert(err instanceof Error ? err.message : "Something went wrong.", null);
        } finally {
          restore();
        }
      });
      versionsSlot.append(startButton);
      if (!draft) {
        const latest = versions.at(-1);
        if (latest) {
          const detail2 = await api(`/api/versions/${latest.id}`);
          formSlot.replaceChildren(readOnlyVersion(detail2, load));
        }
        return;
      }
      const detail = await api(`/api/versions/${draft.id}`);
      formSlot.replaceChildren(versionForm(detail, me3, load));
    };
    await load();
  }
  function readOnlyVersion(detail, reload) {
    const wrap = el("div");
    wrap.append(el("h2", {}, `Version ${detail.number} (${detail.stateWord})`));
    wrap.append(el("p", {}, detail.intro));
    const list = el("ul");
    for (const statement of detail.statements) {
      list.append(el("li", {}, `${statement.identifier} \u2014 ${statement.text}`));
    }
    wrap.append(list);
    return wrap;
  }
  function versionForm(detail, me3, reload) {
    const wrap = el("div");
    const slot = el("div", { class: "alert-slot" });
    wrap.append(el("h2", {}, `Version ${detail.number} (${detail.stateWord})`));
    const intro = el("textarea", { id: "version-intro", rows: "3" });
    intro.value = detail.intro;
    intro.setAttribute("aria-label", "Introduction");
    const statementsSlot = el("div");
    const statements = [];
    const addStatement = (identifier = "", text = "") => {
      const idInput = el("input", { type: "text", value: identifier });
      idInput.setAttribute("aria-label", `Rule identifier ${statements.length + 1}`);
      const textInput = el("input", { type: "text", value: text });
      textInput.setAttribute("aria-label", `Rule text ${statements.length + 1}`);
      const remove = el("button", { type: "button" });
      remove.textContent = `Remove statement ${statements.length + 1}`;
      remove.setAttribute("aria-label", `Remove statement ${statements.length + 1}`);
      const row = el("div", { class: "statement-row" }, idInput, textInput, remove);
      remove.addEventListener("click", () => {
        statements.splice(statements.findIndex((s) => s.identifier === idInput), 1);
        row.remove();
        relabel();
      });
      statementsSlot.append(row);
      statements.push({ identifier: idInput, text: textInput });
      relabel();
    };
    const relabel = () => {
      statements.forEach((statement, index) => {
        statement.identifier.setAttribute("aria-label", `Rule identifier ${index + 1}`);
        statement.text.setAttribute("aria-label", `Rule text ${index + 1}`);
      });
    };
    for (const statement of detail.statements) addStatement(statement.identifier, statement.text);
    const addStatementButton = el("button", { type: "button" }, "Add statement");
    addStatementButton.addEventListener("click", () => addStatement());
    const assetsSlot = el("div", { role: "group", "aria-label": "Referenced assets" });
    const assetBoxes = [];
    void api("/api/admin/assets").then((data) => {
      for (const asset of data.assets) {
        const box = el("input", { type: "checkbox", value: asset.id, id: `asset-${asset.id}` });
        if (detail.assetIds.includes(asset.id)) box.checked = true;
        assetBoxes.push(box);
        assetsSlot.append(el("label", { class: "check", for: `asset-${asset.id}` }, box, ` ${asset.name}`));
      }
    }).catch(() => void 0);
    const withdrawnSlot = el("div");
    const withdrawn = [];
    const addWithdrawn = (identifier, replacedBy) => {
      const published = detail.statements.map((s) => s.identifier).filter((id) => id);
      const select = el("select", { "aria-label": `Replacement for ${identifier}` });
      for (const id of published) select.append(el("option", { value: id }, id));
      if (replacedBy) select.value = replacedBy;
      withdrawn.push({ identifier: select });
      withdrawnSlot.append(el("div", {}, `${identifier} \u2192 `), select);
    };
    for (const w of detail.withdrawn) addWithdrawn(w.identifier, w.replacedBy);
    const saveDraft = el("button", { type: "button" }, "Save draft");
    const submit = el("button", { type: "button", class: "primary" }, "Submit for review");
    const approve = el("button", { type: "button" }, `Approve version ${detail.number}`);
    const requestChanges = el("button", { type: "button" }, `Request changes to version ${detail.number}`);
    const publish = el("button", { type: "button" }, `Publish version ${detail.number}`);
    const collect = () => ({
      revision: detail.revision,
      intro: intro.value,
      statements: statements.map((s) => ({ identifier: s.identifier.value, text: s.text.value })),
      assetIds: assetBoxes.filter((b) => b.checked).map((b) => b.value),
      withdrawn: detail.withdrawn.map((w) => w)
    });
    saveDraft.addEventListener("click", async () => {
      const restore = busyButton(saveDraft, "Saving");
      try {
        await api(`/api/versions/${detail.id}`, { method: "PUT", body: JSON.stringify(collect()) });
        setStatus("Draft saved.");
        await reload();
      } catch (err) {
        setAlert(err instanceof Error ? err.message : "Something went wrong.", slot);
      } finally {
        restore();
      }
    });
    submit.addEventListener("click", async () => {
      const restore = busyButton(submit, "Saving");
      try {
        await api(`/api/versions/${detail.id}`, { method: "PUT", body: JSON.stringify(collect()) });
        await api(`/api/versions/${detail.id}/submit`, { method: "POST", body: "{}" });
        setStatus(`Version ${detail.number} submitted for review.`);
        await reload();
      } catch (err) {
        setAlert(err instanceof Error ? err.message : "Something went wrong.", slot);
      } finally {
        restore();
      }
    });
    approve.addEventListener("click", async () => {
      const restore = busyButton(approve, "Saving");
      try {
        await api(`/api/versions/${detail.id}/approve`, { method: "POST", body: "{}" });
        setStatus(`Version ${detail.number} approved.`);
        await reload();
      } catch (err) {
        setAlert(err instanceof Error ? err.message : "Something went wrong.", slot);
      } finally {
        restore();
      }
    });
    const comment = el("input", { type: "text", "aria-label": "Review comment" });
    requestChanges.addEventListener("click", async () => {
      const restore = busyButton(requestChanges, "Saving");
      try {
        await api(`/api/versions/${detail.id}/request-changes`, {
          method: "POST",
          body: JSON.stringify({ comment: comment.value })
        });
        setStatus(`Changes requested on version ${detail.number}.`);
        await reload();
      } catch (err) {
        setAlert(err instanceof Error ? err.message : "Something went wrong.", slot);
      } finally {
        restore();
      }
    });
    publish.addEventListener("click", async () => {
      const restore = busyButton(publish, "Saving");
      try {
        await api(`/api/versions/${detail.id}/publish`, { method: "POST", body: "{}" });
        setStatus(`Version ${detail.number} published.`);
        await reload();
      } catch (err) {
        setAlert(err instanceof Error ? err.message : "Something went wrong.", slot);
      } finally {
        restore();
      }
    });
    wrap.append(
      el("label", { class: "field" }, el("span", {}, "Introduction"), intro),
      statementsSlot,
      addStatementButton,
      el("h3", {}, "Withdrawn identifiers"),
      withdrawnSlot,
      el("h3", {}, "Referenced assets"),
      assetsSlot,
      saveDraft,
      submit
    );
    if (me3?.principal.role === "brand_reviewer" || me3?.principal.role === "owner") {
      wrap.append(comment, approve, requestChanges);
    }
    if (me3?.principal.role === "owner") {
      wrap.append(publish);
    }
    wrap.append(slot);
    return wrap;
  }

  // src/ui/admin.ts
  async function initAdminAssets() {
    const me3 = await loadMe();
    const root = document.getElementById("admin-root");
    if (!root) return;
    const load = async () => {
      const data = await api("/api/admin/assets");
      const table = el("table", { class: "data", "aria-label": "Assets" });
      const head = el("thead");
      head.append(
        el(
          "tr",
          {},
          el("th", { scope: "col" }, "Asset"),
          el("th", { scope: "col" }, "State"),
          el("th", { scope: "col" }, "Successor"),
          el("th", { scope: "col" }, "Derivatives"),
          el("th", { scope: "col" }, "Actions")
        )
      );
      const body = el("tbody");
      for (const asset of data.assets) {
        const cell = el("td");
        const slot = el("div", { class: "alert-slot" });
        const release = el("button", { type: "button" }, `Release ${asset.name}`);
        release.addEventListener("click", async () => {
          const restore = busyButton(release, "Saving");
          try {
            await api(`/api/assets/${asset.id}/release`, { method: "POST", body: "{}" });
            setStatus(`${asset.name} released.`);
            await load();
          } catch (err) {
            setAlert(err instanceof Error ? err.message : "Something went wrong.", slot);
          } finally {
            restore();
          }
        });
        const restrict = el("button", { type: "button" }, `Restrict ${asset.name}`);
        restrict.addEventListener("click", async () => {
          const restore = busyButton(restrict, "Saving");
          try {
            await api(`/api/assets/${asset.id}/restrict`, { method: "POST", body: "{}" });
            setStatus(`${asset.name} restricted.`);
            await load();
          } catch (err) {
            setAlert(err instanceof Error ? err.message : "Something went wrong.", slot);
          } finally {
            restore();
          }
        });
        const retire = el("button", { type: "button" }, `Retire ${asset.name}`);
        retire.addEventListener("click", () => {
          const opener = document.activeElement;
          const handle = openDialog({
            label: `Retire ${asset.name}`,
            build: (container) => {
              const successor = el("select", { "aria-label": "Successor" });
              for (const candidate of data.assets) {
                if (candidate.id !== asset.id && candidate.state === "released") {
                  successor.append(el("option", { value: candidate.id }, candidate.name));
                }
              }
              const confirm = el("button", { type: "button", class: "primary" }, "Retire asset");
              confirm.addEventListener("click", async () => {
                const restore = busyButton(confirm, "Saving");
                try {
                  await api(`/api/assets/${asset.id}/retire`, {
                    method: "POST",
                    body: JSON.stringify({ successorAssetId: successor.value })
                  });
                  setStatus(`${asset.name} retired.`);
                  handle.close();
                  await load();
                } catch (err) {
                  setAlert(err instanceof Error ? err.message : "Something went wrong.", slot);
                } finally {
                  restore();
                }
              });
              container.append(el("label", { class: "field" }, el("span", {}, "Successor"), successor), confirm);
            },
            opener
          });
        });
        const remove = (derivative) => {
          const button = el("button", { type: "button" }, `Remove ${derivative.fileName}`);
          button.addEventListener("click", async () => {
            const restore = busyButton(button, "Saving");
            try {
              await api(`/api/derivatives/${derivative.id}`, { method: "DELETE" });
              setStatus(`${derivative.fileName} removed.`);
              await load();
            } catch (err) {
              setAlert(err instanceof Error ? err.message : "Something went wrong.", slot);
            } finally {
              restore();
            }
          });
          return button;
        };
        const derivativeList = el("ul");
        for (const derivative of asset.derivatives) {
          derivativeList.append(
            el("li", {}, `${derivative.fileName} (${derivative.width} x ${derivative.height})`, remove(derivative))
          );
        }
        const uploadLabel = el("input", { type: "file", id: `upload-${asset.id}` });
        uploadLabel.setAttribute("aria-label", `Add derivative to ${asset.name}`);
        const upload = el("button", { type: "button" }, "Add derivative");
        upload.addEventListener("click", async () => {
          const input = document.getElementById(`upload-${asset.id}`);
          const file = input?.files?.[0];
          if (!file) return;
          const restore = busyButton(upload, "Uploading");
          try {
            const form = new FormData();
            form.append("file", file);
            const res = await fetch(`/api/assets/${asset.id}/derivatives`, { method: "POST", body: form });
            if (!res.ok) {
              const data2 = await res.json();
              throw new Error(data2?.message ?? "Something went wrong.");
            }
            setStatus(`${file.name} added.`);
            await load();
          } catch (err) {
            setAlert(err instanceof Error ? err.message : "Something went wrong.", slot);
          } finally {
            restore();
          }
        });
        cell.append(release, restrict, retire, uploadLabel, upload, slot);
        body.append(
          el(
            "tr",
            {},
            el("td", {}, asset.name),
            el("td", {}, asset.state),
            el("td", {}, asset.successorId ?? ""),
            el("td", {}, derivativeList),
            cell
          )
        );
      }
      table.append(head, body);
      root.replaceChildren(table);
    };
    await load();
    window.addEventListener("rulehouse:library-updated", () => void load());
  }
  async function initAdminGrants() {
    const me3 = await loadMe();
    const root = document.getElementById("admin-root");
    if (!root) return;
    const load = async () => {
      const data = await api("/api/grants");
      const table = el("table", { class: "data", "aria-label": "Grants" });
      const head = el("thead");
      head.append(
        el(
          "tr",
          {},
          el("th", { scope: "col" }, "Grant"),
          el("th", { scope: "col" }, "Holder"),
          el("th", { scope: "col" }, "Asset"),
          el("th", { scope: "col" }, "Status"),
          el("th", { scope: "col" }, "Ends"),
          el("th", { scope: "col" }, "Actions")
        )
      );
      const body = el("tbody");
      for (const grant of data.grants) {
        const slot = el("div", { class: "alert-slot" });
        const cell = el("td");
        const revoke = el("button", { type: "button" }, `Revoke ${grant.id}`);
        revoke.addEventListener("click", () => {
          const opener = document.activeElement;
          const handle = openDialog({
            label: `Revoke ${grant.id}`,
            build: (container) => {
              const reason = el("input", { type: "text", "aria-label": "Reason" });
              const confirm = el("button", { type: "button", class: "primary" }, "Revoke grant");
              confirm.addEventListener("click", async () => {
                const restore = busyButton(confirm, "Saving");
                try {
                  await api(`/api/grants/${grant.id}/revoke`, {
                    method: "POST",
                    body: JSON.stringify({ reason: reason.value })
                  });
                  setStatus(`${grant.id} revoked.`);
                  handle.close();
                  await load();
                } catch (err) {
                  setAlert(err instanceof Error ? err.message : "Something went wrong.", container);
                } finally {
                  restore();
                }
              });
              container.append(el("label", { class: "field" }, el("span", {}, "Reason"), reason), confirm);
            },
            opener
          });
        });
        cell.append(revoke, slot);
        body.append(
          el(
            "tr",
            {},
            el("td", {}, grant.id),
            el("td", {}, grant.holder.displayName),
            el("td", {}, grant.cardName),
            el("td", {}, grant.statusLabel),
            el("td", {}, grant.notAfter),
            cell
          )
        );
      }
      table.append(head, body);
      root.replaceChildren(table);
    };
    await load();
    window.addEventListener("rulehouse:library-updated", () => void load());
    window.addEventListener("rulehouse:grant-updated", () => void load());
  }
  async function initAdminAudit() {
    const me3 = await loadMe();
    const root = document.getElementById("admin-root");
    if (!root) return;
    const requestIdInput = el("input", { type: "text", "aria-label": "Request id" });
    const actionSelect = el("select", { "aria-label": "Action" });
    actionSelect.append(el("option", { value: "" }, "All actions"));
    const from = el("input", { type: "date", "aria-label": "From" });
    const to = el("input", { type: "date", "aria-label": "To" });
    const apply = el("button", { type: "button" }, "Apply filters");
    const verify = el("button", { type: "button" }, "Verify chain");
    const chainStatus = el("p", { id: "chain-status", role: "status", "aria-live": "polite" });
    const recordsSlot = el("div");
    const cellLine = (value) => {
      if (!value) return "none";
      return Object.keys(value).sort().map((key) => `${key}: ${value[key]}`).join("\n");
    };
    const load = async () => {
      const params = new URLSearchParams();
      if (requestIdInput.value) params.set("requestId", requestIdInput.value);
      if (actionSelect.value) params.set("action", actionSelect.value);
      if (from.value) params.set("from", from.value);
      if (to.value) params.set("to", to.value);
      const data = await api(`/api/audit?${params.toString()}`);
      if (actionSelect.options.length <= 1) {
        for (const action of data.actions) {
          actionSelect.append(el("option", { value: action }, action));
        }
      }
      if (data.records.length === 0) {
        recordsSlot.replaceChildren(el("div", { class: "empty-cell field-stone" }, el("p", {}, "No audit records match.")));
        return;
      }
      const table = el("table", { class: "data", "aria-label": "Audit log" });
      const head = el("thead");
      head.append(
        el(
          "tr",
          {},
          el("th", { scope: "col" }, "Sequence"),
          el("th", { scope: "col" }, "Time"),
          el("th", { scope: "col" }, "Actor"),
          el("th", { scope: "col" }, "Action"),
          el("th", { scope: "col" }, "Resource"),
          el("th", { scope: "col" }, "Before"),
          el("th", { scope: "col" }, "After"),
          el("th", { scope: "col" }, "Outcome")
        )
      );
      const body = el("tbody");
      for (const record of data.records) {
        body.append(
          el(
            "tr",
            {},
            el("td", {}, String(record.sequence)),
            el("td", {}, record.time),
            el("td", {}, record.actor),
            el("td", {}, record.action),
            el("td", {}, `${record.resourceType} ${record.resourceId}`),
            el("td", {}, cellLine(record.before)),
            el("td", {}, cellLine(record.after)),
            el("td", {}, record.outcome)
          )
        );
      }
      table.append(head, body);
      recordsSlot.replaceChildren(table);
    };
    apply.addEventListener("click", () => void load());
    verify.addEventListener("click", async () => {
      const restore = busyButton(verify, "Checking chain");
      try {
        const result = await api("/api/audit/verify");
        chainStatus.textContent = result.ok ? `Chain verified: ${result.records} records.` : `Chain broken at record ${result.brokenAt}.`;
      } finally {
        restore();
      }
    });
    root.replaceChildren(
      el(
        "div",
        { class: "cell" },
        requestIdInput,
        actionSelect,
        from,
        to,
        apply,
        verify,
        chainStatus
      ),
      recordsSlot
    );
    await load();
  }
  async function initAdminPeople() {
    const me3 = await loadMe();
    const root = document.getElementById("admin-root");
    if (!root) return;
    const email = el("input", { type: "email", "aria-label": "Email" });
    const displayName = el("input", { type: "text", "aria-label": "Display name" });
    const role = el("select", { "aria-label": "Role" });
    role.append(el("option", { value: "agency" }, "Agency partner"), el("option", { value: "press" }, "Press contact"));
    const organisation = el("select", { "aria-label": "Organisation" });
    const slot = el("div", { class: "alert-slot" });
    const invite = el("button", { type: "button", class: "primary" }, "Invite person");
    const orgs = await api("/api/organisations").catch(() => null);
    for (const org of orgs?.organisations ?? []) {
      organisation.append(el("option", { value: org.id }, org.name));
    }
    invite.addEventListener("click", async () => {
      const restore = busyButton(invite, "Saving");
      try {
        await api("/api/invitations", {
          method: "POST",
          body: JSON.stringify({
            email: email.value,
            displayName: displayName.value,
            role: role.value,
            organisationId: organisation.value
          })
        });
        setStatus(`Invitation queued for ${email.value}.`);
        email.value = "";
        displayName.value = "";
      } catch (err) {
        setAlert(err instanceof Error ? err.message : "Something went wrong.", slot);
      } finally {
        restore();
      }
    });
    const orgsSlot = el("div");
    for (const org of orgs?.organisations ?? []) {
      if (org.name === "Quenby & Co.") continue;
      const input = el("input", { type: "date", "aria-label": `Engagement end for ${org.name}` });
      const save = el("button", { type: "button" }, `Save engagement end for ${org.name}`);
      const orgSlot = el("div", { class: "alert-slot" });
      save.addEventListener("click", async () => {
        const restore = busyButton(save, "Saving");
        try {
          await api(`/api/organisations/${org.id}/engagement`, {
            method: "PUT",
            body: JSON.stringify({ endsOn: input.value })
          });
          setStatus("Engagement end saved.");
        } catch (err) {
          setAlert(err instanceof Error ? err.message : "Something went wrong.", orgSlot);
        } finally {
          restore();
        }
      });
      orgsSlot.append(el("div", {}, el("p", {}, org.name), input, save, orgSlot));
    }
    root.replaceChildren(el("div", { class: "cell" }, email, displayName, role, organisation, invite, slot), orgsSlot);
  }

  // src/ui/client.ts
  async function boot() {
    const page = document.body.dataset.page ?? "";
    const me3 = await loadMe().catch(() => null);
    if (me3) {
      window.__weightDelay = me3.weightAnnounceDelayMs;
    }
    wireSignOut();
    wireSignIn();
    wireActivate();
    connectLive();
    switch (page) {
      case "home":
        initHome();
        break;
      case "typography":
        initWeight();
        break;
      case "colour":
        initWheel();
        break;
      case "motion":
        initMotion();
        break;
      case "library":
        await initLibrary();
        break;
      case "request":
        await initRequest();
        break;
      case "requests":
        await initRequests();
        break;
      case "queue":
        await initQueue();
        break;
      case "editor":
        await initEditor();
        break;
      case "admin-assets":
        await initAdminAssets();
        break;
      case "admin-grants":
        await initAdminGrants();
        break;
      case "admin-audit":
        await initAdminAudit();
        break;
      case "admin-people":
        await initAdminPeople();
        break;
      default:
        initRuleFocus();
        break;
    }
  }
  function wireSignOut() {
    const button = document.getElementById("sign-out");
    if (!button) return;
    button.addEventListener("click", async () => {
      const restore = busyButton(button, "Saving");
      try {
        await api("/api/session", { method: "DELETE" });
        window.location.href = "/";
      } finally {
        restore();
      }
    });
  }
  function wireSignIn() {
    const form = document.getElementById("signin-form");
    if (!form) return;
    const slot = form.querySelector(".alert-slot");
    const submit = form.querySelector('button[type="submit"]');
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!submit) return;
      const restore = busyButton(submit, "Signing in");
      try {
        await api("/api/session", {
          method: "POST",
          body: JSON.stringify({
            email: form.querySelector("#email").value,
            password: form.querySelector("#password").value
          })
        });
        window.location.href = "/library";
      } catch (err) {
        setAlert(err instanceof Error ? err.message : "Something went wrong.", slot);
      } finally {
        restore();
      }
    });
  }
  function wireActivate() {
    const form = document.getElementById("activate-form");
    if (!form) return;
    const slot = form.querySelector(".alert-slot");
    const submit = form.querySelector('button[type="submit"]');
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!submit) return;
      const restore = busyButton(submit, "Saving");
      const token = form.dataset.token ?? "";
      try {
        await api(`/api/invitations/${encodeURIComponent(token)}/activate`, {
          method: "POST",
          body: JSON.stringify({ password: form.querySelector("#password").value })
        });
        window.location.href = "/library";
      } catch (err) {
        setAlert(err instanceof Error ? err.message : "Something went wrong.", slot);
      } finally {
        restore();
      }
    });
  }
  function connectLive() {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/api/live`);
    socket.addEventListener("message", (event) => {
      let payload = null;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!payload?.type) return;
      switch (payload.type) {
        case "request.updated":
          window.dispatchEvent(new CustomEvent("rulehouse:request-updated", { detail: payload }));
          break;
        case "queue.updated":
          window.dispatchEvent(new CustomEvent("rulehouse:queue-updated"));
          break;
        case "library.updated":
          window.dispatchEvent(new CustomEvent("rulehouse:library-updated"));
          break;
        case "grant.updated":
          window.dispatchEvent(new CustomEvent("rulehouse:grant-updated"));
          break;
        case "chapter.updated":
          if (window.location.pathname.startsWith("/chapters/") || window.location.pathname === "/") {
            window.location.reload();
          }
          break;
      }
    });
    socket.addEventListener("close", () => {
      window.setTimeout(connectLive, 2e3);
    });
  }
  void boot();
})();
