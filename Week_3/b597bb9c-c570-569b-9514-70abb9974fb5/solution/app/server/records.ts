import type { Caption, Row } from "../shared/types";
import type { CaptionRec, RowRec } from "./timeline/model";

export function publicRow(row: RowRec): Row {
  return { id: row.id, name: row.name, kind: row.kind, position: row.position, locked: row.locked };
}

export function publicCaption(caption: CaptionRec): Caption {
  return { id: caption.id, row_id: caption.row_id, start_frame: caption.start_frame, end_frame: caption.end_frame, text: caption.text };
}
