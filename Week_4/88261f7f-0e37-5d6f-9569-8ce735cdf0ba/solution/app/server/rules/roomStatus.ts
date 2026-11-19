import type { Role, RoomStatus } from "../../shared/api";

const EVERYONE: readonly Role[] = ["housekeeper", "front_desk", "owner"];
const DESK: readonly Role[] = ["front_desk", "owner"];
const OWNER: readonly Role[] = ["owner"];

const MOVES: readonly { from: RoomStatus; to: RoomStatus; roles: readonly Role[] }[] = [
  { from: "dirty", to: "clean", roles: EVERYONE },
  { from: "clean", to: "inspected", roles: DESK },
  { from: "clean", to: "dirty", roles: EVERYONE },
  { from: "inspected", to: "dirty", roles: EVERYONE },
  { from: "dirty", to: "out_of_order", roles: OWNER },
  { from: "clean", to: "out_of_order", roles: OWNER },
  { from: "inspected", to: "out_of_order", roles: OWNER },
  { from: "out_of_order", to: "dirty", roles: OWNER },
];

export const ROOM_STATUSES: readonly RoomStatus[] = ["dirty", "clean", "inspected", "out_of_order"];

export function roomStatusMoveAllowed(role: Role, from: RoomStatus, to: RoomStatus): boolean {
  return MOVES.some((move) => move.from === from && move.to === to && move.roles.includes(role));
}
