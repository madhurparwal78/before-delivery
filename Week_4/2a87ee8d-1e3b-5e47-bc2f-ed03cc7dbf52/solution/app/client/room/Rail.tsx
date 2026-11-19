import { useState } from "react";
import { Plus } from "lucide-react";
import { api, ApiFailure, opId } from "../api.js";
import { FRAME_HEIGHT, FRAME_WIDTH } from "../../shared/templates.js";
import { isEnded } from "../../shared/states.js";
import type { RoomActions } from "./Room.js";
import { TitlePrompt } from "./Editors.js";

export function Rail({ actions, onPick }: { actions: RoomActions; onPick: (frameId: string) => void }) {
  const { view, board, facilitator } = actions;
  const [active, setActive] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const ended = isEnded(board.workshop.status);
  return (
    <nav aria-label="Frames" className="rail">
      <p className="rail-title">Frames</p>
      <ul className="rail-list">
        {view.frames.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              className="rail-item"
              aria-current={active === f.id ? "true" : undefined}
              onClick={() => {
                setActive(f.id);
                onPick(f.id);
              }}
            >
              {f.title}
            </button>
          </li>
        ))}
      </ul>
      {facilitator && !ended && (
        <button type="button" className="btn btn-quiet rail-add" onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" size={18} strokeWidth={1.75} />
          Add frame
        </button>
      )}
      {adding && (
        <TitlePrompt
          label="Frame title"
          submit="Create frame"
          initial=""
          onCancel={() => setAdding(false)}
          onSubmit={async (title) => {
            const right = Math.max(0, ...board.frames.map((f) => f.x + f.width));
            try {
              await api("POST", `/api/workshops/${board.workshop.id}/frames`, { clientOpId: opId(), title, x: right + 100, y: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT });
              setAdding(false);
              actions.say(`Frame ${title} added`);
              void actions.refresh();
            } catch (e) {
              actions.complain(e instanceof ApiFailure && e.code === "validation" ? (Object.values(e.fields)[0] ?? e.message) : actions.failed(e));
            }
          }}
        />
      )}
    </nav>
  );
}
