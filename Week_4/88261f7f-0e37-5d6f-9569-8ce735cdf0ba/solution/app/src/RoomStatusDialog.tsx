import type { RoomStatus, TimelineRoom } from "../shared/api";
import { notices, statusWords } from "../shared/notices";
import { post, refusalText } from "./api";
import { Layer } from "./dialogs";
import { useBusy } from "./hooks";

const OPTIONS: { status: RoomStatus; label: string }[] = [
  { status: "dirty", label: "Dirty" },
  { status: "clean", label: "Clean" },
  { status: "inspected", label: "Inspected" },
  { status: "out_of_order", label: "Out of order" },
];

export function RoomStatusDialog({ room, open, onClose, setNotice }: { room: TimelineRoom | undefined; open: boolean; onClose: () => void; setNotice: (text: string) => void }) {
  const [busy, guard] = useBusy();
  const choose = (status: RoomStatus): void =>
    void guard(async () => {
      if (!room) return;
      setNotice("Saving status…");
      const answer = await post(`/api/rooms/${room.id}/status`, { status });
      setNotice(answer.ok ? notices.roomStatus(room.number, status) : refusalText(answer));
      onClose();
    });
  return (
    <Layer name="Room status" open={open} onClose={onClose} className="dialog narrow">
      <h2>Room {room?.number}</h2>
      <p className="muted">Now {room ? statusWords(room.status) : ""}.</p>
      <div className="button-row">
        {OPTIONS.map((option) => (
          <button key={option.status} type="button" aria-pressed={room?.status === option.status} aria-busy={busy} onClick={() => choose(option.status)}>
            {option.label}
          </button>
        ))}
      </div>
      <button type="button" className="quiet" onClick={onClose}>Close</button>
    </Layer>
  );
}
