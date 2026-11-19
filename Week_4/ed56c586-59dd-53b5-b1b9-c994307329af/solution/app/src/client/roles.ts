import { ROLES } from "../shared/catalog.js";
import { ROTATION_PAUSED, ROTATION_RESUMED } from "../shared/announcements.js";
import { announce } from "./announce.js";
import { must, play, prefersReducedMotion } from "./dom.js";

/** The role line. After the intro ends the shown role advances every 2,500 ms of page time; manual changes restart the
 * countdown; hovering the line or focusing a role button holds the rotation; `Pause roles` stops it. */

const ROTATION_MS = 2500;
const SLIDE_MS = 400;
const SLIDE_EASING = "cubic-bezier(0.2, 0.7, 0.2, 1)";

interface Roles {
  readonly start: () => void;
}

export function initRoles(): Roles {
  const line = must<HTMLElement>(document, "[data-role-line]");
  const windowOfRole = must<HTMLElement>(line, ".role-window");
  const role = must<HTMLElement>(line, "[data-role]");
  const controls = must<HTMLElement>(document, ".role-controls");
  const previous = must<HTMLButtonElement>(controls, "[data-role-previous]");
  const next = must<HTMLButtonElement>(controls, "[data-role-next]");
  const toggle = must<HTMLButtonElement>(controls, "[data-role-toggle]");
  const pauseIcon = must<HTMLElement>(toggle, "[data-toggle-pause]");
  const playIcon = must<HTMLElement>(toggle, "[data-toggle-play]");

  let index = 0;
  let started = false;
  let paused = prefersReducedMotion();
  let hovering = false;
  let focusHeld = false;
  let timer = 0;

  const endSlide = (): void => {
    role.getAnimations().forEach((animation) => animation.cancel());
    windowOfRole.querySelectorAll(".role-ghost").forEach((ghost) => ghost.remove());
  };

  const show = (to: number, slide: boolean): void => {
    endSlide();
    const outgoing = role.textContent ?? "";
    index = to;
    role.textContent = ROLES[index];
    role.dataset["roleIndex"] = String(index + 1);
    if (!slide) return;
    const ghost = document.createElement("span");
    ghost.className = "role-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.textContent = outgoing;
    windowOfRole.append(ghost);
    const leaving = play(ghost, [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-100%)", opacity: 0 }], { duration: SLIDE_MS, easing: SLIDE_EASING });
    play(role, [{ transform: "translateY(100%)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: SLIDE_MS, easing: SLIDE_EASING });
    leaving?.finished.then(() => ghost.remove(), () => undefined);
  };

  const schedule = (): void => {
    window.clearTimeout(timer);
    if (started && !paused && !hovering && !focusHeld) {
      timer = window.setTimeout(() => {
        show((index + 1) % ROLES.length, true);
        schedule();
      }, ROTATION_MS);
    }
  };

  const step = (by: number): void => {
    show((index + by + ROLES.length) % ROLES.length, false);
    schedule();
  };

  const reflectToggle = (): void => {
    toggle.setAttribute("aria-label", paused ? "Play roles" : "Pause roles");
    pauseIcon.hidden = paused;
    playIcon.hidden = !paused;
  };

  next.addEventListener("click", () => step(1));
  previous.addEventListener("click", () => step(-1));
  toggle.addEventListener("click", () => {
    paused = !paused;
    reflectToggle();
    if (!paused) focusHeld = false;
    announce(paused ? ROTATION_PAUSED : ROTATION_RESUMED);
    schedule();
  });
  line.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") {
      hovering = true;
      schedule();
    }
  });
  line.addEventListener("pointerleave", () => {
    hovering = false;
    schedule();
  });
  controls.addEventListener("focusin", () => {
    focusHeld = true;
    schedule();
  });
  controls.addEventListener("focusout", (event) => {
    if (event.relatedTarget instanceof Node && controls.contains(event.relatedTarget)) return;
    focusHeld = false;
    schedule();
  });
  reflectToggle();

  return {
    start: () => {
      started = true;
      schedule();
    },
  };
}
