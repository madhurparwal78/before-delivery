import { useSyncExternalStore } from "react";
import type { Chapter } from "../../../shared/domain.js";
import { createStory, type StoryController } from "../scene/index.js";

/** The one story controller of the page: created on first use and kept alive across every route change. */

/** The wash over the scene behind sheets (the `--scene-dim` token). */
export const SHEET_DIM = 0.62;

let controller: StoryController | null = null;

export const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const story = (): StoryController => {
  if (controller) return controller;
  const canvas = document.getElementById("scene");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("The page has no #scene canvas.");
  controller = createStory(canvas, { discrete: prefersReducedMotion() });
  return controller;
};

/** Discrete stories (reduced motion, or no WebGL) step through chapters instead of scrubbing with the scroll. */
export const isDiscrete = (): boolean => story().mode === "still" || prefersReducedMotion();

/** Dims the scene, and the still illustration that stands in for it without WebGL. */
export const setSceneDim = (amount: number): void => {
  story().setDim(amount);
  document.documentElement.style.setProperty("--scene-dim-now", String(amount));
};

const subscribeChange = (listener: () => void): (() => void) => story().onChange(listener);

export const useChapter = (): Chapter => useSyncExternalStore(subscribeChange, () => story().chapter);

export const useLitMatches = (): number => useSyncExternalStore(subscribeChange, () => story().litMatches);
