import { type Disposables, query } from "../Disposables";

const LEAVE_MS = 640;

/**
 * The loading gate. It reports real progress (fonts, sound files, the film's poster and every 3D scene
 * compiled), traces the mark's circle by the same share, and only shows its two buttons at 100%. Focus then goes to the button matching this
 * browser's remembered sound choice. Choosing starts the story and the gate fades out.
 */
export function initGate(
  disposables: Disposables,
  reduced: boolean,
  remembered: boolean | null,
  onEnter: (withSound: boolean) => void,
) {
  const gate = query(".sh-gate");
  const bar = query("[role='progressbar']", gate);
  const percent = query(".sh-gate__percent", gate);
  const enter = query<HTMLButtonElement>(".sh-gate__enter", gate);
  const silent = query<HTMLButtonElement>(".sh-gate__silent", gate);
  const root = document.documentElement;
  let shown = 0;
  root.classList.add("is-locked");

  const setProgress = (fraction: number) => {
    const value = Math.max(shown, Math.floor(Math.min(1, fraction) * 100));
    shown = value;
    percent.textContent = `${value}%`;
    bar.setAttribute("aria-valuenow", String(value));
    gate.style.setProperty("--progress", String(value / 100));
  };

  const ready = () => {
    setProgress(1);
    gate.dataset.state = "ready";
    enter.hidden = false;
    silent.hidden = false;
    (remembered === false ? silent : enter).focus();
  };

  const leave = (withSound: boolean) => {
    if (gate.dataset.state !== "ready") return;
    gate.dataset.state = "leaving";
    root.classList.remove("is-locked");
    root.classList.add("is-entered");
    onEnter(withSound);
    // Focus moves at once, so a later fade timer never pulls it back from wherever the visitor went next.
    document.querySelector<HTMLElement>("#sh-hero-title")?.focus({ preventScroll: true });
    const finish = () => {
      gate.dataset.state = "gone";
      gate.hidden = true;
    };
    if (reduced) finish();
    else window.setTimeout(finish, LEAVE_MS);
  };

  disposables.listen(enter, "click", () => leave(true));
  disposables.listen(silent, "click", () => leave(false));
  disposables.add(() => root.classList.remove("is-locked", "is-entered"));

  return { setProgress, ready };
}
