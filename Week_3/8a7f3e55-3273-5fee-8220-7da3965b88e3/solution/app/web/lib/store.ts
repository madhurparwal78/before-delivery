import type { Booking } from "../../shared/api";
import { apiGet } from "./api";
import { usePolled } from "./refresh";

/** The booking list `GET /api/bookings` answers, sorted by start time as the server sends it. */
export const fetchBookings = async (query: string): Promise<Booking[]> => (await apiGet<{ bookings: Booking[] }>(`/api/bookings${query}`)).bookings;

/** Replaces one booking in a list by id, or inserts it in start order when the list does not hold it yet. */
export function withBooking(list: Booking[], booking: Booking): Booking[] {
  if (list.some((item) => item.id === booking.id)) return list.map((item) => (item.id === booking.id ? booking : item));
  return [...list, booking].sort((a, b) => (a.start === b.start ? a.ref.localeCompare(b.ref, undefined, { numeric: true }) : Date.parse(a.start) - Date.parse(b.start)));
}

/** The selected booking: the one fetched by id when it is current, else the copy the list already holds. */
export function useSelected(id: string | null, fromLists: Booking | undefined) {
  const detail = usePolled<Booking>(id === null ? null : `booking:${id}`, () => apiGet<Booking>(`/api/bookings/${id}`));
  const fetched = detail.data !== undefined && detail.data.id === id ? detail.data : undefined;
  return { booking: fetched ?? fromLists, failure: detail.failure, put: detail.put };
}
