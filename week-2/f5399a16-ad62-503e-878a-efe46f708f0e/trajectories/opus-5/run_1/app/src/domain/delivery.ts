import { writeCsv } from './csv.js';
import { foldToAscii } from './folding.js';
import { toFixedHalfUp } from './rational.js';
import {
  isDropFrame,
  realSeconds,
  recordStartFrame,
  timecode,
} from './timecode.js';
import type { FrameRate } from './timecode.js';

export type DeliveryFrame = {
  number: number;
  position: number;
  durationFrames: number;
  shot: string;
  visual: string;
  audioNote: string;
  actionNote: string;
  fileName: string;
};

/** CMX3600 text, ASCII only by the folding table, CRLF line ends. */
export function editDecisionList(
  title: string,
  rate: FrameRate,
  frames: readonly DeliveryFrame[],
): string {
  const lines = [
    `TITLE: ${foldToAscii(title).slice(0, 70)}`,
    `FCM: ${isDropFrame(rate) ? 'DROP FRAME' : 'NON-DROP FRAME'}`,
    '',
  ];
  let record = recordStartFrame(rate);
  for (const [index, frame] of frames.entries()) {
    const sourceIn = timecode(0, rate);
    const sourceOut = timecode(frame.durationFrames, rate);
    const recordIn = timecode(record, rate);
    const recordOut = timecode(record + frame.durationFrames, rate);
    lines.push(
      `${String(index + 1).padStart(3, '0')}  AX       V     C        ` +
        `${sourceIn} ${sourceOut} ${recordIn} ${recordOut}`,
      `* FROM CLIP NAME: ${foldToAscii(frame.fileName)}`,
    );
    record += frame.durationFrames;
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Comma separated, every field quoted, CRLF, with typed cells made safe. */
export function shotList(rate: FrameRate, frames: readonly DeliveryFrame[]): string {
  const rows: string[][] = [
    ['position', 'frame', 'timecodeIn', 'seconds', 'shot', 'visual', 'audio', 'actionNote'],
  ];
  let running = 0;
  for (const frame of frames) {
    rows.push([
      String(frame.position),
      String(frame.number),
      timecode(running, rate),
      toFixedHalfUp(realSeconds(frame.durationFrames, rate), 2),
      frame.shot,
      frame.visual,
      frame.audioNote,
      frame.actionNote,
    ]);
    running += frame.durationFrames;
  }
  return writeCsv(rows);
}

/** Six frames a page in position order, so 12 frames make 2 pages and 13 make 3. */
export const FRAMES_A_PAGE = 6;

export function boardsHtml(
  title: string,
  rate: FrameRate,
  frames: readonly (DeliveryFrame & { drawing: string })[],
): string {
  const pages: string[] = [];
  let running = 0;
  const captions = frames.map((frame) => {
    const text = timecode(running, rate);
    running += frame.durationFrames;
    return text;
  });
  for (let start = 0; start < frames.length; start += FRAMES_A_PAGE) {
    const cells = frames
      .slice(start, start + FRAMES_A_PAGE)
      .map((frame, offset) => {
        const timecodeIn = captions[start + offset] as string;
        return `<figure class="cell"><img src="${frame.drawing}" alt=""><figcaption>Frame ${
          frame.number
        } · ${timecodeIn} · ${escapeHtml(frame.actionNote)}</figcaption></figure>`;
      })
      .join('');
    pages.push(`<section class="page"><div class="grid">${cells}</div></section>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page{size:A4 portrait;margin:12mm}
  *{box-sizing:border-box}
  body{font-family:Georgia,serif;color:#141414;margin:0}
  .page{break-after:page;page-break-after:always}
  .page:last-child{break-after:auto;page-break-after:auto}
  .grid{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(3,1fr);gap:6mm;height:265mm}
  .cell{margin:0;display:flex;flex-direction:column;min-height:0}
  .cell img{width:100%;height:auto;border:1px solid #141414;object-fit:contain}
  figcaption{font-size:9pt;line-height:1.3;padding-top:2mm;word-break:break-word}
  </style><title>${escapeHtml(title)}</title></head><body>${pages.join('')}</body></html>`;
}

function escapeHtml(text: string): string {
  return text.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
}
