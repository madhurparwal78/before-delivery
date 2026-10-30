// Holding seats, joining the waitlist and opening checkout, shared by the programme and My tickets.
import { dayPassCovers } from "../../shared/admission.ts";
import { api } from "../api.ts";
import { copy } from "../copy.ts";
import { navigate, setQuery } from "../router.ts";
import { checkoutFeedback } from "../state/feedback.ts";
import { loadDraft, saveDraft } from "../state/checkoutDraft.ts";
import { refreshProgramme } from "../state/programme.ts";
import type { Hold, Session, User } from "../types.ts";

const AFTER_SIGN_IN = "kf-after-sign-in";

/** Signed out: go to sign in, then come back and carry on with the same step. */
function signInFirst(resume: string): void {
  sessionStorage.setItem(AFTER_SIGN_IN, resume);
  navigate(`/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
}

export function takeResume(): string | null {
  const value = sessionStorage.getItem(AFTER_SIGN_IN);
  sessionStorage.removeItem(AFTER_SIGN_IN);
  return value;
}

export function openCheckout(): void {
  setQuery({ checkout: "tickets" });
}

export async function holdSeat(user: User | null, session: Session): Promise<void> {
  if (!user) return signInFirst(`hold:${session.id}`);
  checkoutFeedback.status(copy.holding);
  const r = await api.post<Hold & { seats_remaining: number }>("/api/holds", { session_id: session.id, quantity: 1 });
  void refreshProgramme();
  if (r.ok) {
    openCheckout();
    checkoutFeedback.status(copy.held(r.data.expires_at));
  } else if (r.error === "sold_out") checkoutFeedback.problem(copy.soldOut);
  else if (r.error === "session_cancelled") checkoutFeedback.problem(copy.sessionCancelled(session.title));
  else checkoutFeedback.problem("We couldn't hold that seat. Try again in a moment.");
}

export async function joinWaitlist(user: User | null, session: Session): Promise<void> {
  if (!user) return signInFirst(`waitlist:${session.id}`);
  const r = await api.post<{ position: number }>(`/api/sessions/${session.id}/waitlist`);
  void refreshProgramme();
  if (r.ok) checkoutFeedback.status(copy.waitlistJoined(r.data.position, session.title));
  else if (r.error === "already_waiting") checkoutFeedback.status(`You're already on the waitlist for ${session.title}.`);
  else if (r.error === "seats_available") checkoutFeedback.status(`Seats for ${session.title} are available again — hold one now.`);
  else checkoutFeedback.problem("We couldn't add you to the waitlist. Try again in a moment.");
}

/**
 * Get tickets for my agenda: one hold per seated agenda session that still has seats, then checkout opens on
 * Tickets with the suggested passes. Planetarium Dome or pass sessions on three or more days suggest a
 * full-festival pass; otherwise one day pass per festival day with a pass session.
 */
export async function ticketsForAgenda(user: User | null, agenda: Session[]): Promise<void> {
  if (!user) return signInFirst("agenda");
  const current = await api.get<{ holds: Hold[] }>("/api/holds");
  const held = new Set(current.ok ? current.data.holds.map((h) => h.session_id) : []);
  for (const s of agenda.filter((x) => x.admission === "seat" && x.status === "published" && (x.seats_remaining ?? 0) > 0 && !held.has(x.id))) {
    await api.post("/api/holds", { session_id: s.id, quantity: 1 });
  }
  const passSessions = agenda.filter((s) => s.admission === "pass" && s.status === "published");
  const passDays = [...new Set(passSessions.map((s) => s.festival_day))];
  const full = passSessions.some((s) => !dayPassCovers(s.venue_id)) || passDays.length >= 3;
  saveDraft({ ...loadDraft(), full: full ? 1 : 0, days: full ? {} : Object.fromEntries(passDays.map((d) => [d, 1])) });
  void refreshProgramme();
  checkoutFeedback.clear();
  openCheckout();
}

export function buyPass(user: User | null, product: "full" | "day", day: string | null): void {
  if (!user) return signInFirst(`buy:${product}:${day ?? ""}`);
  const draft = loadDraft();
  saveDraft(product === "full" ? { ...draft, full: Math.max(1, draft.full) } : { ...draft, days: { ...draft.days, [day!]: Math.max(1, draft.days[day!] ?? 0) } });
  checkoutFeedback.clear();
  openCheckout();
}
