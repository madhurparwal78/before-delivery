import { Dialog } from "../ui/Dialog";
import type { Axis } from "./model";

const AXES: readonly Axis[] = ["x", "y", "z"];

interface AlignDialogProps {
  open: boolean;
  count: number;
  onClose: () => void;
  onAlign: (axis: Axis) => void;
}

/** Asks which axis to line the selected shapes' centres up on. */
export function AlignDialog({ open, count, onClose, onAlign }: AlignDialogProps) {
  return (
    <Dialog open={open} title="Align" onClose={onClose}>
      <p>Line up the centres of the {count} selected shapes on one axis. Their other positions stay as they are.</p>
      <div className="dialog-actions">
        {AXES.map((axis) => (
          <button
            key={axis}
            type="button"
            className="pill pill--3d"
            onClick={() => {
              onAlign(axis);
              onClose();
            }}
          >
            Align centers on {axis.toUpperCase()}
          </button>
        ))}
        <button type="button" className="pill pill--outline" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}
