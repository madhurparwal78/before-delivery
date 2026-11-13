/** Serviceability and the delivery promise. One decision, every caller. */

import { addDays, indiaDate } from './time.js';

export type PincodeRecord = {
  pincode: string;
  city: string;
  state: string;
  serviceable: boolean;
  cod: boolean;
  remote: boolean;
};

export type SellerRecord = {
  id: string;
  display_name: string;
  pickup_city: string;
  pickup_state: string;
  dispatch_days: number;
  rating: number;
  cod_allowed: boolean;
  ship_states: string[];
};

export function sellerDelivers(seller: SellerRecord, destination: PincodeRecord | null): boolean {
  if (destination === null || !destination.serviceable) return false;
  return seller.ship_states.includes(destination.state);
}

export function laneDays(seller: SellerRecord, destination: PincodeRecord): number {
  const base =
    destination.city === seller.pickup_city ? 1 : destination.state === seller.pickup_state ? 2 : 4;
  return base + (destination.remote ? 2 : 0);
}

export function sameCityLane(seller: SellerRecord, destination: PincodeRecord | null): boolean {
  return destination !== null && destination.serviceable && destination.city === seller.pickup_city;
}

export type Promise = { promise_date: string | null; one_day_available: boolean };

export function deliveryPromise(
  seller: SellerRecord,
  destination: PincodeRecord | null,
  oneDay: boolean,
  now: Date = new Date(),
): Promise {
  if (!sellerDelivers(seller, destination) || destination === null) {
    return { promise_date: null, one_day_available: false };
  }
  const today = indiaDate(now);
  const oneDayAvailable = sameCityLane(seller, destination);
  if (oneDay && oneDayAvailable) {
    return { promise_date: addDays(today, 1), one_day_available: true };
  }
  return {
    promise_date: addDays(today, seller.dispatch_days + laneDays(seller, destination)),
    one_day_available: oneDayAvailable,
  };
}
