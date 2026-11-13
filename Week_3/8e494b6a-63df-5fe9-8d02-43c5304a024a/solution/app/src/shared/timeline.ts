// The generation timeline sentence (Business rules J), decided in one place for the API and the page.
import { formatDisplay } from "./zone";

export type Phase = "hot" | "warm" | "archive" | "delete";

export interface NextStep {
  step: "rollover" | "warm" | "archive" | "delete";
  at: number | null;
  events?: number;
}

export function timelineText(generation: number, phase: Phase, next: NextStep | null, zone: string): string {
  if (phase === "delete") return `Generation ${generation}, deleted, next: none`;
  let tail = "none";
  if (next) {
    tail = next.at === null ? `${next.step} at ${next.events} events` : `${next.step} at ${formatDisplay(next.at, zone)}`;
  }
  return `Generation ${generation}, ${phase}, next: ${tail}`;
}
