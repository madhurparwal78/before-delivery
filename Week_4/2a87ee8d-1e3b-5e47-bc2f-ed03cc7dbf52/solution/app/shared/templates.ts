export const TEMPLATES = {
  retrospective: { label: "Retrospective", frames: ["Went well", "To improve", "Actions"] },
  discovery: { label: "Discovery sprint", frames: ["Problems", "Opportunities", "Questions"] },
  strategy: { label: "Strategy offsite", frames: ["Where we are", "Where we're going", "What's in the way"] },
  blank: { label: "Blank", frames: ["Ideas"] },
} as const;

export type Template = keyof typeof TEMPLATES;

export const FRAME_WIDTH = 800;
export const FRAME_HEIGHT = 600;
export const FRAME_STEP = 900;

export function isTemplate(value: unknown): value is Template {
  return typeof value === "string" && Object.hasOwn(TEMPLATES, value);
}
