import { el, prefersReducedMotion, announce } from "./ui.ts";
import type { Certificate, Enrolment } from "./api.ts";

// The contact-hour seal: wedges, hatching, the centre numeral and the ring text.

export type SealState = "open" | "pending" | "sealed" | "revoked";

export type SealData = {
  state: SealState;
  modules: Array<{ id: string; title: string; minutes: number; status: "verified" | "unverified" }>;
  totalMinutes: number;
  verifiedCount: number;
  hours: string;
  serial: string | null;
  issuedOn: string | null;
};

const R = 96;
const CX = 100;
const CY = 100;

function ringArcPath(gapDeg: number): string {
  if (gapDeg === 0) return `M ${CX} ${CY - R - 3} A ${R + 3} ${R + 3} 0 1 1 ${CX - 0.01} ${CY - R - 3}`;
  const start = (gapDeg / 2 - 90) * (Math.PI / 180);
  const end = (360 - gapDeg / 2 - 90) * (Math.PI / 180);
  const x1 = CX + (R + 3) * Math.cos(start);
  const y1 = CY + (R + 3) * Math.sin(start);
  const x2 = CX + (R + 3) * Math.cos(end);
  const y2 = CY + (R + 3) * Math.sin(end);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R + 3} ${R + 3} 0 1 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function wedgePath(startDeg: number, sweepDeg: number): string {
  const start = (startDeg - 90) * (Math.PI / 180);
  const end = (startDeg - 90 + sweepDeg) * (Math.PI / 180);
  const x1 = CX + R * Math.cos(start);
  const y1 = CY + R * Math.sin(start);
  const x2 = CX + R * Math.cos(end);
  const y2 = CY + R * Math.sin(end);
  const large = sweepDeg > 180 ? 1 : 0;
  return `M ${CX} ${CY} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

const RING_GAP = 14;

export function buildSeal(data: SealData): { svg: SVGSVGElement; numeral: SVGTextElement; ringGroup: SVGGElement; ringText: SVGTextElement; wedges: Array<{ id: string; path: SVGGElement }> } {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 200 200");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Contact-hour seal");
  svg.classList.add("seal");

  const defs = document.createElementNS(svgNS, "defs");
  const pattern = document.createElementNS(svgNS, "pattern");
  pattern.setAttribute("id", "hatch");
  pattern.setAttribute("width", "6");
  pattern.setAttribute("height", "6");
  pattern.setAttribute("patternTransform", "rotate(45)");
  pattern.setAttribute("patternUnits", "userSpaceOnUse");
  const line = document.createElementNS(svgNS, "line");
  line.setAttribute("x1", "0");
  line.setAttribute("y1", "0");
  line.setAttribute("x2", "0");
  line.setAttribute("y2", "6");
  line.setAttribute("stroke", "currentColor");
  line.setAttribute("stroke-width", "1.5");
  pattern.append(line);
  defs.append(pattern);
  svg.append(defs);

  const outer = document.createElementNS(svgNS, "path");
  outer.setAttribute("d", ringArcPath(data.state === "pending" ? RING_GAP : 0));
  outer.setAttribute("fill", "none");
  outer.setAttribute("stroke", "currentColor");
  outer.setAttribute("stroke-width", "1.5");
  outer.classList.add("seal-outer");
  svg.append(outer);

  const wedges: Array<{ id: string; path: SVGGElement }> = [];
  let cursor = data.state === "pending" ? RING_GAP / 2 : 0;
  const available = data.state === "pending" ? 360 - RING_GAP : 360;
  for (const module of data.modules) {
    const sweep = (module.minutes / data.totalMinutes) * available;
    if (module.status === "verified") {
      const group = document.createElementNS(svgNS, "g");
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", wedgePath(cursor, sweep));
      path.setAttribute("fill", "currentColor");
      group.append(path);
      group.setAttribute("data-module-id", module.id);
      group.setAttribute("data-state", "verified");
      group.setAttribute("data-sweep", ((module.minutes / data.totalMinutes) * 360).toFixed(1));
      svg.append(group);
      wedges.push({ id: module.id, path: group });
    } else {
      const group = document.createElementNS(svgNS, "g");
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", wedgePath(cursor, sweep));
      path.setAttribute("fill", "url(#hatch)");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "1.5");
      path.setAttribute("fill-opacity", "0.25");
      group.append(path);
      group.setAttribute("data-module-id", module.id);
      group.setAttribute("data-state", "unverified");
      group.setAttribute("data-sweep", ((module.minutes / data.totalMinutes) * 360).toFixed(1));
      svg.append(group);
      wedges.push({ id: module.id, path: group });
    }
    cursor += sweep;
  }

  const numeral = document.createElementNS(svgNS, "text");
  numeral.setAttribute("x", String(CX));
  numeral.setAttribute("y", String(CY + 8));
  numeral.setAttribute("text-anchor", "middle");
  numeral.setAttribute("class", "seal-numeral");
  numeral.setAttribute("data-seal-numeral", "true");
  numeral.textContent = data.hours;
  svg.append(numeral);

  const ringGroup = document.createElementNS(svgNS, "g");
  ringGroup.setAttribute("data-seal-ring", "true");
  const ringText = document.createElementNS(svgNS, "text");
  ringText.setAttribute("x", String(CX));
  ringText.setAttribute("y", String(CY - R - 9));
  ringText.setAttribute("text-anchor", "middle");
  ringText.setAttribute("class", "seal-ring");
  ringText.textContent = data.serial && data.issuedOn ? `${data.serial} · ${data.issuedOn}` : "";
  ringGroup.append(ringText);
  svg.append(ringGroup);
  if (data.state === "pending") ringGroup.setAttribute("data-pending-gap", "true");

  const pendingLabel = document.createElementNS(svgNS, "text");
  pendingLabel.setAttribute("x", String(CX));
  pendingLabel.setAttribute("y", String(CY - R + 16));
  pendingLabel.setAttribute("text-anchor", "middle");
  pendingLabel.setAttribute("class", "seal-pending");
  pendingLabel.textContent = data.state === "pending" ? "Certificate PDF pending" : "";
  svg.append(pendingLabel);

  return { svg, numeral, ringGroup, ringText, wedges };
}

export function sealFromEnrolment(enrolment: Enrolment, certificate: Certificate | null): SealData {
  const state: SealState = certificate
    ? certificate.state === "revoked"
      ? "revoked"
      : certificate.state === "sealing"
        ? "pending"
        : "sealed"
    : "open";
  return {
    state,
    modules: enrolment.modules.map((m) => ({ id: m.id, title: m.title, minutes: m.minutes, status: m.status })),
    totalMinutes: enrolment.total_minutes,
    verifiedCount: enrolment.modules.filter((m) => m.status === "verified").length,
    hours: certificate?.contact_hours ?? "0.00",
    serial: certificate?.serial ?? null,
    issuedOn: certificate?.issued_on ? formatIssueDate(certificate.issued_on) : null,
  };
}

function formatIssueDate(iso: string): string {
  const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  );
}

export type SealPressHandle = { cancel: () => void };

/**
 * The seal press, played once after this browser submitted the post-evaluation.
 * Time-driven, no loops; reduced motion renders the final state at once.
 */
export function playSealPress(
  seal: ReturnType<typeof buildSeal>,
  data: SealData,
  onEnableActions: () => void,
): SealPressHandle {
  const verified = seal.wedges.filter((w) => w.path.getAttribute("data-state") === "verified");
  const reduced = prefersReducedMotion();
  if (reduced) {
    finishWedges();
    seal.numeral.textContent = data.hours;
    if (data.state === "sealed" || data.state === "revoked") showRing();
    onEnableActions();
    return { cancel: () => undefined };
  }

  const timers: Array<number> = [];
  const step = (fn: () => void, ms: number): void => {
    timers.push(window.setTimeout(fn, ms));
  };
  verified.forEach((wedge, index) => {
    const group = wedge.path;
    group.setAttribute("opacity", "0");
    step(() => {
      group.animate(
        [{ opacity: 0, transform: "scale(0.4)" }, { opacity: 1, transform: "scale(1)" }],
        { duration: 420, easing: "ease-out", fill: "forwards" },
      ).onfinish = () => group.removeAttribute("opacity");
    }, index * 62);
  });

  const wedgesDone = verified.length * 62 + 420;
  const hours = Number(data.hours);
  const countStart = wedgesDone;
  const countDuration = 900;
  step(() => {
    const startTime = performance.now();
    const tick = (): void => {
      const progress = Math.min(1, (performance.now() - startTime) / countDuration);
      const value = Math.floor(progress * hours * 100) / 100;
      seal.numeral.textContent = value.toFixed(2);
      if (progress < 1) requestAnimationFrame(tick);
      else {
        seal.numeral.textContent = data.hours;
        if (data.state === "sealed" || data.state === "revoked") {
          showRing();
        }
        onEnableActions();
      }
    };
    requestAnimationFrame(tick);
  }, countStart);

  return {
    cancel: () => {
      timers.forEach((t) => window.clearTimeout(t));
      finishWedges();
    },
  };

  function finishWedges(): void {
    seal.wedges.forEach((w) => w.path.removeAttribute("opacity"));
  }

  function showRing(): void {
    seal.ringGroup.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, fill: "forwards" });
  }
}
