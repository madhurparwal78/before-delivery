import type { JSX } from "preact";
import type { Kitchen } from "../../shared/api.js";
import { addDays, dateLabel } from "../../shared/clock.js";
import { kitchenToday } from "../kitchen.js";
import { Icon } from "../ui.js";

/** Previous day / Next day / Today and the shown kitchen date; each press adds a history entry. */
export function DateGroup({ date, kitchen, onDate }: { date: string; kitchen: Kitchen; onDate: (date: string) => void }): JSX.Element {
  return (
    <div class="dates" role="group" aria-label="Kitchen date">
      <button type="button" class="button button--quiet" aria-label="Previous day" onClick={() => onDate(addDays(date, -1))}><Icon name="chevron-left" /><span class="dates__word">Previous day</span></button>
      <p class="dates__shown">{dateLabel(date)}</p>
      <button type="button" class="button button--quiet" aria-label="Next day" onClick={() => onDate(addDays(date, 1))}><span class="dates__word">Next day</span><Icon name="chevron-right" /></button>
      <button type="button" class="button button--quiet" onClick={() => onDate(kitchenToday(kitchen))} aria-current={date === kitchenToday(kitchen) ? "date" : undefined}>
        <Icon name="calendar-check" />Today
      </button>
    </div>
  );
}
