import type { RoomStatus, StayStatus } from "./api";
import type { IsoDate } from "./dates";
import { statusWords } from "./notices";

export type StayAction = "check_in" | "check_out" | "cancel" | "close";

const TRANSITIONS: Record<StayAction, { from: StayStatus; to: StayStatus; refusal: string }> = {
  check_in: { from: "booked", to: "in_house", refusal: "This stay cannot be checked in." },
  check_out: { from: "in_house", to: "checked_out", refusal: "This stay cannot be checked out." },
  cancel: { from: "booked", to: "cancelled", refusal: "This stay can no longer be cancelled." },
  close: { from: "booked", to: "no_show", refusal: "This stay cannot be closed out." },
};

/** The status an action starts from and the one it leaves a stay in. */
export const statusBefore = (action: StayAction): StayStatus => TRANSITIONS[action].from;
export const statusAfter = (action: StayAction): StayStatus => TRANSITIONS[action].to;

const FINAL_STATUSES: readonly StayStatus[] = ["checked_out", "cancelled", "no_show"];

/** True once a stay can no longer change. */
export const isFinal = (status: StayStatus): boolean => FINAL_STATUSES.includes(status);

/** Cancelled and no-show stays hold no nights. */
export const holdsNights = (status: StayStatus): boolean => status !== "cancelled" && status !== "no_show";

/** Whether the action can start from this status. */
export const offers = (action: StayAction, status: StayStatus): boolean => TRANSITIONS[action].from === status;

/** A booked stay arriving on the business date may be checked in, room status permitting. */
export const mayCheckIn = (stay: { status: StayStatus; arrival: IsoDate }, businessDate: IsoDate): boolean =>
  offers("check_in", stay.status) && stay.arrival === businessDate;
export const CANNOT_MOVE = "That stay cannot be moved.";

interface TransitionContext {
  status: StayStatus;
  arrival: IsoDate;
  departure: IsoDate;
  businessDate: IsoDate;
  roomNumber: string;
  roomStatus: RoomStatus;
}

/** The one place a stay changes state: the new status, or the published refusal. */
export function transition(action: StayAction, stay: TransitionContext): { to: StayStatus } | { refusal: string } {
  const rule = TRANSITIONS[action];
  if (!offers(action, stay.status)) return { refusal: rule.refusal };
  if (action === "check_in") {
    if (!mayCheckIn(stay, stay.businessDate)) {
      return { refusal: `This stay arrives on ${stay.arrival}, not on business date ${stay.businessDate}.` };
    }
    if (stay.roomStatus !== "clean" && stay.roomStatus !== "inspected") {
      return { refusal: `Room ${stay.roomNumber} is ${statusWords(stay.roomStatus)} and cannot be checked in.` };
    }
  }
  if (action === "check_out" && stay.departure > stay.businessDate) {
    return { refusal: `This stay departs on ${stay.departure}. Change its dates before checking out early.` };
  }
  return { to: rule.to };
}
