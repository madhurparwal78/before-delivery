// The interface limits the server embeds in the page (non-secret FLAN_* values).

import type { UiLimits } from "../shared/limits";

export const limits = JSON.parse(document.getElementById("flan-config")?.textContent ?? "{}") as UiLimits;

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
