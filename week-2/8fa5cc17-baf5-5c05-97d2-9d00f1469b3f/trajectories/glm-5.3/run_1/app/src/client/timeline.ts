// The daily timeline: momentum coast, snap, heat bands and moving blocks.

import { api, apiFail, type TimelineJson, ApiFailure } from "./api.js";
import { h, clearChildren, announce, alertMessage, clearAlert, reducedMotion, dateHeading } from "./dom.js";
import { screens, mainEl, navigate, updateTopbarTitle } from "./app.js";
import { TIMELINE, MOTION, QUIRE_CURVE } from "./constants.js";
import { THEMES } from "../shared/theme.js";

export function openTimeline(): void {
  screens.current = { dispose: () => undefined };
  void load();

  async function load(): Promise<void> {
    let data: TimelineJson;
    try {
      data = await api<TimelineJson>("GET", "/api/timeline");
    } catch {
      return;
    }
    const main = mainEl();
    clearChildren(main);
    clearAlert();
    updateTopbarTitle("Timeline");
    const list = h("ul", { class: "timeline-days", "aria-label": "Days", role: "list" });
    const region = h("div", { class: "timeline-region", role: "region", "aria-label": "Daily timeline" }, list);
    main.append(region);

    const heatColor = (n: number): string => {
      const theme = document.documentElement.dataset.theme === "lamplight" ? "lamplight" : "paper";
      const paper = THEMES[theme].paper;
      const accent = THEMES[theme].accent;
      const t = Math.min(1, n / TIMELINE.heatMax);
      const mix = (i: number): number => Math.round(paper[i] + (accent[i] - paper[i]) * t);
      return `rgb(${mix(0)} ${mix(1)} ${mix(2)})`;
    };

    for (const day of data.days) {
      const heat = h("div", { class: "heat-band", "data-heat": day.block_count, style: { background: heatColor(day.block_count) } },
        h("span", { class: "heat-caption" }, `${day.block_count} ${day.block_count === 1 ? "block" : "blocks"}`)
      );
      const blocks = h("ul", { class: "day-blocks" });
      for (const block of day.blocks) {
        const handle = h("button", { class: "day-block-handle", "aria-label": `Move "${block.excerpt}"` }, `"${block.excerpt}"`);
        if (block.movable) {
          wireMove(handle, block.id, day.date, data);
        } else {
          handle.disabled = true;
        }
        blocks.append(h("li", { class: `day-block ${block.kind}` }, handle));
      }
      if (day.object_id === null) {
        blocks.append(h("li", { class: "no-note" }, "No note"));
      }
      list.append(h("li", { class: "timeline-day", "data-date": day.date },
        h("h2", { class: "day-heading" }, dateHeading(day.date)),
        heat,
        blocks
      ));
    }

    // start at the right end so today is in view
    requestAnimationFrame(() => {
      region.scrollLeft = region.scrollWidth;
    });
    wireCoast(region);
  }

  function wireCoast(region: HTMLElement): void {
    let dragging = false;
    let samples: Array<{ x: number; time: number }> = [];
    region.addEventListener("pointerdown", (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("button") !== null) return;
      dragging = true;
      samples = [{ x: e.clientX, time: performance.now() }];
    });
    region.addEventListener("pointermove", (e: PointerEvent) => {
      if (!dragging) return;
      const now = performance.now();
      samples.push({ x: e.clientX, time: now });
      if (samples.length > 60) samples.shift();
    });
    const release = (): void => {
      if (!dragging) return;
      dragging = false;
      if (reducedMotion()) {
        region.scrollLeft = Math.round(region.scrollLeft / TIMELINE.columnStride) * TIMELINE.columnStride;
        return;
      }
      // the coast velocity from the reference sample
      const last = samples[samples.length - 1];
      if (last === undefined) return;
      const reference = [...samples].reverse().find((s) => s.time <= last.time - 100) ?? samples[0];
      const dt = last.time - reference.time;
      const v0 = dt === 0 ? 0 : (last.x - reference.x) / dt; // pixels per ms
      const releaseOffset = region.scrollLeft;
      const start = performance.now();
      const coast = (): void => {
        const t = performance.now() - start;
        const v = v0 * Math.exp(-t / TIMELINE.coastTimeConstant);
        if (Math.abs(v) < TIMELINE.coastStopVelocity) {
          // snap to the nearest column start
          const target = Math.round(region.scrollLeft / TIMELINE.columnStride) * TIMELINE.columnStride;
          region.animate(
            [{ scrollLeft: region.scrollLeft }, { scrollLeft: target }],
            { duration: TIMELINE.snapTime, easing: "ease" }
          );
          region.scrollLeft = target;
          return;
        }
        region.scrollLeft = releaseOffset + v0 * TIMELINE.coastTimeConstant * (1 - Math.exp(-t / TIMELINE.coastTimeConstant));
        requestAnimationFrame(coast);
      };
      void releaseOffset;
      requestAnimationFrame(coast);
    };
    region.addEventListener("pointerup", release);
    region.addEventListener("pointercancel", release);
  }

  function wireMove(handle: HTMLButtonElement, blockId: string, fromDate: string, data: TimelineJson): void {
    handle.addEventListener("keydown", (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      const dir = e.key === "ArrowLeft" ? -1 : 1;
      const days = data.days;
      const idx = days.findIndex((d) => d.date === fromDate);
      let target = -1;
      for (let i = idx + dir; i >= 0 && i < days.length; i += dir) {
        if (days[i].object_id !== null) {
          target = i;
          break;
        }
      }
      if (target === -1) return;
      void moveBlock(blockId, days[target]);
    });
    // drag between columns
    handle.addEventListener("pointerdown", (e: PointerEvent) => {
      e.stopPropagation();
      const start = { x: e.clientX, y: e.clientY };
      let moved = false;
      const onMove = (ev: PointerEvent): void => {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) >= 4) moved = true;
      };
      const onUp = (ev: PointerEvent): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (!moved) return;
        const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".timeline-day") as HTMLElement | null;
        if (target === null) return;
        const date = target.dataset.date ?? "";
        const day = data.days.find((d) => d.date === date);
        if (day === undefined || day.object_id === null || day.date === fromDate) return;
        void moveBlock(blockId, day);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  async function moveBlock(blockId: string, day: TimelineJson["days"][number]): Promise<void> {
    try {
      await api("POST", `/api/blocks/${blockId}/move`, { object_id: day.object_id, after_block_id: null });
      announce(`Moved block to ${dateHeading(day.date)}.`);
      await load();
    } catch (e) {
      if (e instanceof ApiFailure && e.body.error === "not_movable") {
        alertMessage("That block couldn't be moved.");
      } else {
        alertMessage("That block couldn't be moved.");
      }
    }
  }
}
