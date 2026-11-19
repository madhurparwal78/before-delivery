// The revision splice (brief: Motion and effects). Time-driven WAAPI, played once, forwards:
// 1. the header splits and the old tag slides down into the ribbon while the new tag drops into place;
// 2. cells re-thread top to bottom, 26 ms apart, first 24 rows animated, the rest snap when row 24 starts;
// 3. rails redraw, pinned tabs drop in, added cells drop in, removed cells collapse into their stub;
// 4. the column and fleet counts roll digit by digit to the recount.

import { COUNT_WORDS } from "./board.js";
import { h } from "./ui.js";

const EASE = "cubic-bezier(.2,.8,.2,1)";
const TIMING = { header: 200, stagger: 26, row: 140, rows: 24, counts: 320 };

function play(el, frames, options) {
  return el.animate(frames, { easing: EASE, fill: "backwards", ...options });
}

/** Each phase runs on the clock, not on its animations' `finished` promises: a slow compositor (software GL) can
 * resolve those late, and the lag would add up phase after phase past the 1.4 s budget. When the phase's time is
 * up, any animation still running is finished, so the end state is exact and on time. */
export function settle(anims, ms) {
  return new Promise((resolve) => setTimeout(resolve, ms)).then(() => {
    for (const a of anims) {
      try {
        if (a.playState !== "finished") a.finish();
      } catch {
        // an animation whose element left the document has nothing left to finish
      }
    }
  });
}

/** Step 1, on the header as it is now; resolves when the header's time is up. */
export function splitHeader(header, toTag) {
  const anims = splitAnims(header, toTag);
  return settle(anims, anims.length ? TIMING.header : 0);
}

