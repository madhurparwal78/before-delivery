import { useEffect, useRef } from "react";
import { useReducedMotion } from "../lib/hooks";

const PIECES = 160;
const DURATION_MS = 2800;
const GRAVITY = 0.0016;
const TOKENS = ["--yellow", "--pink", "--accent", "--ink"] as const;

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  turn: number;
  spin: number;
  colour: string;
}

/** One burst of confetti from the middle of the screen on a canvas that never takes input; it removes itself when it is done. */
function confettiBurst(): void {
  const canvas = document.createElement("canvas");
  const ratio = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * ratio;
  canvas.height = window.innerHeight * ratio;
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "90" });
  const context = canvas.getContext("2d");
  if (!context) return;
  document.body.append(canvas);
  context.scale(ratio, ratio);

  const root = getComputedStyle(document.documentElement);
  const colours = TOKENS.map((token) => root.getPropertyValue(token).trim());
  const pieces: Piece[] = Array.from({ length: PIECES }, (_, index) => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
    const speed = 0.5 + Math.random() * 0.9;
    return {
      x: window.innerWidth / 2,
      y: window.innerHeight * 0.55,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 6 + Math.random() * 8,
      turn: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.02,
      colour: colours[index % colours.length] as string,
    };
  });

  let last: number | null = null;
  let elapsed = 0;
  const frame = (now: number): void => {
    const step = last === null ? 16 : Math.min(48, now - last);
    last = now;
    elapsed += step;
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const piece of pieces) {
      piece.vy += GRAVITY * step;
      piece.x += piece.vx * step;
      piece.y += piece.vy * step;
      piece.turn += piece.spin * step;
      context.save();
      context.globalAlpha = Math.max(0, Math.min(1, (DURATION_MS - elapsed) / 700));
      context.translate(piece.x, piece.y);
      context.rotate(piece.turn);
      context.fillStyle = piece.colour;
      context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
      context.restore();
    }
    if (elapsed < DURATION_MS) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/** Plays one burst the first time `show` becomes true; none under reduced motion. */
export function useConfettiOnce(show: boolean): void {
  const reduced = useReducedMotion();
  const played = useRef(false);
  useEffect(() => {
    if (!show || played.current) return;
    played.current = true;
    if (!reduced) confettiBurst();
  }, [show, reduced]);
}
