import type { DialogHandle } from "./dialog";
import { Dialog } from "./dialog";

export interface DeleteTarget {
  id: string;
  designation: string;
  date: string;
}

interface Props {
  handle: DialogHandle;
  target: DeleteTarget | null;
  onConfirm(target: DeleteTarget): void;
}

export function DeleteDialog({ handle, target, onConfirm }: Props) {
  return (
    <Dialog handle={handle} label="Delete observation?">
      <h2>Delete observation?</h2>
      <p class="sentence">
        {target ? `${target.designation} from ${target.date} will be removed from your log, with its sketch.` : ""}
      </p>
      <div class="dialog-actions">
        <button type="button" class="btn" onClick={() => target && onConfirm(target)}>
          Delete
        </button>
        <button type="button" class="btn" data-initial onClick={() => handle.close()}>
          Keep observation
        </button>
      </div>
    </Dialog>
  );
}
