/** The scroll lines: each is a fraction of the viewport height, read from an element's top edge on every scroll and resize. */

const CURRENT_SECTION_LINE = 0.4;
export const MILESTONE_LINE = 0.6;
export const COUNTER_START_LINE = 0.75;
export const SKILL_BARS_LINE = 0.75;
export const FOOTER_WAVE_LINE = 0.9;

export function reachedLine(top: number, viewportHeight: number, line: number): boolean {
  return top <= line * viewportHeight;
}

interface SectionTop<Id extends string> {
  readonly id: Id;
  readonly top: number;
}

/** The last section, in page order, whose top edge is at or above the 40% line. */
export function currentSectionId<Id extends string>(sections: readonly SectionTop<Id>[], viewportHeight: number): Id | undefined {
  return sections.filter((section) => reachedLine(section.top, viewportHeight, CURRENT_SECTION_LINE)).at(-1)?.id;
}
