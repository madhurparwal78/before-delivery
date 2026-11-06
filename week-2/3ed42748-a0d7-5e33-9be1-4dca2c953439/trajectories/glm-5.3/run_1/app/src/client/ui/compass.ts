// The horizon compass ring, its pink notch, and the Route status readout.

import { h } from "../dom.js";
import { compassLabel } from "../../shared/geometry.js";

export type CompassState = {
  ringEl: HTMLElement;
  routeEl: HTMLElement;
  setRing(deg: number, reduced: boolean): void;
  setNotch(mode: "idle" | "bearing" | "stamp"): void;
  setRoute(
    readout: { routeId: string; arcRemainingM: number; bearingDeg: number; fraction: number; visible: number } | null,
    now: number,
    reduced: boolean,
  ): void;
  setDoorScreen(x: number | null, y: number | null): void;
  setPhase(phase: string): void;
  announce(text: string): void;
  routeText(): string;
};

const ROUTE_THROTTLE_MS = 1000;

export function createCompass(parent: HTMLElement): CompassState {
  // The ring: N E S W and tick marks every 15 degrees, printed in ink.
  const radius = 86;
  const ticks: string[] = [];
  for (let deg = 0; deg < 360; deg += 15) {
    const rad = ((deg - 90) * Math.PI) / 180;
    const inner = radius - (deg % 90 === 0 ? 0 : 5);
    const x1 = 100 + Math.cos(rad) * (inner - 8);
    const y1 = 100 + Math.sin(rad) * (inner - 8);
    const x2 = 100 + Math.cos(rad) * (inner - 2);
    const y2 = 100 + Math.sin(rad) * (inner - 2);
    ticks.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" />`);
  }
  const labels = ["N", "E", "S", "W"]
    .map((label, i) => {
      const rad = ((i * 90 - 90) * Math.PI) / 180;
      const x = 100 + Math.cos(rad) * (radius - 18);
      const y = 100 + Math.sin(rad) * (radius - 18);
      return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle">${label}</text>`;
    })
    .join("");

  const ringSvg = h("div", { class: "compass-ring" });
  ringSvg.innerHTML = `
    <svg viewBox="0 0 200 200" width="100%" height="100%" aria-hidden="true">
      <circle cx="100" cy="100" r="${radius}" fill="none" stroke="currentColor" stroke-width="2.5" />
      <g stroke="currentColor" stroke-width="2">${ticks.join("")}</g>
      <g class="compass-labels" fill="currentColor" font-family="Fraunces, Georgia, serif" font-size="13" text-anchor="middle">${labels}</g>
      <g class="compass-notch-holder" transform="translate(100, ${100 - radius + 2})">
        <polygon class="notch-outline" points="-7,2 7,2 0,14" fill="none" stroke="currentColor" stroke-width="2" />
        <polygon class="notch-bearing" points="-7,2 7,2 0,14" fill="var(--pink)" stroke="none" style="display:none" />
        <g class="notch-stamp" style="display:none">
          <rect x="-8" y="-2" width="16" height="16" fill="var(--pink)" stroke="currentColor" stroke-width="1.5"
            stroke-dasharray="2 2" />
          <path d="M 0 1.5 L 4.7 5 L 2.9 10.5 L -2.9 10.5 L -4.7 5 Z" transform="translate(0,0)" fill="currentColor" />
        </g>
      </g>
    </svg>`;
  const rotator = ringSvg.querySelector("svg") as SVGSVGElement;
  const ringEl = h("div", {
    role: "img",
    "aria-label": "Horizon compass",
    class: "compass",
    "data-ring-deg": "0",
    "data-notch": "idle",
  });
  ringEl.append(ringSvg);

  const metres = h("span", { class: "metres-numeral", "aria-hidden": "true" });
  const routeEl = h(
    "div",
    {
      role: "status",
      "aria-label": "Route",
      class: "route-status",
      "data-route-id": "",
      "data-arc-remaining-m": "",
      "data-bearing-deg": "",
      "data-ribbon-fraction": "",
      "data-ribbon-visible": "",
      "data-thread-phase": "idle",
      "data-door-screen": "",
    },
    h("span", { class: "route-text", "aria-live": "polite" }),
    metres,
  );
  parent.append(routeEl, ringEl);

  const routeTextEl = routeEl.querySelector(".route-text") as HTMLElement;
  let lastTextAt = 0;
  let lastText = "";

  function setNotch(mode: "idle" | "bearing" | "stamp"): void {
    ringEl.setAttribute("data-notch", mode);
    const holder = ringEl.querySelector(".compass-notch-holder") as SVGGElement;
    (holder.querySelector(".notch-outline") as SVGElement).setAttribute("style", mode === "idle" ? "" : "display:none");
    (holder.querySelector(".notch-bearing") as SVGElement).setAttribute("style", mode === "bearing" ? "" : "display:none");
    (holder.querySelector(".notch-stamp") as SVGElement).setAttribute("style", mode === "stamp" ? "" : "display:none");
  }

  return {
    ringEl,
    routeEl,
    setRing(deg, reduced) {
      ringEl.setAttribute("data-ring-deg", String(Math.round(deg)));
      if (!reduced) {
        rotator.style.transform = `rotate(${Math.round(deg)}deg)`;
        rotator.style.transformOrigin = "100px 100px";
      } else {
        rotator.style.transform = "rotate(0deg)";
      }
    },
    setNotch,
    setRoute(readout, now, reduced) {
      if (!readout) {
        routeEl.setAttribute("data-route-id", "");
        routeEl.setAttribute("data-arc-remaining-m", "");
        routeEl.setAttribute("data-bearing-deg", "");
        routeEl.setAttribute("data-ribbon-fraction", "0.00");
        routeEl.setAttribute("data-ribbon-visible", "0.00");
        routeTextEl.textContent = "";
        metres.textContent = "";
        return;
      }
      const fraction = reduced
        ? Math.min(1, Math.ceil(readout.fraction * 10) / 10)
        : Math.round(Math.min(1, readout.fraction) * 100) / 100;
      routeEl.setAttribute("data-route-id", readout.routeId);
      routeEl.setAttribute("data-arc-remaining-m", readout.arcRemainingM.toFixed(1));
      routeEl.setAttribute("data-bearing-deg", String(Math.round(readout.bearingDeg)));
      routeEl.setAttribute("data-ribbon-fraction", fraction.toFixed(2));
      routeEl.setAttribute("data-ribbon-visible", readout.visible.toFixed(2));
      if (now - lastTextAt >= ROUTE_THROTTLE_MS) {
        lastTextAt = now;
        const label = compassLabel(Math.round(readout.bearingDeg));
        const text = `Bearing ${label} ${Math.round(readout.bearingDeg)}°, ${Math.round(readout.arcRemainingM)} m`;
        if (text !== lastText) {
          lastText = text;
          routeTextEl.textContent = text;
        }
      }
      metres.textContent = `${Math.round(readout.arcRemainingM)}`;
    },
    setDoorScreen(x, y) {
      routeEl.setAttribute("data-door-screen", x === null || x === undefined ? "" : `${Math.round(x)},${Math.round(y ?? 0)}`);
    },
    setPhase(phase) {
      routeEl.setAttribute("data-thread-phase", phase);
    },
    announce(text) {
      routeTextEl.textContent = text;
      lastText = text;
      lastTextAt = performance.now();
    },
    routeText: () => lastText,
  };
}
