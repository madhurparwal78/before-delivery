import { state } from "./app.js";
import type { EditPreviewResponse, Match } from "../shared/types.js";

/**
 * Shutter trace: a tangerine path draws card by card in reset order, each
 * dependent card's slats half-close, the reset list fills and the counter
 * counts up. Cancel reverses it step by step. Under reduced motion every
 * dependent card is outlined and labelled Will reset at once.
 */
export async function runShutterTrace(res: EditPreviewResponse, editedCard: HTMLElement): Promise<void> {
  clearShutterTrace();
  if (state.reducedMotion) {
    // reduced motion: outlines and labels appear at once, the list is complete at once
    for (const d of res.dependents) {
      const card = cardFor(d.match_id);
      if (!card) continue;
      card.dataset.tracePath = "1";
      card.appendChild(willResetLabel());
    }
    const edited = editedCard;
    edited.dataset.tracePath = "1";
    return;
  }
  const edited = editedCard;
  edited.dataset.tracePath = "1";
  await sleep(200);
  for (let i = 0; i < res.dependents.length; i++) {
    const d = res.dependents[i]!;
    const card = cardFor(d.match_id);
    if (card) {
      card.dataset.tracePath = "1";
      card.dataset.shutter = "half";
      card.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
    await sleep(90);
  }
}

export function clearShutterTrace(): void {
  document.querySelectorAll<HTMLElement>("[data-trace-path]").forEach((c) => {
    delete c.dataset.tracePath;
    delete c.dataset.shutter;
    c.querySelectorAll(".will-reset-label").forEach((n) => n.remove());
  });
}

function cardFor(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-match-id="${id}"]`);
}

function willResetLabel(): HTMLElement {
  const label = document.createElement("span");
  label.className = "will-reset-label";
  label.textContent = "Will reset";
  return label;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Advance motion: a copy of the winner's name travels to its next card. */
export function playAdvance(winnerName: string, fromCard: HTMLElement, toCardId: string): void {
  if (state.reducedMotion) return;
  const to = cardFor(toCardId);
  if (!to) return;
  const fromRect = fromCard.getBoundingClientRect();
  const toRect = to.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.dataset.motion = "advance";
  ghost.textContent = winnerName;
  ghost.style.left = `${fromRect.left}px`;
  ghost.style.top = `${fromRect.top + 20}px`;
  document.body.appendChild(ghost);
  const start = performance.now();
  const duration = 320;
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / duration);
    const x = fromRect.left + (toRect.left - fromRect.left) * t;
    const y = fromRect.top + (toRect.top - fromRect.top) * t;
    ghost.style.transform = `translate(${x - fromRect.left}px, ${y - fromRect.top - 20}px)`;
    if (t < 1) requestAnimationFrame(step);
    else ghost.remove();
  };
  requestAnimationFrame(step);
}

export function resetCardVisual(m: Match): void {
  const card = cardFor(m.id);
  if (card) {
    card.dataset.state = m.state;
  }
}
