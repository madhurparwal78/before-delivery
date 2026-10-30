// The staffing strip: 21 cells, the floor line, the Floor drop and its motion.

import { clear, el, reducedMotion } from "./dom.js";
import { SHIFT_LABELS, dayHeading, shiftLabel } from "./format.js";

const BAR_MS = 320;
const STAGGER_MS = 40;
const FADE_MS = 220;

function shownOf(entry, previewOn) {
  const floor = entry.floor;
  if (previewOn) {
    return {
      count: entry.on_duty_if_approved,
      seniors: entry.seniors_if_approved,
      shortfall: entry.shortfall,
      seniorShortfall: entry.senior_shortfall,
      from: entry.on_duty,
    };
  }
  return {
    count: entry.on_duty,
    seniors: entry.seniors_on_duty,
    shortfall: Math.max(0, floor.min_staff - entry.on_duty),
    seniorShortfall: Math.max(0, floor.min_seniors - entry.seniors_on_duty),
    from: entry.on_duty_if_approved,
  };
}

export function breachLabels(shortfall, seniorShortfall) {
  const labels = [];
  if (shortfall > 0) labels.push(`-${shortfall} below floor`);
  if (seniorShortfall > 0) labels.push("no senior on shift");
  return labels;
}

function cellName(entry, shown) {
  let name = `${entry.label}: ${shown.count} on duty, floor ${entry.floor.min_staff}`;
  if (shown.shortfall > 0) name += `, ${shown.shortfall} below floor`;
  if (shown.seniorShortfall > 0) name += ", no senior on shift";
  return name;
}

export function announcement(preview) {
  const count = preview.uncovered_breaches;
  if (count === 0) return "Approving keeps every shift at or above its floor.";
  const noun = count === 1 ? "shift" : "shifts";
  return `Approving would leave ${count} ${noun} below floor: ${preview.breach_labels.join(", ")}`;
}

export class Strip {
  constructor({ onPostCover }) {
    this.onPostCover = onPostCover;
    this.previewOn = false;
    this.preview = null;
    this.cells = [];
    this.activeIndex = 0;
    this.node = el("div", {
      role: "group",
      "aria-label": "Staffing strip",
      class: "strip",
      onkeydown: (event) => this.onKeydown(event),
    });
    this.emptyNote = el("p", {});
  }

  onKeydown(event) {
    if (!this.cells.length) return;
    const moves = { ArrowRight: 1, ArrowLeft: -1 };
    const step = moves[event.key];
    if (!step) return;
    event.preventDefault();
    const next = Math.min(this.cells.length - 1, Math.max(0, this.activeIndex + step));
    this.focusCell(next);
  }

  focusCell(index) {
    this.activeIndex = index;
    this.cells.forEach((cell, position) => {
      cell.node.setAttribute("tabindex", position === index ? "0" : "-1");
    });
    this.cells[index].node.focus();
  }

  /** The ghost slots, in strip order, for the queue's tab order. */
  ghostButtons() {
    return this.cells.flatMap((cell) => [...cell.ghosts.querySelectorAll("button")]);
  }

  stripCell() {
    return this.cells.length ? this.cells[this.activeIndex].node : null;
  }

  setPreview(preview, requesterName) {
    const sameShape =
      this.preview &&
      this.preview.shifts.length === preview.shifts.length &&
      this.preview.shifts.every((entry, index) => entry.label === preview.shifts[index].label);
    this.preview = preview;
    if (!preview.shifts.length) {
      this.cells = [];
      clear(this.node);
      this.emptyNote.textContent =
        `${requesterName} isn't on a unit rota, so approving changes no shift.`;
      this.node.append(this.emptyNote);
      return;
    }
    if (!sameShape) this.build();
    this.paint();
  }

  build() {
    clear(this.node);
    this.cells = [];
    this.activeIndex = 0;
    const byDay = new Map();
    for (const entry of this.preview.shifts) {
      if (!byDay.has(entry.date)) byDay.set(entry.date, []);
      byDay.get(entry.date).push(entry);
    }
    for (const [date, entries] of byDay) {
      const cellsNode = el("div", { class: "strip-day-cells" });
      for (const entry of entries) {
        const cell = this.buildCell(entry);
        this.cells.push(cell);
        cellsNode.append(cell.node);
      }
      this.node.append(
        el(
          "div",
          { class: "strip-day" },
          el("div", { class: "strip-day-name" }, dayHeading(date)),
          cellsNode
        )
      );
    }
    this.cells[0].node.setAttribute("tabindex", "0");
  }

