// Three clocks: the ribbon that opens beside a dragged block, rolls its
// numerals at every 15-minute snap and settles into the quick dialog.

import type { Clock } from "./api";
import { clear, el, reducedMotion } from "./dom";
import { state } from "./state";
import { ZONES, cityOf, inZone, minutesOfDay, wallClock, wallDate } from "./time";

/** clocksFor reads an instant in the three cities, with each city's own
 *  working-hours flag. */
export function clocksFor(instant: number): Clock[] {
  return ZONES.map((zone) => {
    const wall = inZone(instant, zone);
    return {
      city: cityOf(zone),
      time: wallClock(wall),
      date: wallDate(wall),
      inside_hours: insideHours(zone, instant, false),
    };
  });
}

/** insideHours applies the published working-hours rule for a start or an end. */
export function insideHours(zone: string, instant: number, isEnd: boolean): boolean {
  const hours = state.settings?.office_hours?.[zone];
  if (!hours) return false;
  let wall = inZone(instant, zone);
  let minutes = minutesOfDay(wall);
  if (isEnd && minutes === 0) {
    wall = inZone(instant - 60000, zone);
    minutes = 24 * 60;
  }
  const weekday = new Date(Date.UTC(wall.y, wall.m - 1, wall.d)).getUTCDay();
  const dayNumber = weekday === 0 ? 7 : weekday;
  if (!hours.days.includes(dayNumber)) return false;
  const open = clockMinutes(hours.open);
  const close = clockMinutes(hours.close);
  return isEnd ? minutes > open && minutes <= close : minutes >= open && minutes < close;
}

function clockMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/** threeClockLine writes the published sentence announced under reduced motion. */
export function threeClockLine(clocks: Clock[]): string {
  return clocks
    .map((clock) => `${clock.city} ${clock.time} ${clock.inside_hours ? "inside working hours" : "outside working hours"}`)
    .join(", ") + ".";
}

export class ThreeClocks {
  readonly node: HTMLElement;
  private stacks = new Map<string, HTMLElement>();
  private bars = new Map<string, HTMLElement>();
  private groups = new Map<string, HTMLElement>();
  private shown: Clock[] = [];

  constructor() {
    this.node = el("div", { role: "group", "aria-label": "Three clocks", class: "three-clocks" });
    if (reducedMotion()) this.node.classList.add("still");
    for (const zone of ZONES) {
      const city = cityOf(zone);
      const stack = el("span", { class: "numerals" });
      const bar = el("span", { class: "hours-bar", "aria-hidden": "true" });
      const group = el("div", { role: "group", "aria-label": `${city} 00:00, outside working hours`, class: "clock" }, [
        el("span", { class: "city", text: city }),
        stack,
        bar,
      ]);
      this.stacks.set(city, stack);
      this.bars.set(city, bar);
      this.groups.set(city, group);
      this.node.append(group);
    }
  }

  /** set rolls each changed digit to its new value at the same moment its
   *  accessible name changes. */
  set(clocks: Clock[]): void {
    const changedCities: string[] = [];
    for (const clock of clocks) {
      const previous = this.shown.find((shown) => shown.city === clock.city);
      if (previous && previous.time === clock.time && previous.inside_hours === clock.inside_hours) continue;
      changedCities.push(clock.city);
      const stack = this.stacks.get(clock.city);
      const bar = this.bars.get(clock.city);
      const group = this.groups.get(clock.city);
      if (!stack || !bar || !group) continue;
      this.renderDigits(stack, clock.time, previous?.time ?? "");
      bar.classList.toggle("inside", clock.inside_hours);
      group.setAttribute(
        "aria-label",
        `${clock.city} ${clock.time}, ${clock.inside_hours ? "inside working hours" : "outside working hours"}`,
      );
    }
    this.shown = clocks.map((clock) => ({ ...clock }));
    if (changedCities.length && reducedMotion()) {
      void import("./state").then(({ announce }) => announce(threeClockLine(this.shown)));
    }
  }

  values(): Clock[] {
    return this.shown;
  }

  private renderDigits(stack: HTMLElement, time: string, previous: string): void {
    clear(stack);
    for (let index = 0; index < time.length; index += 1) {
      const character = time[index];
      const digit = el("span", { class: "digit", text: character });
      if (previous[index] !== undefined && previous[index] !== character && !reducedMotion()) {
        digit.classList.add("rolling");
      }
      stack.append(digit);
    }
  }

  /** placeBeside opens the ribbon next to a block. */
  placeBeside(block: HTMLElement): void {
    const box = block.getBoundingClientRect();
    this.node.style.position = "fixed";
    this.node.style.left = `${Math.min(box.right + 12, window.innerWidth - 220)}px`;
    this.node.style.top = `${Math.max(8, Math.min(box.top, window.innerHeight - 140))}px`;
    document.getElementById("overlays")?.append(this.node);
    requestAnimationFrame(() => this.node.classList.add("open"));
  }

  remove(): void {
    this.node.remove();
  }
}
