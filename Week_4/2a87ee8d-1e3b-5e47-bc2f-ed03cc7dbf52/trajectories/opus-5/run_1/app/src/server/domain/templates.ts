export const TEMPLATE_CODES = ['retrospective', 'discovery', 'strategy', 'blank'] as const;
export type TemplateCode = (typeof TEMPLATE_CODES)[number];

/** Every template frame is 800 wide and 600 high at y 0; frame i sits at x i × 900. */
const TEMPLATE_FRAME_WIDTH = 800;
const TEMPLATE_FRAME_HEIGHT = 600;
const TEMPLATE_FRAME_GAP = 900;

const TEMPLATE_FRAMES: Readonly<Record<TemplateCode, readonly string[]>> = {
  retrospective: ['Went well', 'To improve', 'Actions'],
  discovery: ['Problems', 'Opportunities', 'Questions'],
  strategy: ['Where we are', "Where we're going", "What's in the way"],
  blank: ['Ideas'],
};

export interface TemplateFrame {
  readonly title: string;
  readonly position: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function isTemplateCode(value: unknown): value is TemplateCode {
  return typeof value === 'string' && (TEMPLATE_CODES as readonly string[]).includes(value);
}

export function templateFrames(template: TemplateCode): TemplateFrame[] {
  return TEMPLATE_FRAMES[template].map((title, index) => ({
    title,
    position: index,
    x: index * TEMPLATE_FRAME_GAP,
    y: 0,
    width: TEMPLATE_FRAME_WIDTH,
    height: TEMPLATE_FRAME_HEIGHT,
  }));
}
