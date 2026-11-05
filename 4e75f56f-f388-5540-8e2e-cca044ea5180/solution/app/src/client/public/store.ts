// State of the public site: the bench ledger and the signed-in account, refreshed every second,
// the countdown of a live hold (server seconds counted down on page time, never the device date) and the
// Bench updates messages, which background refreshes never overwrite once an outcome is shown.
import { useLayoutEffect, useReducer } from "preact/hooks";
import { call, type ApiError, type Benches, type Me, type Reservation, type Tier } from "../api.js";
import { SEATS_TOTAL } from "../catalogue.js";

type PayKind = "deposit" | "full";
export type Outcome = "confirmed" | "pending" | "offline" | "refused";
type Sync = { ids: string[]; labels: string[]; groupId: string | null; expiresAt: string; seconds: number; duration: number; at: number };

const REFRESH_MS = 1000;
const remainingCopy = (n: number) => `${n} of ${SEATS_TOTAL} seats remaining.`;
export const BILLING_OFFLINE = "Billing is offline right now. Your hold keeps running and no money has moved.";
export const DEPOSITS_CLOSED = "Deposits closed on 19 March 2027. Pay in full to reserve a bench.";

class Store {
  benches: Benches | null = null;
  me: Me | null = null;
  signedIn: boolean | null = null;
  tier: Tier = "bench";
  message = "";
  sticky = false;
  billingOffline = false;
  selection: string[] = [];
  holding: string[] = [];
  hold: Sync | null = null;
  confirmed: string[] = [];
  pendingPayment: { ids: string[]; labels: string[]; group: boolean } | null = null;
  holdEnded: string[] | null = null;
  signInFor: (() => void) | null = null;
  signInOpener: HTMLElement | null = null;
  private paidBeforeExpiry = new Set<string>();
  /** Holds released from this page: an answer read before the release never brings them back. */
  private releasedHere = new Set<string>();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    for (const listener of this.listeners) listener();
  }

  start(): void {
    if (!this.timer) void this.refresh();
  }

  get role() {
    return this.me?.account.role ?? null;
  }

  get isClinic() {
    return this.role === "clinic";
  }

  get seatsRemaining(): number {
    return this.benches?.seats_remaining ?? SEATS_TOTAL;
  }

  /** Seconds left on the live hold, from the latest server answer, on page time. */
  secondsLeft(): number | null {
    if (!this.hold) return null;
    return this.hold.seconds - (performance.now() - this.hold.at) / 1000;
  }

  private announce(text: string, sticky = false): void {
    this.message = text;
    this.sticky = sticky;
  }

  /** Asks for a fresh read; one polling loop runs, and a call during a read queues one more read. */
  refresh(): Promise<void> {
    this.rerun = true;
    this.cycle ??= this.loop();
    return this.cycle;
  }

  private rerun = false;
  private cycle: Promise<void> | null = null;
  /** Bumped by each of your own actions: a read started before one is dropped, never applied over its answer. */
  private generation = 0;

  private async loop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    while (this.rerun) {
      this.rerun = false;
      await this.poll();
    }
    this.cycle = null;
    this.timer = setTimeout(() => void this.refresh(), REFRESH_MS);
  }

  private async poll(): Promise<void> {
    // While a hold request runs, the map keeps its previous state until the server answers it.
    if (this.holding.length) return;
    const generation = this.generation;
    try {
      const me = this.signedIn !== false ? await call<Me>("GET", "/api/me") : null;
      const benches = await call<Benches>("GET", "/api/benches");
      if (generation !== this.generation || this.holding.length) return;
      if (me) this.apply(me.ok ? me.data : null);
      if (benches.ok) this.benches = benches.data;
      this.afterRefresh();
    } catch {
      // Offline for a moment: keep the last known state and try again on the next tick.
    }
    this.emit();
  }

  private apply(me: Me | null): void {
    this.me = me;
    this.signedIn = me !== null;
    if (!me) {
      this.hold = null;
      return;
    }
    const held = me.reservations.filter((r) => r.state === "held" && !this.releasedHere.has(r.id));
    const tracked = this.hold;
    const first = held[0];
    if (first?.hold) {
      const sameHold = tracked !== null && tracked.expiresAt === first.hold.expires_at;
      const left = this.secondsLeft();
      // Nothing extends a hold, so a later answer for the same hold never winds the countdown back up.
      this.hold =
        sameHold && left !== null && left <= first.hold.seconds_remaining
          ? { ...tracked, ids: held.map((r) => r.id), labels: held.map((r) => r.bench) }
          : {
              ids: held.map((r) => r.id),
              labels: held.map((r) => r.bench),
              groupId: first.group_id,
              expiresAt: first.hold.expires_at,
              seconds: first.hold.seconds_remaining,
              duration: first.hold.duration_seconds,
              at: performance.now(),
            };
    } else {
      this.hold = null;
    }
    if (tracked && !this.hold) {
      const ended = me.reservations.filter((r) => tracked.ids.includes(r.id) && r.state === "released" && !this.releasedHere.has(r.id));
      if (ended.length && !ended.some((r) => this.paidBeforeExpiry.has(r.id))) {
        this.holdEnded = tracked.labels;
        this.afterBenches = () => this.announce(`Your hold on Bench ${tracked.labels.join(", ")} has ended. ${remainingCopy(this.seatsRemaining)}`);
      }
    }
    if (this.pendingPayment) {
      const seats = me.reservations.filter((r) => this.pendingPayment?.ids.includes(r.id));
      if (seats.length && seats.every((r) => r.state !== "held" && !r.payment_pending)) {
        this.confirmed = this.pendingPayment.labels;
        this.pendingPayment = null;
        this.afterBenches = () => this.announce(this.confirmedCopy(), true);
      }
    }
  }

  /** A server-reported change announced once the seat count in the same refresh is known. */
  private afterBenches: (() => void) | null = null;

  private afterRefresh(): void {
    this.afterBenches?.();
    this.afterBenches = null;
  }

  private confirmedCopy(): string {
    const labels = this.confirmed;
    return labels.length > 1
      ? `${labels.length} benches are yours. ${remainingCopy(this.seatsRemaining)}`
      : `Bench ${labels[0] ?? ""} is yours. ${remainingCopy(this.seatsRemaining)}`;
  }

  private async latestBenches(): Promise<void> {
    const benches = await call<Benches>("GET", "/api/benches");
    if (benches.ok) this.benches = benches.data;
  }

  setTier(tier: Tier): void {
    this.tier = tier;
    this.emit();
  }

  /** Enter or a click on a bench button. */
  choose(label: string, stateText: string): void {
    if (stateText === "Atelier only") {
      this.announce(`Bench ${label} is an Atelier bench. Switch to Atelier to hold it.`);
      return this.emit();
    }
    if (this.isClinic && !this.hold) {
      if (stateText !== "Open" && stateText !== "Sold out") return;
      this.selection = this.selection.includes(label)
        ? this.selection.filter((l) => l !== label)
        : this.selection.length < 6
          ? [...this.selection, label]
          : this.selection;
      return this.emit();
    }
    if (stateText !== "Open" && stateText !== "Sold out") return;
    if (!this.signedIn) return this.askSignIn(() => void this.placeHold([label]));
    void this.placeHold([label]);
  }

  clearSelection(): void {
    this.selection = [];
    this.emit();
  }

  async placeHold(labels: string[]): Promise<void> {
    this.generation += 1;
    this.holding = labels;
    this.sticky = false;
    this.billingOffline = false;
    this.confirmed = [];
    this.emit();
    const reply = await call<{ reservations: Reservation[]; group_id: string | null; seats_remaining: number }>("POST", "/api/holds", { benches: labels });
    this.holding = [];
    if (reply.ok) {
      this.selection = [];
      const first = reply.data.reservations[0];
      if (first?.hold) {
        this.hold = {
          ids: reply.data.reservations.map((r) => r.id),
          labels,
          groupId: reply.data.group_id,
          expiresAt: first.hold.expires_at,
          seconds: first.hold.seconds_remaining,
          duration: first.hold.duration_seconds,
          at: performance.now(),
        };
      }
      await this.latestBenches();
      this.announce(
        labels.length > 1
          ? `${labels.length} benches are held for you. ${remainingCopy(reply.data.seats_remaining)}`
          : `Bench ${labels[0]} is held for you. ${remainingCopy(reply.data.seats_remaining)}`,
      );
    } else {
      await this.latestBenches();
      this.announceRefusal(reply.error, labels);
    }
    this.emit();
    void this.refresh();
  }

  private announceRefusal(error: ApiError, labels: string[]): void {
    if (error.error === "atelier_sold_out") this.announce(`Atelier is sold out. ${remainingCopy(this.seatsRemaining)}`);
    else if (error.error === "bench_taken") {
      const taken = labels.find((label) => this.benches?.benches.find((b) => b.label === label)?.state !== "open") ?? labels[0];
      this.announce(`Bench ${taken} was just taken. ${remainingCopy(this.seatsRemaining)}`);
    } else this.announce(error.message);
  }

  async release(): Promise<void> {
    this.generation += 1;
    const hold = this.hold;
    if (!hold) {
      if (this.selection.length) this.clearSelection();
      return;
    }
    this.hold = null;
    for (const id of hold.ids) this.releasedHere.add(id);
    this.emit();
    const path = hold.groupId ? `/api/groups/${hold.groupId}/release` : `/api/reservations/${hold.ids[0]}/release`;
    const reply = await call<{ seats_remaining: number }>("POST", path, {});
    if (reply.ok) {
      this.announce(`Bench ${hold.labels.join(", ")} released. ${remainingCopy(reply.data.seats_remaining)}`);
    } else {
      for (const id of hold.ids) this.releasedHere.delete(id);
      this.announce(reply.error.message);
    }
    this.billingOffline = false;
    void this.refresh();
  }

  async joinWaitlist(tier: Tier): Promise<void> {
    this.generation += 1;
    if (!this.signedIn) return this.askSignIn(() => void this.joinWaitlist(tier));
    const reply = await call<{ tier: Tier; position: number }>("POST", "/api/waitlist", { tier });
    this.announce(reply.ok ? `You are number ${reply.data.position} on the ${tier === "bench" ? "Bench" : "Atelier"} waitlist.` : reply.error.message);
    this.emit();
    void this.refresh();
  }

  /** Pays the live hold (one bench) or the group invoice. The outcome copy is announced and kept. */
  async pay(
    kind: PayKind | "group",
    billingName: string,
    key: string,
    assignments: { bench: string; name: string; email: string }[] = [],
  ): Promise<{ outcome: Outcome; error?: ApiError }> {
    const hold = this.hold;
    if (!hold) return { outcome: "refused", error: { error: "hold_expired", message: "This hold has ended." } };
    this.generation += 1;
    for (const id of hold.ids) this.paidBeforeExpiry.add(id);
    const group = kind === "group";
    const path = group ? `/api/groups/${hold.groupId}/checkout` : `/api/reservations/${hold.ids[0]}/${kind}`;
    const body = group ? { billing_name: billingName, assignments } : { billing_name: billingName };
    let reply;
    try {
      reply = await call<unknown>("POST", path, body, key);
    } catch {
      reply = { ok: false as const, status: 503, error: { error: "billing_unavailable", message: BILLING_OFFLINE } };
    }
    await this.latestBenches();
    const labels = hold.labels;
    if (reply.ok && reply.status === 201) {
      this.billingOffline = false;
      this.confirmed = labels;
      this.pendingPayment = null;
      this.announce(this.confirmedCopy(), true);
      this.emit();
      void this.refresh();
      return { outcome: "confirmed" };
    }
    if (reply.ok) {
      this.billingOffline = false;
      this.pendingPayment = { ids: hold.ids, labels, group };
      this.announce(
        group
          ? `Payment for ${labels.length} benches is being confirmed. We will update this page and email your receipt.`
          : `Payment for Bench ${labels[0]} is being confirmed. We will update this page and email your receipt.`,
        true,
      );
      this.emit();
      return { outcome: "pending" };
    }
    for (const id of hold.ids) this.paidBeforeExpiry.delete(id);
    if (reply.error.error === "billing_unavailable") {
      this.billingOffline = true;
      this.announce(BILLING_OFFLINE, true);
      this.emit();
      return { outcome: "offline", error: reply.error };
    }
    const text = reply.error.error === "deposits_closed" ? DEPOSITS_CLOSED : reply.error.message;
    this.announce(text);
    this.emit();
    return { outcome: "refused", error: { ...reply.error, message: text } };
  }

  dismissHoldEnded(): void {
    this.holdEnded = null;
    this.emit();
  }

  closeSignIn(signedIn: boolean): void {
    const next = this.signInFor;
    this.signInFor = null;
    if (signedIn) this.signedIn = null;
    this.emit();
    void this.refresh().then(() => {
      if (signedIn && next) next();
    });
  }

  openSignIn(): void {
    this.askSignIn(() => undefined);
  }

  /** Opens the sign-in dialog; `then` runs once signed in, and closing puts focus back on its opener. */
  private askSignIn(then: () => void): void {
    this.signInOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.signInFor = then;
    this.emit();
  }
}

export const store = new Store();

export function useStore(): Store {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useLayoutEffect(() => store.subscribe(() => bump(undefined)), []);
  return store;
}
