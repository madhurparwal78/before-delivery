export type Push = (type: string, payload: unknown) => void;

const matchRooms = new Map<string, Set<Push>>();
const playerRooms = new Map<string, Set<Push>>();

function join(rooms: Map<string, Set<Push>>, key: string, push: Push): () => void {
  let room = rooms.get(key);
  if (room === undefined) {
    room = new Set();
    rooms.set(key, room);
  }
  room.add(push);
  return () => {
    const current = rooms.get(key);
    if (current === undefined) return;
    current.delete(push);
    if (current.size === 0) rooms.delete(key);
  };
}

function send(rooms: Map<string, Set<Push>>, key: string, type: string, payload: unknown): void {
  const room = rooms.get(key);
  if (room === undefined) return;
  for (const push of [...room]) push(type, payload);
}

export const bus = {
  joinMatch: (matchId: string, push: Push) => join(matchRooms, matchId, push),
  joinPlayer: (playerId: string, push: Push) => join(playerRooms, playerId, push),
  toMatch: (matchId: string, type: string, payload: unknown) => send(matchRooms, matchId, type, payload),
  toPlayer: (playerId: string, type: string, payload: unknown) => send(playerRooms, playerId, type, payload),
};
