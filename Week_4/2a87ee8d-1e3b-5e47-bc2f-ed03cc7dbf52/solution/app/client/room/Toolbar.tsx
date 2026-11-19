import { useRef, type RefObject } from "react";
import { Group, ImagePlus, Maximize, Spline, StickyNote, ZoomIn, ZoomOut, type LucideIcon } from "lucide-react";
import type { CanvasHandle } from "./Canvas.js";
import type { RoomActions } from "./Room.js";

function Tool({ label, icon: Icon, onClick, pressed }: { label: string; icon: LucideIcon; onClick: () => void; pressed?: boolean }) {
  return (
    <button type="button" className="tool" aria-label={label} data-tip={label} aria-pressed={pressed} onClick={onClick}>
      <Icon aria-hidden="true" size={20} strokeWidth={1.75} />
    </button>
  );
}

export function Toolbar({
  actions,
  uploading,
  onAddNote,
  onAddImage,
  onAddCluster,
  canvas,
}: {
  actions: RoomActions;
  uploading: boolean;
  onAddNote: () => void;
  onAddImage: (file: File) => void;
  onAddCluster: () => void;
  canvas: RefObject<CanvasHandle>;
}) {
  const file = useRef<HTMLInputElement>(null);
  return (
    <div role="toolbar" aria-label="Board tools" className="toolbar">
      <Tool label="Add note" icon={StickyNote} onClick={onAddNote} />
      <Tool label="Add image" icon={ImagePlus} onClick={() => file.current?.click()} />
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (picked) onAddImage(picked);
        }}
      />
      <Tool label="Add cluster" icon={Group} onClick={onAddCluster} />
      <Tool
        label="Connect notes"
        icon={Spline}
        pressed={actions.connecting}
        onClick={() => {
          actions.setConnecting(!actions.connecting);
          if (!actions.connecting) actions.say("Connect mode: choose a first note, then a second. Escape leaves.");
        }}
      />
      <span className="toolbar-rule" aria-hidden="true" />
      <Tool label="Zoom out" icon={ZoomOut} onClick={() => canvas.current?.zoomBy(1 / 1.25)} />
      <Tool label="Zoom in" icon={ZoomIn} onClick={() => canvas.current?.zoomBy(1.25)} />
      <Tool label="Fit board" icon={Maximize} onClick={() => canvas.current?.fit()} />
      {uploading && <span className="toolbar-note">Uploading…</span>}
    </div>
  );
}
