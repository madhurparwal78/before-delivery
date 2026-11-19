// Pre-match notice panel: shown on first load, stores the choice.
import { el } from "./ui";

const STORAGE_KEY = "hf_notice_choice";

export function noticeChoice(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export function showNotice(onDone: (choice: "standard" | "calm") => void): HTMLElement {
  const prefersReduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrim = el("div", { class: "scrim" });
  const panel = el("div", { class: "panel panel-enter", role: "dialog", "aria-label": "Before you play" });
  panel.style.maxWidth = "560px";

  panel.append(
    el("h2", { text: "BEFORE YOU PLAY", style: "letter-spacing:0.12em" }),
    el("p", {
      text: "This game shows flashes of light, a shaking camera and numbers that roll as they count down.",
      style: "margin:10px 0 8px;color:var(--muted)",
    }),
    el("p", {
      text: "You can switch to calm effects now, or any time from Settings under Comfort.",
      style: "color:var(--muted)",
    }),
  );

  const calm = el("button", { class: "btn btn-ghost", text: "Calm effects" });
  const enter = el("button", { class: "btn btn-mint", text: "Enter" });
  const row = el("div", { class: "btn-row" }, calm, enter);
  panel.append(row);
  scrim.append(panel);
  document.body.append(scrim);

  function pick(choice: "standard" | "calm"): void {
    try { localStorage.setItem(STORAGE_KEY, choice); } catch { /* storage unavailable */ }
    scrim.remove();
    onDone(choice);
  }

  calm.addEventListener("click", () => pick("calm"));
  enter.addEventListener("click", () => pick("standard"));

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      document.removeEventListener("keydown", onKey, true);
      pick("standard");
    }
  };
  document.addEventListener("keydown", onKey, true);

  // Initial focus: Enter, or Calm effects when the system asks for reduced motion.
  (prefersReduce ? calm : enter).focus();
  return scrim;
}
