// Lucide icon path data (ISC licence). See THIRD_PARTY_NOTICES.md.
export type IconName =
  | "menu"
  | "x"
  | "chevron-left"
  | "chevron-right"
  | "crosshair"
  | "play"
  | "lightbulb"
  | "plug"
  | "thermometer"
  | "video"
  | "map"
  | "calendar"
  | "lamp"
  | "list"
  | "bell"
  | "users"
  | "plus"
  | "rotate-cw"
  | "trash-2"
  | "square-pen";

const PATHS: Record<IconName, string> = {
  "menu": "<path d=\"M4 5h16\" /><path d=\"M4 12h16\" /><path d=\"M4 19h16\" />",
  "x": "<path d=\"M18 6 6 18\" /><path d=\"m6 6 12 12\" />",
  "chevron-left": "<path d=\"m15 18-6-6 6-6\" />",
  "chevron-right": "<path d=\"m9 18 6-6-6-6\" />",
  "crosshair": "<circle cx=\"12\" cy=\"12\" r=\"10\" /><line x1=\"22\" x2=\"18\" y1=\"12\" y2=\"12\" /><line x1=\"6\" x2=\"2\" y1=\"12\" y2=\"12\" /><line x1=\"12\" x2=\"12\" y1=\"6\" y2=\"2\" /><line x1=\"12\" x2=\"12\" y1=\"22\" y2=\"18\" />",
  "play": "<path d=\"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z\" />",
  "lightbulb": "<path d=\"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5\" /><path d=\"M9 18h6\" /><path d=\"M10 22h4\" />",
  "plug": "<path d=\"M12 22v-5\" /><path d=\"M15 8V2\" /><path d=\"M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z\" /><path d=\"M9 8V2\" />",
  "thermometer": "<path d=\"M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z\" />",
  "video": "<path d=\"m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5\" /><rect x=\"2\" y=\"6\" width=\"14\" height=\"12\" rx=\"2\" />",
  "map": "<path d=\"M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z\" /><path d=\"M15 5.764v15\" /><path d=\"M9 3.236v15\" />",
  "calendar": "<path d=\"M8 2v3\" /><path d=\"M16 2v3\" /><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\" /><path d=\"M3 9h18\" />",
  "lamp": "<path d=\"M12 12v6\" /><path d=\"M4.077 10.615A1 1 0 0 0 5 12h14a1 1 0 0 0 .923-1.385l-3.077-7.384A2 2 0 0 0 15 2H9a2 2 0 0 0-1.846 1.23Z\" /><path d=\"M8 20a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z\" />",
  "list": "<path d=\"M3 5h.01\" /><path d=\"M3 12h.01\" /><path d=\"M3 19h.01\" /><path d=\"M8 5h13\" /><path d=\"M8 12h13\" /><path d=\"M8 19h13\" />",
  "bell": "<path d=\"M10.268 21a2 2 0 0 0 3.464 0\" /><path d=\"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326\" />",
  "users": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\" /><path d=\"M16 3.128a4 4 0 0 1 0 7.744\" /><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\" /><circle cx=\"9\" cy=\"7\" r=\"4\" />",
  "plus": "<path d=\"M5 12h14\" /><path d=\"M12 5v14\" />",
  "rotate-cw": "<path d=\"M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8\" /><path d=\"M21 3v5h-5\" />",
  "trash-2": "<path d=\"M10 11v6\" /><path d=\"M14 11v6\" /><path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\" /><path d=\"M3 6h18\" /><path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\" />",
  "square-pen": "<path d=\"M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7\" /><path d=\"M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z\" />",
};

export function icon(name: IconName): string {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}
