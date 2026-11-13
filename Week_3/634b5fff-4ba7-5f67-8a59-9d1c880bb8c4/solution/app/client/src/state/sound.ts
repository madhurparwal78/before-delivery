import type { Chapter } from "../../../shared/domain.js";
import { Store } from "./store.js";

/** The sound question's answer, kept in localStorage, and the narration it switches on: one audio element per chapter. */

type SoundChoice = "on" | "off" | null;

const KEY = "press.sound";

const stored = (): SoundChoice => {
  const value = localStorage.getItem(KEY);
  return value === "on" || value === "off" ? value : null;
};

export const sound = new Store<SoundChoice>(stored());

export const chooseSound = (choice: "on" | "off"): void => {
  localStorage.setItem(KEY, choice);
  sound.set(choice);
};

const tracks = new Map<Chapter, HTMLAudioElement>();
let playing: HTMLAudioElement | null = null;

const trackOf = (chapter: Chapter): HTMLAudioElement => {
  const existing = tracks.get(chapter);
  if (existing) return existing;
  const audio = new Audio(`/narration/${chapter}.ogg`);
  tracks.set(chapter, audio);
  return audio;
};

/** Plays the chapter's narration and stops the previous one; `null` stops everything. A refused play is ignored. */
export const narrate = (chapter: Chapter | null): void => {
  if (playing) {
    playing.pause();
    playing.currentTime = 0;
    playing = null;
  }
  if (chapter === null) return;
  playing = trackOf(chapter);
  playing.play().catch(() => undefined);
};
