/**
 * The palette roles and type steps of the published visual language.
 */

export const COLOURS = {
  ground: '#ffffff',
  surface: '#f4f2f8',
  surfaceDeep: '#ece8f3',
  ink: '#241b33',
  inkMuted: '#6f687f',
  line: '#ddd8e6',
  accent: '#2b4ef2',
  accentInk: '#ffffff',
  focus: '#2b4ef2',
  gold: '#e8a522',
  white: '#ffffff',
  scrim: 'rgba(26, 16, 43, 0.45)',
  marker: '#e07a1f',
  branch: {
    indigo: '#4f46e5',
    azure: '#0284c7',
    teal: '#0d9488',
    green: '#16a34a',
    violet: '#7c3aed',
    magenta: '#c026d3',
    orange: '#ea580c',
    ochre: '#d9a441',
    accent: '#2b4ef2',
  },
} as const;

export const TYPE_SCALE = {
  bodyPx: 16,
  heroPx: 64,
  sectionPx: 40,
  subheadPx: 32,
} as const;

export const CORNERS = {
  control: 8,
  pill: 12,
  dialog: 14,
  card: 16,
  panel: 20,
} as const;

export const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;

export const BRANCH_ORDER = ['indigo', 'azure', 'teal', 'green', 'violet', 'magenta', 'orange', 'ochre'] as const;
