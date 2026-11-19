/**
 * Hero intro, role line, copy drift and sculpture tilt. The intro's end and the
 * role rotation are the first two page-clock items; drift and tilt follow the
 * pointer and the scroll directly.
 */
import {
  ANNOUNCEMENTS,
  INTRO_DONE_MS,
  ROLES,
  ROLE_INTERVAL,
} from "../shared/domain.js";
import { announce, prefersReducedMotion, qs, viewportUnder768 } from "./core.js";
import { copyDrift, tiltAngles } from "./scroll-rules.js";

type RoleState = {
  index: number;
  paused: boolean;
  hold: boolean;
  nextAt: number;
  timer: number;
};

let roleState: RoleState | null = null;

export function initHero(): void {
  const intro = qs<HTMLElement>("[data-intro]");
  if (!intro) return;
  const url = new URL(window.location.href);
  const skipIntro =
    prefersReducedMotion() ||
    url.hash !== "" ||
    url.searchParams.has("category") ||
    url.searchParams.has("service");
  if (skipIntro) {
    intro.dataset.intro = "done";
  } else {
    const endIntro = (): void => {
      intro.dataset.intro = "done";
    };
    const endByTimer = window.setTimeout(endIntro, INTRO_DONE_MS);
    const endAtOnce = (): void => {
      window.clearTimeout(endByTimer);
      endIntro();
      window.removeEventListener("keydown", endAtOnce, true);
      window.removeEventListener("pointerdown", endAtOnce, true);
      window.removeEventListener("wheel", endAtOnce as EventListener, { capture: true });
      window.removeEventListener("scroll", endAtOnce as EventListener, { capture: true });
    };
    window.addEventListener("keydown", endAtOnce, { capture: true });
    window.addEventListener("pointerdown", endAtOnce, { capture: true });
    window.addEventListener("wheel", endAtOnce as EventListener, { capture: true, passive: true });
    window.addEventListener("scroll", endAtOnce as EventListener, { capture: true, passive: true });
  }
  initRoles();
  initDrift();
  initTilt();
}

function initRoles(): void {
  const line = qs<HTMLElement>("[data-role-line]");
  const role = qs<HTMLElement>("[data-role]");
  const pauseButton = qs<HTMLButtonElement>("[data-role-pause]");
  const prevButton = qs<HTMLButtonElement>("[data-role-prev]");
  const nextButton = qs<HTMLButtonElement>("[data-role-next]");
  if (!line || !role || !pauseButton || !prevButton || !nextButton) return;

  roleState = {
    index: 1,
    paused: prefersReducedMotion(),
    hold: false,
    nextAt: 0,
    timer: 0,
  };

  if (roleState.paused) {
    pauseButton.setAttribute("aria-pressed", "true");
    pauseButton.textContent = "Play roles";
  }

  const show = (index: number, sliding: boolean): void => {
    if (!roleState) return;
    roleState.index = index;
    role.dataset.roleIndex = String(index);
    role.textContent = ROLES[index - 1];
    if (sliding && !prefersReducedMotion()) {
      role.dataset.sliding = "true";
      window.setTimeout(() => role.removeAttribute("data-sliding"), 400);
    }
  };
  const restart = (): void => {
    if (!roleState) return;
    roleState.nextAt = performance.now() + ROLE_INTERVAL;
  };

  const tick = (): void => {
    if (!roleState) return;
    const now = performance.now();
    if (!roleState.paused && !roleState.hold && now >= roleState.nextAt) {
      const next = roleState.index === ROLES.length ? 1 : roleState.index + 1;
      show(next, true);
      restart();
    }
    roleState.timer = window.setTimeout(tick, 16);
  };

  const intro = qs<HTMLElement>("[data-intro]");
  const introDone = (): void => {
    restart();
    tick();
  };
  if (!intro || intro.dataset.intro === "done") {
    introDone();
  } else {
    const observer = new MutationObserver(() => {
      if (intro.dataset.intro === "done") {
        observer.disconnect();
        introDone();
      }
    });
    observer.observe(intro, { attributes: true, attributeFilter: ["data-intro"] });
  }

  const holdActive = (): boolean => {
    if (!roleState) return false;
    return roleState.hold;
  };

  const applyHold = (): void => {
    if (!roleState) return;
    roleState.hold = true;
  };

  const releaseHold = (): void => {
    if (!roleState) return;
    roleState.hold = false;
    restart();
  };

  line.addEventListener("pointerenter", () => {
    if (window.matchMedia("(hover: hover)").matches) applyHold();
  });
  line.addEventListener("pointerleave", () => {
    if (window.matchMedia("(hover: hover)").matches && holdActive()) releaseHold();
  });
  for (const button of [prevButton, nextButton, pauseButton]) {
    button.addEventListener("focus", () => {
      if (!roleState) return;
      if (button === pauseButton && roleState.paused) return;
      applyHold();
    });
    button.addEventListener("blur", () => {
      if (!roleState) return;
      if (document.activeElement === prevButton || document.activeElement === nextButton || document.activeElement === pauseButton) {
        return;
      }
      releaseHold();
    });
  }

  const step = (direction: 1 | -1): void => {
    if (!roleState) return;
    const next =
      direction === 1
        ? roleState.index === ROLES.length
          ? 1
          : roleState.index + 1
        : roleState.index === 1
          ? ROLES.length
          : roleState.index - 1;
    show(next, false);
    restart();
  };

  nextButton.addEventListener("click", () => step(1));
  prevButton.addEventListener("click", () => step(-1));

  pauseButton.addEventListener("click", () => {
    if (!roleState) return;
    roleState.paused = !roleState.paused;
    const paused = roleState.paused;
    pauseButton.setAttribute("aria-pressed", paused ? "true" : "false");
    pauseButton.textContent = paused ? "Play roles" : "Pause roles";
    if (paused) {
      announce(ANNOUNCEMENTS.pause);
    } else {
      announce(ANNOUNCEMENTS.play);
      roleState.hold = false;
      restart();
    }
  });
}

function initDrift(): void {
  const copy = qs<HTMLElement>("[data-hero-copy]");
  if (!copy) return;
  const apply = (): void => {
    const drift = copyDrift(window.scrollY);
    copy.style.transform = `translateY(-${drift}px)`;
  };
  window.addEventListener(
    "scroll",
    () => apply(),
    { passive: true }
  );
  window.addEventListener("resize", () => apply());
  apply();
}

function initTilt(): void {
  const section = qs<HTMLElement>("[data-intro]");
  const visual = qs<HTMLElement>("[data-hero-visual]");
  if (!section || !visual) return;
  const apply = (event: PointerEvent): void => {
    if (viewportUnder768() || prefersReducedMotion()) return;
    if (event.pointerType === "touch") return;
    const box = section.getBoundingClientRect();
    const { x, y } = tiltAngles(event.clientX, event.clientY, box);
    visual.dataset.tiltX = String(x);
    visual.dataset.tiltY = String(y);
    visual.style.setProperty("--tilt-x", `${x}deg`);
    visual.style.setProperty("--tilt-y", `${y}deg`);
  };
  const reset = (): void => {
    visual.dataset.tiltX = "0";
    visual.dataset.tiltY = "0";
    visual.style.setProperty("--tilt-x", "0deg");
    visual.style.setProperty("--tilt-y", "0deg");
  };
  section.addEventListener("pointermove", apply);
  section.addEventListener("pointerleave", reset);
  window.addEventListener("resize", () => {
    if (viewportUnder768() || prefersReducedMotion()) reset();
  });
}
