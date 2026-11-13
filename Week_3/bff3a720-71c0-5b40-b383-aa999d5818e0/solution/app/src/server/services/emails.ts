import { euros } from "../../shared/money";
import { hhmm, shortDate } from "../../shared/time";
import { config } from "../config";

type OutboxKind =
  | "sign_in_code"
  | "booking_confirmed"
  | "request_accepted"
  | "request_declined"
  | "request_expired"
  | "time_change"
  | "cancellation"
  | "ratings_revealed"
  | "id_review";

export interface Email {
  kind: OutboxKind;
  to: string;
  subject: string;
  body: string;
  rideId?: string;
  passengerId?: string;
}

interface Trip {
  from: string;
  to: string;
  boardingTime: Date;
}

const tripText = (trip: Trip): string => `${trip.from} to ${trip.to}, ${shortDate(trip.boardingTime)}`;
const letter = (name: string, ...lines: string[]): string => [`Hello ${name},`, "", ...lines, "", "Longseat"].join("\n");

export const emails = {
  signInCode: (to: string, code: string): Email => ({
    kind: "sign_in_code",
    to,
    subject: "Your Longseat sign-in code",
    body: letter("there", `Your code is ${code}. It expires in ${Math.round(config.emailCodeTtlSeconds / 60)} minutes.`),
  }),
  bookingConfirmed: (to: string, name: string, trip: Trip, paidCents: number): Email => ({
    kind: "booking_confirmed",
    to,
    subject: `Seat booked: ${tripText(trip)}`,
    body: letter(name, `${euros(paidCents)} was paid from your Longseat wallet.`),
  }),
  requestAccepted: (to: string, name: string, driverName: string, trip: Trip): Email => ({
    kind: "request_accepted",
    to,
    subject: "Your request was accepted",
    body: letter(name, `${driverName} accepted your request: ${tripText(trip)}.`),
  }),
  requestDeclined: (to: string, name: string, paidCents: number): Email => ({
    kind: "request_declined",
    to,
    subject: "Your request was declined",
    body: letter(name, `${euros(paidCents)} is back in your Longseat wallet.`),
  }),
  requestExpired: (to: string, name: string, paidCents: number): Email => ({
    kind: "request_expired",
    to,
    subject: "Your request expired",
    body: letter(name, `${euros(paidCents)} is back in your Longseat wallet.`),
  }),
  timeChange: (to: string, name: string, passengerId: string, rideId: string, driverName: string, oldTime: Date, newTime: Date, freeUntil: Date | null): Email => ({
    kind: "time_change",
    to,
    rideId,
    passengerId,
    subject: `Your Longseat ride on ${shortDate(newTime)} now leaves at ${hhmm(newTime)}`,
    body: letter(
      name,
      `${driverName} moved the departure from ${hhmm(oldTime)} to ${hhmm(newTime)}.`,
      ...(freeUntil ? [`You can cancel for free until ${hhmm(freeUntil)} on ${shortDate(freeUntil)}.`] : []),
    ),
  }),
  cancellation: (to: string, name: string, passengerId: string, rideId: string, departure: Date, refundedCents: number): Email => ({
    kind: "cancellation",
    to,
    rideId,
    passengerId,
    subject: `Your Longseat ride on ${shortDate(departure)} was cancelled`,
    body: letter(name, `${euros(refundedCents)} has been refunded to your Longseat wallet.`),
  }),
  ratingsRevealed: (to: string, name: string, trip: Trip): Email => ({
    kind: "ratings_revealed",
    to,
    subject: "Your Longseat ratings are in",
    body: letter(name, `Ratings are revealed for ${tripText(trip)}.`),
  }),
  idVerified: (to: string, name: string): Email => ({
    kind: "id_review",
    to,
    subject: "Your Longseat ID review",
    body: letter(name, "Your ID is verified."),
  }),
  idRejected: (to: string, name: string, reason: string): Email => ({
    kind: "id_review",
    to,
    subject: "Your Longseat ID review",
    body: letter(name, `Please upload your ID again: ${reason}.`),
  }),
};

