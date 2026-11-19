// The cluster ranking used everywhere clusters are ranked: dot total, then the frame's rail position, then the
// title ignoring case.
interface Rankable {
  dots: number;
  framePosition: number;
  title: string;
}

export function compareRanked(a: Rankable, b: Rankable): number {
  return b.dots - a.dots || a.framePosition - b.framePosition || a.title.toLowerCase().localeCompare(b.title.toLowerCase());
}
