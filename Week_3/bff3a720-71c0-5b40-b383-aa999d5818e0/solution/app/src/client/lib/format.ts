import type { Booking, Member } from "../../shared/api";
import { plural } from "../../shared/money";

export function ratingText(rating: Member["rating"]): string {
  if (rating.count === 0 || rating.average === null) return "No ratings yet";
  return `${rating.average.toFixed(1)} from ${plural(rating.count, "rating")}`;
}

/** `<h> h <m> min`, or `<m> min` under an hour. */
export function leftText(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

export function kindLabel(kind: "time_change" | "cancellation"): string {
  return kind === "time_change" ? "time change" : "cancellation";
}

export const STATUS: Record<Booking["state"], string> = {
  held: "Seat held, waiting for you to confirm",
  requested: "Request sent, waiting for the driver",
  accepted: "Accepted",
  confirmed: "Confirmed",
  declined: "Declined",
  expired: "Expired",
  withdrawn: "Withdrawn",
  cancelled_by_passenger: "Cancelled by the passenger",
  cancelled_by_driver: "Cancelled by the driver",
  completed: "Trip completed",
  rated: "Trip completed and rated",
};