function splitAnims(header, toTag) {
  if (!header) return [];
  const anims = [];
  const tag = header.querySelector(".colhead__tag");
  const ribbon = header.querySelector(".ribbon");
  const line = h("span", { class: "split-line", "aria-hidden": "true" });
  header.append(line);
  anims.push(play(line, [{ transform: "scaleX(0)", opacity: 1 }, { transform: "scaleX(1)", opacity: 1, offset: 0.55 },
    { transform: "scaleX(1)", opacity: 0 }], { duration: TIMING.header, fill: "forwards" }));
  const top = header.querySelector(".colhead__line");
  const bottom = [...header.querySelectorAll(".colhead__title, .colhead__counts")];
  anims.push(play(top, [{ transform: "none" }, { transform: "translateY(-3px)" }, { transform: "none" }], { duration: TIMING.header }));
  for (const part of bottom) {
    anims.push(play(part, [{ transform: "none" }, { transform: "translateY(3px)" }, { transform: "none" }], { duration: TIMING.header }));
  }
  if (tag) {
    const box = tag.getBoundingClientRect();
    const host = header.getBoundingClientRect();
    const ghost = tag.cloneNode(true);
    ghost.classList.add("tag-ghost");
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.left = `${box.left - host.left}px`;
    ghost.style.top = `${box.top - host.top}px`;
    header.append(ghost);
    const target = ribbon ? ribbon.getBoundingClientRect() : { left: host.left + 8, top: host.bottom - 14 };
    const dx = target.left + 4 - box.left;
    const dy = target.top - box.top;
    anims.push(play(ghost, [{ transform: "none", opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(.8)`, opacity: 0.85, offset: 0.85 },
      { transform: `translate(${dx}px, ${dy}px) scale(.8)`, opacity: 0 }], { duration: TIMING.header, fill: "forwards" }));
    tag.textContent = toTag;
    anims.push(play(tag, [{ transform: "translateY(-90%)", opacity: 0 }, { transform: "none", opacity: 1 }],
      { duration: TIMING.header }));
  }
  return anims;
}

/** What a column looked like before the splice: per tail, its cell data and markup. */
export function capture(board, cells, did) {
  const before = new Map();
  for (const c of cells) {
    const el = board.cell(`${c.registration}|${did}`);
    before.set(c.registration, { data: c, top: el?.querySelector(".c-top")?.outerHTML, html: el?.innerHTML });
  }
  return before;
}

function ghostOf(cellEl, html, cls) {
  const ghost = h("div", { class: `ghost ${cls}`, "aria-hidden": "true", html });
  ghost.querySelectorAll("[role]").forEach((n) => n.removeAttribute("role"));
  ghost.querySelectorAll("[aria-label]").forEach((n) => n.removeAttribute("aria-label"));
  cellEl.append(ghost);
  return ghost;
}

function crossfadeTop(cellEl, was, timing, anims) {
  const top = cellEl.querySelector(":scope > .c-top");
  if (!top || !was?.top || was.top === top.outerHTML) return;
  const ghost = ghostOf(cellEl, was.top, "ghost--top");
  anims.push(play(ghost, [{ transform: "none", opacity: 1 }, { transform: "translateY(-4px)", opacity: 0 }],
    { ...timing, fill: "both" }));
  anims.push(play(top, [{ transform: "translateY(4px)", opacity: 0 }, { transform: "none", opacity: 1 }], timing));
}

function redrawRails(cellEl, was, timing, anims) {
  const old = was?.data;
  if (!old || old.label === "Not applicable" || old.label === "Withdrawn") return;
  for (const [cls, key] of [["lim--cal", "calendar_used"], ["lim--fh", "hours_used"]]) {
    const fill = cellEl.querySelector(`.${cls} .lim__fill`);
    const now = cellEl.querySelector(`.${cls}`)?.getAttribute("aria-valuenow");
    if (fill && now !== null) {
      anims.push(play(fill, [{ transform: `scaleX(${old[key]})` }, { transform: `scaleX(${Number(now) / 100})` }], timing));
    }
  }
  const gov = cellEl.querySelector(".gauge")?.dataset.gov;
  if (old.governing && gov && old.governing !== gov) {
    const shift = gov === "FH" ? -1 : 1;
    const notch = cellEl.querySelector(".notch");
    const text = cellEl.querySelector(".gauge__gov");
    anims.push(play(notch, [{ transform: `translateY(${shift * 7}px)` }, { transform: "none" }], timing));
    anims.push(play(text, [{ transform: `translateY(${shift * 4}px)`, opacity: 0.2 }, { transform: "none", opacity: 1 }], timing));
  }
}

/** Steps 2 and 3, on the column's final cells; resolves when the last cell settles. */
export function rethread(board, did, before, splice) {
  const sets = Object.fromEntries(["retargeted", "added", "removed", "kept"].map((k) => [k, new Set(splice[k])]));
  const rows = [...board.grid.querySelectorAll(".mbody .mrow")];
  const anims = [];
  rows.forEach((row, i) => {
    const cellEl = row.querySelector(`[data-did="${did}"]`);
    if (!cellEl) return;
    const tid = cellEl.dataset.tid;
    const was = before.get(row.dataset.reg);
    if (!tid && !was) return;
    const timing = i < TIMING.rows
      ? { delay: i * TIMING.stagger, duration: TIMING.row }
      : { delay: (TIMING.rows - 1) * TIMING.stagger, duration: 1 };
    const content = [...cellEl.children].filter((n) => !n.classList.contains("ghost"));
    if (sets.added.has(tid)) {
      if (was?.html) {
        const ghost = ghostOf(cellEl, was.html, "ghost--full");
        anims.push(play(ghost, [{ opacity: 1 }, { opacity: 0 }], { ...timing, fill: "both" }));
      }
      for (const part of content) {
        anims.push(play(part, [{ transform: "translateY(-6px)", opacity: 0 }, { transform: "none", opacity: 1 }], timing));
      }
    } else if (sets.removed.has(tid)) {
      if (was?.html) {
        const ghost = ghostOf(cellEl, was.html, "ghost--full");
        anims.push(play(ghost, [{ transform: "scaleX(1)", opacity: 1 }, { transform: "scaleX(0.04)", opacity: 0 }],
          { ...timing, fill: "both" }));
      }
      for (const part of content) {
        anims.push(play(part, [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], timing));
      }
    } else if (sets.kept.has(tid)) {
      const pin = cellEl.querySelector(".c-pin");
      if (pin) anims.push(play(pin, [{ transform: "translateY(-100%)", opacity: 0 }, { transform: "none", opacity: 1 }], timing));
      crossfadeTop(cellEl, was, timing, anims);
    } else {
      redrawRails(cellEl, was, timing, anims);
      crossfadeTop(cellEl, was, timing, anims);
    }
  });
  const last = Math.min(rows.length, TIMING.rows) - 1;
  return settle(anims, Math.max(0, last) * TIMING.stagger + TIMING.row).then(() => {
    board.grid.querySelectorAll(".ghost").forEach((g) => g.remove());
  });
}

function rollNumber(el, from, to) {
  if (!el) return [];
  const next = String(to);
  const prev = String(from).padStart(next.length, " ");
  if (String(from) === next) return [];
  el.textContent = "";
  el.classList.add("roll");
  const anims = [];
  [...next].forEach((digit, i) => {
    const slot = h("span", { class: "roll__slot" }, h("span", { class: "roll__digit" }, digit));
    el.append(slot);
    if (prev[i] === digit) return;
    const delay = (next.length - 1 - i) * 40;
    const old = h("span", { class: "roll__old", "aria-hidden": "true" }, prev[i].trim());
    slot.append(old);
    const duration = TIMING.counts - delay;
    anims.push(play(slot.firstChild, [{ transform: "translateY(100%)" }, { transform: "none" }], { delay, duration }));
    anims.push(play(old, [{ transform: "none", opacity: 1 }, { transform: "translateY(-100%)", opacity: 0 }],
      { delay, duration, fill: "forwards" }));
  });
  return anims;
}

/** Step 4: roll every count that changed from its old value to the value now rendered. */
export function rollCounts(board, did, oldColumn, oldFleet, newColumn, newFleet) {
  const anims = [];
  for (const [k] of COUNT_WORDS) {
    anims.push(...rollNumber(board.countEl(k), oldFleet[k], newFleet[k]));
    anims.push(...rollNumber(board.header(did)?.querySelector(`[data-count="${k}"]`), oldColumn[k], newColumn[k]));
  }
  return settle(anims, anims.length ? TIMING.counts : 0).then(() => {
    document.querySelectorAll(".roll").forEach((el) => {
      el.textContent = [...el.querySelectorAll(".roll__digit")].map((d) => d.textContent).join("");
      el.classList.remove("roll");
    });
  });
}
