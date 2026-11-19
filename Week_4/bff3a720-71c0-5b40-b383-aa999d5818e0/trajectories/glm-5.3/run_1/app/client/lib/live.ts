import { store } from './store.js';
import type { Booking, Ride, SeatRow } from './types.js';

export interface LiveHandlers {
  onSeat?: (rideId: string, seatMap: SeatRow[]) => void;
  onRide?: (ride: Ride) => void;
  onBooking?: (booking: Booking) => void;
  onNotice?: (n: { ride_id: string; passenger_id: string; kind: string; status: string; sent_at: string | null }) => void;
  onMessage?: (bookingId: string, message: { id: string; author_id: string; body: string; sent_at: string }) => void;
  onPresence?: (bookingId: string, p: { member_id: string; online: boolean; last_seen_at: string | null }) => void;
  onRating?: (bookingId: string, state: string) => void;
  onIdReview?: (p: { id_state: string; reason: string | null }) => void;
  onWallet?: (balanceCents: number) => void;
  onClock?: (serverNow: string) => void;
  onHello?: () => void;
}

export class LiveClient {
  #es: EventSource | null = null;
  #handlers: LiveHandlers = {};
  #rideId: string | null = null;
  #threadId: string | null = null;
  #down = false;
  #listeners = new Set<(down: boolean) => void>();

  constructor() { this.reconnect(); }

  setHandlers(h: LiveHandlers): void {
    this.#handlers = h;
  }

  subscribe(rideId: string | null, threadId: string | null): void {
    if (rideId === this.#rideId && threadId === this.#threadId && this.#es) return;
    this.#rideId = rideId;
    this.#threadId = threadId;
    this.reconnect();
  }

  onDownChange(fn: (down: boolean) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  isDown(): boolean { return this.#down; }

  private setDown(down: boolean): void {
    if (this.#down === down) return;
    this.#down = down;
    for (const fn of this.#listeners) fn(down);
  }

  reconnect(): void {
    this.#es?.close();
    const params = new URLSearchParams();
    if (this.#rideId) params.set('ride', this.#rideId);
    if (this.#threadId) params.set('thread', this.#threadId);
    const qs = params.size > 0 ? `?${params.toString()}` : '';
    const es = new EventSource(`/api/live${qs}`);
    this.#es = es;
    es.addEventListener('hello', () => { this.setDown(false); this.#handlers.onHello?.(); });
    for (const type of ['seat', 'ride', 'booking', 'notice', 'message', 'presence', 'rating', 'id_review', 'wallet', 'clock']) {
      es.addEventListener(type, (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data as string);
          this.dispatch(type, data);
        } catch { /* ignore malformed */ }
      });
    }
    es.onerror = () => {
      this.setDown(true);
    };
  }

  private dispatch(type: string, data: Record<string, unknown>): void {
    const h = this.#handlers;
    switch (type) {
      case 'seat': h.onSeat?.(String(data.ride_id), (data.seat_map ?? []) as SeatRow[]); break;
      case 'ride': h.onRide?.(data.ride as Ride); break;
      case 'booking': {
        const b = data.booking as Booking | undefined;
        if (b) h.onBooking?.(b);
        break;
      }
      case 'notice': h.onNotice?.(data as never); break;
      case 'message': h.onMessage?.(String(data.booking_id), data.message as never); break;
      case 'presence': h.onPresence?.(String(data.booking_id), data as never); break;
      case 'rating': h.onRating?.(String(data.booking_id), String(data.state)); break;
      case 'id_review': h.onIdReview?.(data as never); break;
      case 'wallet': h.onWallet?.(Number(data.balance_cents)); break;
      case 'clock': store.serverNow = String(data.server_now); h.onClock?.(String(data.server_now)); break;
      default: break;
    }
  }
}

export const live = new LiveClient();
