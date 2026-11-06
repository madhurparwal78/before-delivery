// CMX3600 edit decision list text: ASCII only by the folding table, CRLF
// line ends, the published fixed columns, and the frame arithmetic at the
// job's rate. The record times count from frame 107892 at 29.97 and from
// 01:00:00:00 at the other rates.

import { foldAscii } from "./folding";
import { timecode } from "./timecode";
import type { FrameRate } from "./framerate";

export type EdlClip = {
  frame: number;
  durationFrames: number;
  fileName: string | null;
};

function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}

// The record start of the first clip at a rate: 107892 display frames at
// 29.97, one hour of frames at the other rates.
function recordStart(rate: FrameRate): number {
  switch (rate) {
    case "29.97":
      return 107892;
    case "25":
      return 25 * 3600;
    case "23.976":
      return 24 * 3600;
  }
}

function clipName(clip: EdlClip): string {
  return clip.fileName ?? `frame-${clip.frame}.svg`;
}

// The one place a job's clips become an edit decision list.
export function editDecisionList(title: string, rate: FrameRate, clips: EdlClip[]): string {
  const lines: string[] = [];
  const foldedTitle = foldAscii(title).slice(0, 70);
  lines.push(`TITLE: ${foldedTitle}`);
  lines.push(rate === "29.97" ? "FCM: DROP FRAME" : "FCM: NON-DROP FRAME");
  lines.push("");
  let record = recordStart(rate);
  let event = 1;
  for (const clip of clips) {
    const sourceIn = timecode(0, rate);
    const sourceOut = timecode(clip.durationFrames, rate);
    const recordIn = timecode(record, rate);
    const recordOut = timecode(record + clip.durationFrames, rate);
    lines.push(
      `${pad(event, 3)}  AX       V     C        ${sourceIn} ${sourceOut} ${recordIn} ${recordOut}`,
    );
    lines.push(`* FROM CLIP NAME: ${foldAscii(clipName(clip))}`);
    record += clip.durationFrames;
    event++;
  }
  return lines.join("\r\n") + "\r\n";
}
