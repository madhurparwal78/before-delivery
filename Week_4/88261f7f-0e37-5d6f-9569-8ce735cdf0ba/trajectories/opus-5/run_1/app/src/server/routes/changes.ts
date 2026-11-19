import { Db } from '../db';
import { Hotel } from '../repo/hotels';
import { ChangeType, publishChange } from '../services/live';
import { roomChangeEvents } from './housekeeping';

/**
 * Sends one committed change to the hotel's staff: the notice for owner and front desk, and a
 * room-only message for each affected room so a housekeeper's board follows along.
 */
export async function publishStayChange(
  db: Db,
  hotel: Hotel,
  options: {
    type: ChangeType;
    stayId?: string;
    notice: string | null;
    roomIds?: string[];
  },
): Promise<void> {
  const roomIds = options.roomIds ?? [];
  if (roomIds.length === 0) {
    await publishChange(db, hotel.id, {
      type: options.type,
      notice: options.notice,
      ...(options.stayId ? { stayId: options.stayId } : {}),
    });
    return;
  }
  for (let index = 0; index < roomIds.length; index += 1) {
    const events = await roomChangeEvents(db, hotel, roomIds[index], null);
    await publishChange(
      db,
      hotel.id,
      {
        type: options.type,
        notice: index === 0 ? options.notice : null,
        ...(options.stayId ? { stayId: options.stayId } : {}),
        roomId: roomIds[index],
      },
      events.housekeeper,
    );
  }
}
