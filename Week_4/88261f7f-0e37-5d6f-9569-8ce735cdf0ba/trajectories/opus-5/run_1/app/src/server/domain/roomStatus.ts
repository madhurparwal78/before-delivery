import { RoomStatus } from '../../shared/roomStatus';
import { Role } from './roles';

export function readyForCheckIn(status: RoomStatus): boolean {
  return status === 'clean' || status === 'inspected';
}

interface StatusMove {
  from: RoomStatus[];
  to: RoomStatus;
  roles: Role[];
}

const MOVES: StatusMove[] = [
  { from: ['dirty'], to: 'clean', roles: ['housekeeper', 'front_desk', 'owner'] },
  { from: ['clean'], to: 'inspected', roles: ['front_desk', 'owner'] },
  { from: ['clean', 'inspected'], to: 'dirty', roles: ['housekeeper', 'front_desk', 'owner'] },
  { from: ['dirty', 'clean', 'inspected'], to: 'out_of_order', roles: ['owner'] },
  { from: ['out_of_order'], to: 'dirty', roles: ['owner'] },
];

export function mayChangeRoomStatus(role: Role, from: RoomStatus, to: RoomStatus): boolean {
  if (from === to) return false;
  return MOVES.some((move) => move.to === to && move.from.includes(from) && move.roles.includes(role));
}
