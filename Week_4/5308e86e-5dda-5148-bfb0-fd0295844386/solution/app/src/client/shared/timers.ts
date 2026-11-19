/** Timers that stop when the session ends. */
import { ending, onSessionEnd } from "./session.js";

export function every(action: () => void, milliseconds: number): () => void {
  const id = window.setInterval(() => {
    if (!ending.ended) action();
  }, milliseconds);
  const stop = () => window.clearInterval(id);
  onSessionEnd(stop);
  return stop;
}

export function after(action: () => void, milliseconds: number): () => void {
  const id = window.setTimeout(() => {
    if (!ending.ended) action();
  }, milliseconds);
  const stop = () => window.clearTimeout(id);
  onSessionEnd(stop);
  return stop;
}
