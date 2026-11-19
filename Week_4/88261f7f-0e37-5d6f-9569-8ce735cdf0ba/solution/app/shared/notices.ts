import { formatMoney } from "./money";
import type { Cancellation, LinkState, RoomStatus } from "./api";

/** A status as words: out_of_order reads "out of order". */
export const statusWords = (status: string): string => status.replaceAll("_", " ");

/** Every sentence a region shows or a live event carries, composed once. */
export const notices = {
  stayCreated: (guest: string, room: string) => `Stay created for ${guest} in room ${room}.`,
  linkNotSent: "The check-in link could not be sent. The mail service is unavailable.",
  stayUpdated: (guest: string) => `Stay updated for ${guest}.`,
  moved: (guest: string, room: string) => `Moved ${guest} to room ${room}.`,
  checkedIn: (guest: string, room: string) => `Checked in ${guest} to room ${room}.`,
  checkedOut: (guest: string, room: string) => `Checked out ${guest} from room ${room}.`,
  cancelled: (guest: string, feeCents: number) =>
    feeCents > 0 ? `Cancelled ${guest}'s stay. Fee: ${formatMoney(feeCents)}.` : `Cancelled ${guest}'s stay. No fee.`,
  linkSent: (guest: string) => `Check-in link sent to ${guest}.`,
  roomStatus: (room: string, status: RoomStatus) => `Room ${room} is now ${statusWords(status)}.`,
  onlineCheckIn: (room: string) => `Room ${room} guest completed online check-in.`,
  merged: (staysMoved: number) => `Guests merged. ${staysMoved} stays moved.`,
  closed: (businessDate: string, charged: number, noShows: number) =>
    `Business date ${businessDate} closed. ${charged} rooms charged. ${noShows} no-shows.`,
  freeRooms: (count: number) => `${count} rooms free tonight`,
  stayCreatedWithLink: (guest: string, room: string, link: LinkState) =>
    link === "sent" ? notices.stayCreated(guest, room) : `${notices.stayCreated(guest, room)} ${notices.linkNotSent}`,
};

export function cancellationText(terms: Pick<Cancellation, "state" | "feeCents">, freeUntil: string): string {
  return terms.state === "free" ? `Free cancellation until ${freeUntil} 18:00` : `Late cancellation fee: ${formatMoney(terms.feeCents)}`;
}