  buildCell(entry) {
    const bar = el("div", { class: "bar" });
    const floorRule = el("div", { class: "floor-rule" });
    const floorStep = el("div", { class: "floor-step" });
    const count = el("div", { class: "cell-text" });
    const delta = el("div", { class: "delta" });
    const breach = el("div", { class: "cell-breach" });
    const ghosts = el("div", { class: "ghosts" });
    const node = el(
      "div",
      {
        role: "group",
        class: "strip-cell",
        tabindex: "-1",
        onfocus: () => {
          this.activeIndex = this.cells.findIndex((cell) => cell.node === node);
        },
      },
      bar,
      floorRule,
      floorStep,
      el("div", { class: "cell-body" }, ghosts, count, delta, breach)
    );
    return { node, bar, floorRule, floorStep, count, delta, breach, ghosts, entry };
  }

  /** Bar size, floor line, labels and ghost slots, straight from the preview. */
  paint() {
    const scale = Math.max(1, this.preview.scale_max);
    this.preview.shifts.forEach((entry, index) => {
      const cell = this.cells[index];
      cell.entry = entry;
      const shown = shownOf(entry, this.previewOn);
      this.sizeCell(cell, entry, shown, scale, index);
      this.decorateCell(cell, entry, shown, "");
    });
  }

  sizeCell(cell, entry, shown, scale, index) {
    const percent = (value) => `${Math.round((value / scale) * 1000) / 10}%`;
    cell.node.style.setProperty("--size", percent(shown.count));
    cell.node.style.setProperty("--floor", percent(entry.floor.min_staff));
    const previous = this.preview.shifts[index - 1];
    const previousFloor = previous ? previous.floor.min_staff : entry.floor.min_staff;
    const low = Math.min(previousFloor, entry.floor.min_staff);
    const high = Math.max(previousFloor, entry.floor.min_staff);
    cell.floorStep.style.display = high > low ? "block" : "none";
    cell.node.style.setProperty("--step-low", percent(low));
    cell.node.style.setProperty("--step-span", percent(high - low));
    cell.node.setAttribute("aria-label", cellName(entry, shown));
    cell.count.textContent = String(shown.count);
    cell.node.classList.toggle("changed", this.previewOn && entry.affected);
  }

  decorateCell(cell, entry, shown, deltaText) {
    const labels = breachLabels(shown.shortfall, shown.seniorShortfall);
    clear(cell.breach);
    for (const label of labels) cell.breach.append(el("span", { text: label }));
    cell.node.classList.toggle("breach", labels.length > 0);
    cell.delta.textContent = deltaText;
    clear(cell.ghosts);
    if (!this.previewOn) return;
    for (const gap of entry.gaps) {
      const posted = Boolean(gap.cover);
      const button = el("button", {
        class: posted ? "ghost posted" : "ghost",
        type: "button",
        "aria-label": `Post cover for ${entry.label} (${gap.skill})`,
        disabled: posted,
        onclick: () => this.onPostCover(entry, gap.skill),
        ondragover: (event) => {
          if (posted) return;
          event.preventDefault();
          button.classList.add("drop-ready");
        },
        ondragleave: () => button.classList.remove("drop-ready"),
        ondrop: (event) => {
          event.preventDefault();
          button.classList.remove("drop-ready");
          if (!posted) this.onPostCover(entry, gap.skill);
        },
      });
      button.textContent = posted ? "cover posted" : "";
      cell.ghosts.append(button);
    }
  }

  /** Turning preview on lowers only the affected bars, left to right. */
  async setPreviewOn(previewOn) {
    this.previewOn = previewOn;
    if (!this.preview || !this.cells.length) return;
    const scale = Math.max(1, this.preview.scale_max);
    const changed = this.cells.filter((cell) => cell.entry.affected);
    const paintCell = (cell, deltaText) => {
      const shown = shownOf(cell.entry, this.previewOn);
      this.sizeCell(cell, cell.entry, shown, scale, this.cells.indexOf(cell));
      this.decorateCell(cell, cell.entry, shown, deltaText);
    };
    if (reducedMotion()) {
      for (const cell of this.cells) {
        const shown = shownOf(cell.entry, this.previewOn);
        const pair = changed.includes(cell) && previewOn ? `${shown.from} → ${shown.count}` : "";
        paintCell(cell, pair);
      }
      return;
    }
    const unchanged = this.cells.filter((cell) => !cell.entry.affected);
    for (const cell of unchanged) paintCell(cell, "");
    if (previewOn) {
      changed.forEach((cell, order) => {
        window.setTimeout(() => {
          const shown = shownOf(cell.entry, true);
          this.sizeCell(cell, cell.entry, shown, scale, this.cells.indexOf(cell));
        }, order * STAGGER_MS);
        window.setTimeout(
          () => paintCell(cell, ""),
          order * STAGGER_MS + BAR_MS
        );
      });
      return;
    }
    for (const cell of changed) {
      clear(cell.breach);
      cell.delta.textContent = "";
      cell.node.classList.remove("breach");
      clear(cell.ghosts);
    }
    [...changed].reverse().forEach((cell, order) => {
      window.setTimeout(() => paintCell(cell, ""), FADE_MS + order * STAGGER_MS);
    });
  }
}
