// The staffing strip: 21 cells (7 days × Early, Late, Night), one stepped floor rule, ghost slots for gaps.
// Every bar height and label comes from the preview response; motion is element.animate() only.
import { h, narrow, reducedMotion, svg } from "./dom.js";
import { dayCaption, shiftLabel } from "./format.js";
import { icon } from "./icons.js";

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const DROP_MS = 320;
const STAGGER_MS = 40;
const FADE_MS = 220;
const COVER_MS = 200;
const AXIS = { early: "E", late: "L", night: "N" };

function shownCount(s, previewing) {
  return previewing ? s.on_duty_if_approved : s.on_duty;
}

// What the cell says, from the server's counts: if-approved values while previewing, current ones otherwise.
function breach(s, previewing) {
  if (previewing) return { short: s.shortfall, senior: s.senior_shortfall > 0 };
  return { short: Math.max(0, s.floor.min_staff - s.on_duty), senior: s.seniors_on_duty < s.floor.min_seniors };
}

function cellName(s, previewing) {
  const b = breach(s, previewing);
  let name = `${shiftLabel(s.date, s.shift)}: ${shownCount(s, previewing)} on duty, floor ${s.floor.min_staff}`;
  if (b.short > 0) name += `, ${b.short} below floor`;
  if (b.senior) name += ", no senior on shift";
  return name;
}

