import { useEffect, useRef } from "react";
import type { Booking } from "../../shared/api";
import { euros } from "../../shared/money";
import { announce } from "./announce";

/** Announce how a request ended, when this page saw it waiting first. */
export function useRequestOutcome(booking: Booking | null): void {
  const previous = useRef<{ id: string; state: string } | null>(null);
  useEffect(() => {
    if (!booking) return;
    const was = previous.current?.id === booking.id ? previous.current.state : null;
    previous.current = { id: booking.id, state: booking.state };
    if (was !== "requested") return;
    const driver = booking.driver.display_name;
    const price = euros(booking.price_cents);
    if (booking.state === "confirmed") announce(`Request accepted by ${driver}.`);
    else if (booking.state === "declined") announce(`Request declined by ${driver}. ${price} is back in your wallet.`);
    else if (booking.state === "expired") announce("This request expired");
    else if (booking.state === "withdrawn") announce(`Request withdrawn. ${price} is back in your wallet.`);
  }, [booking]);
}
