import type { RitualChoice } from "../../../shared/hour";
import { ritualStore, type RitualChange } from "../../../shared/ritualStore";
import { RITUALS, ritualById } from "../../../shared/rituals";
import { track } from "../../content";
import { type Disposables, query } from "../Disposables";
import type { Sound } from "./sound";

/**
 * Ritual cards: each card's toggle adds the ritual at its default minutes or removes it, through the same
 * store as the planner. Every change from either place, and every refusal of a ritual that would take the
 * hour past 60 minutes, is announced in "Ritual updates". Clips loop only while at least half the card is
 * on screen and motion is allowed.
 */
export function initTrack(disposables: Disposables, sound: Sound, reduced: boolean) {
  const updates = query("[data-ritual-updates]");
  const cards = RITUALS.map((ritual) => {
    const card = query(`[data-ritual="${ritual.id}"]`);
    return { ritual, card, toggle: query<HTMLButtonElement>("button", card), clip: query<HTMLVideoElement>("video", card) };
  });
  let timer = 0;

  /** Empties the region first, so the same sentence twice in a row is announced twice. */
  const announce = (text: string) => {
    updates.textContent = "";
    window.clearTimeout(timer);
    timer = window.setTimeout(() => (updates.textContent = text), 30);
  };

  const render = (chosen: readonly RitualChoice[]) => {
    cards.forEach(({ ritual, toggle }) => {
      const on = chosen.some((entry) => entry.id === ritual.id);
      toggle.setAttribute("aria-pressed", String(on));
      toggle.textContent = on ? track.remove(ritual.title) : track.add(ritual.title);
    });
  };

  const report = (change: RitualChange) => {
    const { title } = ritualById(change.id);
    const total = ritualStore.total();
    if (change.kind === "added") {
      announce(track.addedCopy(title, total));
      sound.chime("add");
    } else if (change.kind === "removed") announce(track.removed(title, total));
    else announce(track.noRoom(title, total));
  };

  render(ritualStore.get());
  disposables.add(
    ritualStore.subscribe((chosen, change) => {
      render(chosen);
      if (change) report(change);
    }),
  );
  disposables.add(() => window.clearTimeout(timer));
  cards.forEach(({ ritual, toggle }) => {
    disposables.listen(toggle, "click", () => (ritualStore.has(ritual.id) ? ritualStore.remove(ritual.id) : ritualStore.add(ritual.id)));
  });

  if (reduced) return;
  cards.forEach(({ card, clip }) => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[entries.length - 1].intersectionRatio >= 0.5) {
          clip.preload = "auto";
          void clip.play().catch(() => {});
        } else {
          clip.pause();
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    observer.observe(card);
    disposables.add(() => observer.disconnect());
  });
}
