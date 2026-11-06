// Display scale: the hero title and every section head are sized so their words span about 84% of the viewport
// width at their final (wide) stretch, at every viewport. The hero title's widest line sets its size.
import { useEffect } from "react";

const TARGET = 0.84;
const PROBE_PX = 100;

function textWidth(text: string, reference: HTMLElement): number {
  const probe = document.createElement("span");
  const style = getComputedStyle(reference);
  probe.textContent = text;
  Object.assign(probe.style, {
    position: "absolute", visibility: "hidden", whiteSpace: "nowrap", left: "-9999px", top: "0",
    fontFamily: style.fontFamily, fontWeight: style.fontWeight, fontStretch: "125%", letterSpacing: "-0.01em", fontSize: `${PROBE_PX}px`,
  });
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

function fit(): void {
  const viewport = document.documentElement.clientWidth;
  for (const el of document.querySelectorAll<HTMLElement>("[data-fit]")) {
    const lines = [...el.querySelectorAll<HTMLElement>("[data-fit-line]")];
    const stacked = lines.length > 1 && getComputedStyle(lines[0]!).display === "block";
    const texts = stacked ? lines.map((l) => l.textContent ?? "") : [el.textContent ?? ""];
    const widest = Math.max(...texts.map((t) => textWidth(t, el)));
    if (widest > 0) el.style.fontSize = `${((PROBE_PX * TARGET * viewport) / widest).toFixed(2)}px`;
  }
}

export function useDisplayFit(ready: boolean): void {
  useEffect(() => {
    fit();
    void document.fonts.ready.then(fit);
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [ready]);
}
