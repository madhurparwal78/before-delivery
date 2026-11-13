import { istDate, parseInstant, shortDate, timeLabel } from "./clock.js";
import { rupees } from "./money.js";
import type { Lock, Reading } from "./types.js";

/** Every status string the product announces, character for character as the brief prints them. */
export const STATUS = {
  checking: "Checking with the hub.",
  finishGone: "That finish has just gone. Nothing was locked.",
  otherLock: "You already hold a different lock on this model. Release it first.",
  hubBack: "Hub system is back. Stock is live.",
  countDone: "Stock count is done. Stock is live.",
  countStarted: "Stock count started.",
  countSaved: "Stock count saved.",
  releaseRefused: "Hub system unreachable. Your lock is still held. Try again.",
  rideRefused: "Hub system unreachable. Your ride is unchanged. Try again.",
  deliveryRefused: "Hub system unreachable. Your delivery day is unchanged. Try again.",
  hostRefused: "Hub system unreachable. Nothing was changed. Try again.",
  withdrawn: "The hub has withdrawn your unit. Nothing is held for you.",
  lockEnded: "Your price lock has ended. The current price applies.",
  released: "Lock released.",
  sessionEnded: "Your session has ended. Sign in to continue. Your choices are kept.",
  rideCancelled: "Ride cancelled.",
  slotTaken: "That slot has just been taken. Pick another.",
  slotClosed: "That slot has just closed. Pick another.",
  rideLocked: "That ride can no longer be changed.",
  rideExists: "You already have a ride booked on this model.",
  dayFull: "That day has just filled. Pick another.",
  dayClosed: "That day has closed. Pick another.",
  joining: "Joining the line…",
  dayHasPlaces: "That day has a place now. Set it as your delivery day.",
  leftLine: "You have left the line.",
  sheetPending: "Making price sheet…",
  sheetReady: "Price sheet ready.",
  sheetFailed: "Price sheet could not be made. Try again.",
  remindersPending: "Turning on reminders…",
  remindersOn: "Reminders on.",
  remindersFailed: "Reminders could not be turned on. Try again.",
  ridePending: "Booking this ride…",
  deliveryPending: "Setting delivery day…",
  alreadyMarked: "That has already been marked.",
  paused: "3D showroom paused. Your place is kept.",
  back: "3D showroom is back.",
  noWebgl: "This device can't draw the 3D showroom. Everything here is live.",
} as const;

/** Text under a form field, and the refusals of the API that say the same thing. */
export const FIELD = {
  badLogin: "That mobile number and password do not match.",
  mobileTaken: "That mobile number already has an account.",
  name: "Enter your full name.",
  mobile: "Enter a 10-digit mobile number.",
  password: "Use at least 8 characters.",
  licenceNumber: "Enter a licence number like MH1220190043210.",
  licenceDate: "Your licence must be valid on the ride day.",
  mcwg: "A test ride needs a licence that covers motorcycles with gear.",
  count: "Enter a whole number of 0 or more.",
} as const;

export const lockedStatus = (lock: Lock): string => `Price locked until ${lock.expiresLabel}.`;
export const priceStatus = (onRoadPaise: number): string => `Price updated for today. New on-road price ${rupees(onRoadPaise)}.`;
export const rideBooked = (startsAt: string): string => {
  const ms = parseInstant(startsAt) as number;
  return `Ride booked for ${shortDate(istDate(ms))}, ${timeLabel(ms)}.`;
};
export const deliverySet = (date: string): string => `Delivery set for ${shortDate(date)}.`;
export const promoted = (date: string): string => `A place opened. Delivery set for ${shortDate(date)}.`;
export const inLine = (n: number, date: string): string => `You are number ${n} in line for ${shortDate(date)}.`;
export const staleStatus = (reading: Reading): string =>
  reading.staleReason === "count"
    ? `Hub is counting stock. Showing stock from ${reading.stockAsOfLabel}. Locks are paused.`
    : `Hub system unreachable. Showing stock from ${reading.stockAsOfLabel}. Locks are paused.`;
export const marked = (name: string, outcome: "ridden" | "no_show" | "delivered"): string => `${name} marked ${outcome === "no_show" ? "no-show" : outcome}.`;
export const unitDone = (name: string, action: "confirmed" | "refused" | "withdrawn"): string => `${name}'s unit ${action}.`;
