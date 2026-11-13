import type { Booking, CoordinatorHolder, Holder, InterpreterHolder } from "../../shared/api";

export const isCoordinatorHolder = (holder: Holder): holder is CoordinatorHolder => "pay_rate_cents" in holder;
const isInterpreterHolder = (holder: Holder): holder is InterpreterHolder => "is_me" in holder;

/** The seat the signed-in interpreter holds on this booking, if any. */
export function mySeat(booking: Booking): number | null {
  return booking.seats.find((seat) => seat.holder !== null && isInterpreterHolder(seat.holder) && seat.holder.is_me)?.seat ?? null;
}

export const credentialCodes = (holder: Holder): string[] =>
  holder.credentials.map((credential) => (typeof credential === "string" ? credential : credential.code));