export function createStrip({ onPostCover }) {
  const group = h("div", { role: "group", "aria-label": "Staffing strip", class: "strip" });
  const floorSvg = svg("svg", { class: "floor-svg", "aria-hidden": "true" });
  const floorLine = svg("polyline", { class: "floor-line", fill: "none" });
  floorSvg.append(floorLine);
  const chip = h("button", { type: "button", class: "cover-chip", disabled: true }, icon("hand", 16), h("span", { text: "Cover" }));
  const ghosts = h("div", { class: "ghost-layer" });
  const wrap = h("div", { class: "strip-wrap" }, group, floorSvg, h("div", { class: "chip-row" }, chip,
    h("p", { class: "meta chip-hint", text: "Drag the Cover chip onto a dashed slot, or press a slot." })), ghosts);
  let cells = [];
  let data = null;
  let previewing = false;
  let focusIndex = 0;

  function build(shifts) {
    cells = [];
    const days = [];
    for (let d = 0; d < shifts.length / 3; d += 1) {
      const [weekday, date] = dayCaption(shifts[d * 3].date);
      const dayCells = shifts.slice(d * 3, d * 3 + 3).map((s) => {
        const bar = h("div", { class: "bar" }, h("span", { class: "hatch" }));
        const cell = h("div", { role: "group", class: "cell", tabindex: "-1" },
          h("span", { class: "axis", "aria-hidden": "true", text: AXIS[s.shift] }),
          h("div", { class: "plot" }, bar), h("span", { class: "num" }),
          h("div", { class: "labels" }, h("span", { class: "lbl-short" }), h("span", { class: "lbl-senior" })));
        cells.push(cell);
        return cell;
      });
      days.push(h("div", { class: "day" },
        h("div", { class: "day-caption", "aria-hidden": "true" }, h("span", { text: weekday }), h("span", { text: date })),
        h("div", { class: "day-cells" }, dayCells)));
    }
    group.replaceChildren(...days);
    focusIndex = 0;
    cells[0].tabIndex = 0;
    group.tabIndex = -1;
  }

  function paintNumber(cell, s, changed) {
    const num = cell.querySelector(".num");
    if (reducedMotion() && changed && previewing) {
      num.replaceChildren(h("span", { class: "was", text: String(s.on_duty) }), " ", h("span", { class: "arrow", text: "→" }),
        " ", h("span", { class: "now", text: String(s.on_duty_if_approved) }));
    } else num.textContent = String(shownCount(s, previewing));
  }

  function paintBreach(cell, s) {
    const b = breach(s, previewing);
    cell.querySelector(".lbl-short").textContent = b.short > 0 ? `-${b.short} below floor` : "";
    cell.querySelector(".lbl-senior").textContent = b.senior ? "no senior on shift" : "";
    cell.classList.toggle("breached", b.short > 0 || b.senior);
  }

  function sizeOf(s, show) {
    return `${(shownCount(s, show) / data.scale_max) * 100}%`;
  }

  function fade(cell, show, delay) {
    for (const el of cell.querySelectorAll(".hatch, .labels")) {
      el.animate([{ opacity: show ? 0 : 1 }, { opacity: show ? 1 : 0 }], { duration: FADE_MS, delay, easing: EASE, fill: "backwards" });
    }
  }

  // Paint every cell; `motion` says how changed bars move: "select" together, "on" staggered drop, "off" staggered rise.
  function update(pv, previewOn, motion) {
    const before = data;
    const wasPreviewing = previewing;
    data = pv;
    previewing = previewOn;
    if (!cells.length || cells.length !== pv.shifts.length) {
      build(pv.shifts);
    }
    const animate = !reducedMotion() && before && before.shifts.length === pv.shifts.length;
    const prop = narrow() ? "width" : "height";
    const moved = [];
    pv.shifts.forEach((s, i) => {
      const cell = cells[i];
      const bar = cell.querySelector(".bar");
      const old = before && before.shifts.length === pv.shifts.length ? before.shifts[i] : null;
      const from = old ? `${(shownCount(old, wasPreviewing) / before.scale_max) * 100}%` : null;
      const to = sizeOf(s, previewOn);
      const hadBreach = cell.classList.contains("breached");
      cell.setAttribute("aria-label", cellName(s, previewOn));
      cell.classList.toggle("changed", previewOn && s.affected);
      paintNumber(cell, s, s.affected);
      bar.style.setProperty("--size", to);
      if (animate && from !== to) moved.push({ cell, bar, from, to, hadBreach });
      else paintBreach(cell, s);
    });
    if (motion === "on") {
      moved.forEach((m, k) => {
        m.bar.animate([{ [prop]: m.from }, { [prop]: m.to }], { duration: DROP_MS, delay: k * STAGGER_MS, easing: EASE, fill: "backwards" });
        paintBreach(m.cell, pv.shifts[cells.indexOf(m.cell)]);
        if (!m.hadBreach && m.cell.classList.contains("breached")) fade(m.cell, true, k * STAGGER_MS + DROP_MS);
      });
    } else if (motion === "off") {
      [...moved].reverse().forEach((m, k) => {
        m.bar.animate([{ [prop]: m.from }, { [prop]: m.to }], { duration: DROP_MS, delay: FADE_MS + k * STAGGER_MS, easing: EASE, fill: "backwards" });
        const s = pv.shifts[cells.indexOf(m.cell)];
        if (m.hadBreach && !(breach(s, false).short > 0 || breach(s, false).senior)) {
          for (const el of m.cell.querySelectorAll(".hatch, .labels")) {
            el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: EASE }).finished.then(() => paintBreach(m.cell, s));
          }
        } else paintBreach(m.cell, s);
      });
    } else {
      for (const m of moved) {
        m.bar.animate([{ [prop]: m.from }, { [prop]: m.to }], { duration: DROP_MS, easing: EASE, fill: "backwards" });
        const s = pv.shifts[cells.indexOf(m.cell)];
        paintBreach(m.cell, s);
        if (m.hadBreach !== m.cell.classList.contains("breached")) fade(m.cell, m.cell.classList.contains("breached"), 0);
      }
    }
    drawFloor();
    drawGhosts(motion === "on" ? moved.map((m) => m.cell) : null, motion);
  }

  function rectIn(el, base) {
    const r = el.getBoundingClientRect();
    return { left: r.left - base.left, top: r.top - base.top, right: r.right - base.left, bottom: r.bottom - base.top,
      width: r.width, height: r.height };
  }

  function drawFloor() {
    if (!cells.length) {
      floorLine.setAttribute("points", "");
      return;
    }
    const base = wrap.getBoundingClientRect();
    floorSvg.setAttribute("width", base.width);
    floorSvg.setAttribute("height", base.height);
    const points = [];
    let prev = null;
    data.shifts.forEach((s, i) => {
      const p = rectIn(cells[i].querySelector(".plot"), base);
      const share = s.floor.min_staff / data.scale_max;
      if (narrow()) {
        const x = p.left + p.width * share;
        if (prev !== null) points.push([prev, p.top]);
        points.push([x, p.top], [x, p.bottom]);
        prev = x;
      } else {
        const y = p.bottom - p.height * share;
        if (prev !== null) points.push([p.left, prev]);
        points.push([p.left, y], [p.right, y]);
        prev = y;
      }
    });
    floorLine.setAttribute("points", points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "));
  }

  // Place (or reuse) the ghost slot for one gap: a dashed box where the missing unit would stand.
  function placeSlot(existing, s, gap, index, base) {
    const key = `${s.date}|${s.shift}|${gap.skill}|${index}`;
    const slot = existing.get(key) ?? h("button", { type: "button", class: "ghost" }, h("span"));
    slot.dataset.key = key;
    slot.setAttribute("aria-label", `Post cover for ${shiftLabel(s.date, s.shift)} (${gap.skill})`);
    slot.classList.toggle("posted", Boolean(gap.cover));
    if (gap.cover) slot.setAttribute("aria-disabled", "true");
    else slot.removeAttribute("aria-disabled");
    slot.firstChild.textContent = gap.cover ? "cover posted" : "";
    slot.onclick = () => {
      if (!gap.cover) onPostCover(s, gap.skill);
    };
    const plot = rectIn(cells[data.shifts.indexOf(s)].querySelector(".plot"), base);
    const shown = shownCount(s, true) + index;
    if (narrow()) {
      const unit = plot.width / data.scale_max;
      Object.assign(slot.style, { left: `${plot.left + shown * unit}px`, top: `${plot.top + plot.height / 2 - 22}px`,
        width: `${Math.max(unit, 44)}px`, height: "44px" });
    } else {
      const unit = plot.height / data.scale_max;
      Object.assign(slot.style, { left: `${plot.left}px`, top: `${plot.bottom - (shown + 1) * unit}px`,
        width: `${plot.width}px`, height: `${unit}px` });
    }
    return slot;
  }

  function drawGhosts(landing, motion) {
    const existing = new Map([...ghosts.children].map((g) => [g.dataset.key, g]));
    const wasPosted = new Map([...existing].map(([key, g]) => [key, g.classList.contains("posted")]));
    if (!previewing || !data?.shifts.length) {
      chip.disabled = true;
      if (motion === "off" && ghosts.children.length && !reducedMotion()) {
        const leaving = [...ghosts.children];
        Promise.all(leaving.map((g) => g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: EASE }).finished))
          .then(() => {
            if (!previewing) leaving.forEach((g) => g.remove());
          });
      } else ghosts.replaceChildren();
      return;
    }
    const base = wrap.getBoundingClientRect();
    const affected = data.shifts.filter((x) => x.affected);
    const slots = affected.flatMap((s) => s.gaps.map((gap, index) => placeSlot(existing, s, gap, index, base)));
    for (const [key, g] of existing) {
      if (slots.includes(g)) continue;
      g.remove();
      wasPosted.delete(key);
    }
    ghosts.append(...slots);
    chip.disabled = !slots.some((g) => !g.classList.contains("posted"));
    if (reducedMotion()) return;
    for (const slot of slots) {
      const [date, shift] = slot.dataset.key.split("|");
      const cell = cells[data.shifts.findIndex((x) => x.date === date && x.shift === shift)];
      const k = landing ? landing.indexOf(cell) : -1;
      if (k >= 0) {
        slot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, delay: k * STAGGER_MS + DROP_MS, easing: EASE, fill: "backwards" });
      } else if (wasPosted.get(slot.dataset.key) === false && slot.classList.contains("posted")) {
        slot.animate([{ backgroundColor: "rgba(201, 160, 74, 0)" }, { backgroundColor: "rgb(201, 160, 74)" }], { duration: COVER_MS, easing: EASE });
      } else if (!wasPosted.has(slot.dataset.key)) {
        slot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: EASE });
      }
    }
  }

  function clear(message) {
    data = null;
    cells = [];
    previewing = false;
    group.replaceChildren(message ? h("p", { class: "strip-note", text: message }) : "");
    group.removeAttribute("tabindex");
    ghosts.replaceChildren();
    floorLine.setAttribute("points", "");
    chip.disabled = true;
  }

  group.addEventListener("keydown", (event) => {
    if (!cells.length || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const last = cells.length - 1;
    const next = { ArrowLeft: Math.max(0, focusIndex - 1), ArrowRight: Math.min(last, focusIndex + 1), Home: 0, End: last }[event.key];
    cells[focusIndex].tabIndex = -1;
    focusIndex = next;
    cells[next].tabIndex = 0;
    cells[next].focus();
  });
  group.addEventListener("focusin", (event) => {
    const index = cells.indexOf(event.target);
    if (index >= 0) focusIndex = index;
  });

  // Drag the Cover chip onto a ghost slot; releasing anywhere else sends it home.
  let dragged = false;
  chip.addEventListener("pointerdown", (event) => {
    if (chip.disabled) return;
    dragged = false;
    const start = { x: event.clientX, y: event.clientY };
    chip.setPointerCapture(event.pointerId);
    chip.classList.add("dragging");
    const target = (e) => document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.classList?.contains("ghost"));
    const move = (e) => {
      dragged = true;
      chip.style.transform = `translate(${e.clientX - start.x}px, ${e.clientY - start.y}px)`;
      for (const g of ghosts.children) g.classList.toggle("over", g === target(e));
    };
    const up = (e) => {
      chip.removeEventListener("pointermove", move);
      chip.removeEventListener("pointerup", up);
      chip.removeEventListener("pointercancel", up);
      chip.classList.remove("dragging");
      const slot = e.type === "pointerup" ? target(e) : null;
      // The chip goes straight home, so it is always where the next press expects it.
      chip.style.transform = "";
      if (slot && !slot.classList.contains("posted")) slot.click();
    };
    chip.addEventListener("pointermove", move);
    chip.addEventListener("pointerup", up);
    chip.addEventListener("pointercancel", up);
  });
  // A press without a drag moves focus to the first open slot, the keyboard's drop target.
  chip.addEventListener("click", () => {
    if (!dragged) ghosts.querySelector(".ghost:not(.posted)")?.focus();
    dragged = false;
  });

  new ResizeObserver(() => {
    if (!data?.shifts.length) return;
    drawFloor();
    drawGhosts(null, null);
  }).observe(wrap);

  return { wrap, group, chip, ghosts, update, clear };
}
