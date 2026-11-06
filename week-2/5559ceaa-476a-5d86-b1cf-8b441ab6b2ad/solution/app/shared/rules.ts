// Domain rules both the server (which enforces them) and the browser (which shows only what they allow) read.

export type SessionState = "scheduled" | "live" | "paused" | "ended";
export type SessionAction = "start" | "pause" | "resume" | "end";

/** Session transitions: each action's target state and the states it may start from. */
export const TRANSITIONS: Record<SessionAction, { to: SessionState; from: readonly SessionState[] }> = {
  start: { to: "live", from: ["scheduled"] },
  pause: { to: "paused", from: ["live"] },
  resume: { to: "live", from: ["paused"] },
  end: { to: "ended", from: ["live", "paused"] },
};

interface Running {
  state: SessionState;
  driver_id: string | null;
}

/** The write rule: with a live session only its driver writes, with a paused one nobody, otherwise every member. */
export function writeRefusal(running: Running | null, userId: string): "session_paused" | "not_driver" | null {
  if (!running) return null;
  if (running.state === "paused") return "session_paused";
  return running.driver_id === userId ? null : "not_driver";
}

/** Only the mentor or the current driver may pass the baton. */
export function mayPass(role: "mentor" | "student", driverId: string | null, userId: string): boolean {
  return role === "mentor" || driverId === userId;
}
