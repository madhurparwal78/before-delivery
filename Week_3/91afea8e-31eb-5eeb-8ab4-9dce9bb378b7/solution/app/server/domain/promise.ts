import type { DeliverySpeed } from "./fees.js";

export interface SellerLane {
  pickupCity: string;
  pickupState: string;
  dispatchDays: number;
  shipToStates: readonly string[];
}

export interface Destination {
  pincode: string;
  city: string;
  state: string;
  serviceable: boolean;
  remote: boolean;
  codAvailable: boolean;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function todayInIndia(nowMs: number): string {
  return new Date(nowMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function sellerDelivers(seller: SellerLane, destination: Destination): boolean {
  return destination.serviceable && seller.shipToStates.includes(destination.state);
}

function laneDays(seller: SellerLane, destination: Destination): number {
  const lane = destination.city === seller.pickupCity ? 1 : destination.state === seller.pickupState ? 2 : 4;
  return lane + (destination.remote ? 2 : 0);
}

export function oneDayAvailable(seller: SellerLane, destination: Destination): boolean {
  return sellerDelivers(seller, destination) && destination.city === seller.pickupCity;
}

/** The delivery promise date, or null when the seller cannot reach the destination. */
export function promiseDate(nowMs: number, seller: SellerLane, destination: Destination, speed: DeliverySpeed): string | null {
  if (!sellerDelivers(seller, destination)) return null;
  const today = todayInIndia(nowMs);
  return speed === "one_day" ? addDays(today, 1) : addDays(today, seller.dispatchDays + laneDays(seller, destination));
}
