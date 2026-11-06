// The shot list: comma separated, UTF-8, every field in double quotes, CRLF,
// with the published header row, and any cell that starts with =, +, -, @, a
// tab or a carriage return prefixed with an apostrophe.

import { realSecondsText } from "./framerate";
import { timecode } from "./timecode";
import type { FrameRate } from "./framerate";

export type ShotListFrame = {
  position: number;
  frame: number;
  timecodeIn: string;
  seconds: string;
  shot: string;
  visual: string;
  audio: string;
  actionNote: string;
};

// Builds one row's cells from a board frame at a rate: timecode in, real
// seconds half up to 0.01 with no unit, and the frame's own text.
export function shotListRow(
  position: number,
  frame: number,
  startFrame: number,
  durationFrames: number,
  rate: FrameRate,
  shot: string,
  visual: string,
  audio: string,
  actionNote: string,
): ShotListFrame {
  return {
    position,
    frame,
    timecodeIn: timecode(startFrame, rate),
    seconds: realSecondsText(durationFrames, rate).replace(" s", ""),
    shot,
    visual,
    audio,
    actionNote,
  };
}

function cell(text: string): string {
  let value = text ?? "";
  if (/^[=+\-@\t\r]/.test(value)) {
    value = `'${value}`;
  }
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

// The one place a job's frames become a shot list file.
export function shotList(rows: ShotListFrame[]): string {
  const header = ["position", "frame", "timecodeIn", "seconds", "shot", "visual", "audio", "actionNote"];
  const lines = [header.map(cell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.position.toString(),
        row.frame.toString(),
        row.timecodeIn,
        row.seconds,
        row.shot,
        row.visual,
        row.audio,
        row.actionNote,
      ]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
