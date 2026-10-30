import { fitsHour, isRitualMinutes, totalMinutes, type RitualChoice } from "./hour";
import { isRitualId, ritualById, type RitualId } from "./rituals";

const PARAM = "rituals";

/** What a change did to one ritual: added, removed, or refused because it would pass 60 minutes. */
export interface RitualChange {
  kind: "added" | "removed" | "refused";
  id: RitualId;
}

type Listener = (chosen: readonly RitualChoice[], change: RitualChange | null) => void;

/**
 * Reads `?rituals=<id>:<minutes>,…`: drops entries with an unknown id, an id that appeared earlier in the
 * address, or minutes off the 5-to-30 step, then drops later entries until the hour fits in 60 minutes.
 */
function parse(raw: string): RitualChoice[] {
  const chosen: RitualChoice[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const [id, minutesText] = part.split(":");
    const minutes = Number(minutesText);
    const repeated = seen.has(id);
    seen.add(id);
    if (!isRitualId(id) || repeated || !isRitualMinutes(minutes)) continue;
    chosen.push({ id, minutes });
  }
  while (!fitsHour(chosen)) chosen.pop();
  return chosen;
}

function serialise(chosen: readonly RitualChoice[]) {
  return chosen.map((entry) => `${entry.id}:${entry.minutes}`).join(",");
}

function writeUrl(chosen: readonly RitualChoice[]) {
  const url = new URL(window.location.href);
  if (chosen.length) url.searchParams.set(PARAM, serialise(chosen));
  else url.searchParams.delete(PARAM);
  const next = url.toString().replace(/%2C/gi, ",").replace(/%3A/gi, ":");
  if (next !== window.location.href) window.history.replaceState(window.history.state, "", next);
}

/** The rituals chosen for the visitor's hour, in the order they were added, kept in the page address. */
class RitualStore {
  private chosen: RitualChoice[] = [];
  private listeners = new Set<Listener>();
  private loaded = false;

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    this.chosen = parse(new URLSearchParams(window.location.search).get(PARAM) ?? "");
    writeUrl(this.chosen);
    window.addEventListener("popstate", () => {
      this.chosen = parse(new URLSearchParams(window.location.search).get(PARAM) ?? "");
      this.emit(null);
    });
  }

  get(): readonly RitualChoice[] {
    this.load();
    return this.chosen;
  }

  total() {
    return totalMinutes(this.get());
  }

  has(id: RitualId) {
    return this.get().some((entry) => entry.id === id);
  }

  /** Adds a ritual not yet chosen, at its default minutes; false (and nothing changes) when it would pass 60 minutes. */
  add(id: RitualId): boolean {
    const next = [...this.chosen, { id, minutes: ritualById(id).minutes }];
    if (!fitsHour(next)) {
      this.emit({ kind: "refused", id });
      return false;
    }
    this.commit(next, { kind: "added", id });
    return true;
  }

  /** Removes a chosen ritual. */
  remove(id: RitualId) {
    this.commit(
      this.chosen.filter((entry) => entry.id !== id),
      { kind: "removed", id },
    );
  }

  /** Changes a chosen ritual's minutes (already on the 5-to-30 step); false, and nothing changes, past 60 in total. */
  setMinutes(id: RitualId, minutes: number): boolean {
    const next = this.get().map((entry) => (entry.id === id ? { id, minutes } : entry));
    if (!fitsHour(next)) {
      this.emit({ kind: "refused", id });
      return false;
    }
    this.commit(next);
    return true;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private commit(next: RitualChoice[], change: RitualChange | null = null) {
    this.chosen = next;
    writeUrl(next);
    this.emit(change);
  }

  private emit(change: RitualChange | null) {
    this.listeners.forEach((listener) => listener(this.chosen, change));
  }
}

export const ritualStore = new RitualStore();
