import { useCallback, useEffect, useState } from "react";
import type { Board as BoardData, BoardRoom, RoomStatus } from "../shared/api";
import { notices, statusWords } from "../shared/notices";
import { get, post, refusalText } from "./api";
import { useSequence } from "./hooks";
import { useLive } from "./live";
import { TopBar } from "./Shell";
import { useSession } from "./session";
import { Chip } from "./ui";

export function Board() {
  const { user } = useSession();
  const [board, setBoard] = useState<BoardData | null>(null);
  const [status, setStatus] = useState("");
  const sequence = useSequence();

  const load = useCallback(async () => {
    const id = sequence.next();
    const answer = await get<BoardData>("/api/housekeeping/board");
    if (answer.ok && sequence.isNewest(id)) setBoard(answer.data);
  }, [sequence]);
  useEffect(() => void load(), [load]);

  useLive((event) => {
    if (user.role === "housekeeper" && event.type === "room" && "roomId" in event && "number" in event) {
      setBoard((current) =>
        current && {
          ...current,
          rooms: current.rooms.map((room) => (room.roomId === event.roomId ? { ...room, status: event.status, arrival: event.arrival, departure: event.departure } : room)),
        },
      );
      if (event.notice) setStatus(event.notice);
    } else void load();
  });

  const choose = async (room: BoardRoom, wanted: RoomStatus): Promise<void> => {
    setStatus("Saving status…");
    const answer = await post<BoardRoom>(`/api/rooms/${room.roomId}/status`, { status: wanted });
    if (!answer.ok) return setStatus(refusalText(answer));
    setStatus(notices.roomStatus(room.number, wanted));
    setBoard((current) => current && { ...current, rooms: current.rooms.map((candidate) => (candidate.roomId === room.roomId ? answer.data : candidate)) });
  };

  const rooms = board?.rooms ?? [];
  return (
    <>
      <TopBar />
      <main className="page board">
        <h1>Board</h1>
        <div role="status" aria-label="Board status" className="notice">{status}</div>
        <section role="region" aria-label="Room board" className="room-board">
          {rooms.map((room) => (
            <section key={room.roomId} role="group" aria-label={`Room ${room.number}`} data-status={room.status} className="board-room">
              <h2>{room.number}</h2>
              <Chip status={room.status} />
              <p className="dates">{room.arrival && room.departure ? `${room.arrival} to ${room.departure}` : "Vacant"}</p>
              {(["clean", "dirty"] as const).map((target) => (
                <button
                  key={target}
                  type="button"
                  className="board-button"
                  aria-label={`Room ${room.number} ${target}`}
                  aria-pressed={room.status === target}
                  onClick={() => void choose(room, target)}
                >
                  {statusWords(target)}
                </button>
              ))}
            </section>
          ))}
        </section>
        <section>
          <h2>Today&apos;s stays</h2>
          <ul aria-label="Today's stays" className="plain-list">
            {rooms.filter((room) => room.arrival && room.departure).map((room) => (
              <li key={room.roomId}>{`Room ${room.number}: ${room.arrival} to ${room.departure}`}</li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
