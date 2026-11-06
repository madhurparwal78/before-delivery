// Icon helpers: Lucide SVG markup inlined into the page.
import { check, lock, clock, circleCheck, circleAlert } from "./icons.js";

export function iconMarkup(name: "check" | "lock" | "clock" | "check-circle" | "alert"): string {
  switch (name) {
    case "check": return check;
    case "lock": return lock;
    case "clock": return clock;
    case "check-circle": return circleCheck;
    case "alert": return circleAlert;
  }
}

export function iconElement(name: Parameters<typeof iconMarkup>[0]): HTMLElement {
  const span = document.createElement("span");
  span.className = "icon";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = iconMarkup(name);
  return span;
}
