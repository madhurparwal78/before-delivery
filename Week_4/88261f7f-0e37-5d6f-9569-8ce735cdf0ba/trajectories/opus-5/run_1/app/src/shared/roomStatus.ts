export type RoomStatus = 'dirty' | 'clean' | 'inspected' | 'out_of_order';

export const ROOM_STATUSES: RoomStatus[] = ['dirty', 'clean', 'inspected', 'out_of_order'];

export function isRoomStatus(value: unknown): value is RoomStatus {
  return typeof value === 'string' && (ROOM_STATUSES as string[]).includes(value);
}

/** `out of order` reads with spaces wherever a status is shown as words. */
export function roomStatusWords(status: RoomStatus): string {
  return status === 'out_of_order' ? 'out of order' : status;
}

export function roomStatusLabel(status: RoomStatus): string {
  const words = roomStatusWords(status);
  return words.charAt(0).toUpperCase() + words.slice(1);
}
