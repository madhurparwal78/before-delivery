import type { ToyView } from "./toyRig";

/** The stylesheet's breakpoints: narrow under 600 pixels, medium to 1023, wide from 1024. */
const NARROW_PX = 600;
const WIDE_PX = 1024;

export type Breakpoint = "narrow" | "medium" | "wide";

export const breakpointOf = (width: number): Breakpoint => (width < NARROW_PX ? "narrow" : width < WIDE_PX ? "medium" : "wide");

/** The poster card shows the three toys close together on a workplane grid. */
export const POSTER_VIEW: ToyView = {
  layout: { wedge: { x: -62, y: 0, turn: 0.45 }, cylinder: { x: 0, y: 8 }, box: { x: 62, y: 0, turn: -0.5 } },
  framing: { azimuth: 14, elevation: 28, fov: 28, halfWidth: 100, halfHeight: 56, target: [0, 0, 14] },
  grid: true,
};

interface HeroLook {
  view: ToyView;
  /** The drawing size the SVG still uses for its viewBox. */
  box: { width: number; height: number };
}

/** The hero spreads the toys across the full width, the wedge and box at the sides and the cylinder peeking over the poster. */
export const HERO_LOOKS: Record<Breakpoint, HeroLook> = {
  wide: {
    view: {
      layout: { wedge: { x: -137, y: 0, turn: 0.5 }, cylinder: { x: 0, y: 34 }, box: { x: 126, y: 0, turn: -0.45 } },
      framing: { azimuth: 10, elevation: 27, fov: 28, halfWidth: 152, halfHeight: 70, target: [0, 0, 26] },
      grid: false,
    },
    box: { width: 1280, height: 480 },
  },
  medium: {
    view: {
      layout: { wedge: { x: -86, y: 0, turn: 0.5 }, cylinder: { x: 0, y: 30 }, box: { x: 86, y: 0, turn: -0.45 } },
      framing: { azimuth: 10, elevation: 27, fov: 28, halfWidth: 124, halfHeight: 70, target: [0, 0, 40] },
      grid: false,
    },
    box: { width: 768, height: 460 },
  },
  narrow: {
    view: {
      layout: { wedge: { x: -56, y: 0, turn: 0.5 }, cylinder: { x: 0, y: 16 }, box: { x: 56, y: 0, turn: -0.45 } },
      framing: { azimuth: 10, elevation: 22, fov: 28, halfWidth: 96, halfHeight: 60, target: [0, 0, 30] },
      grid: false,
    },
    box: { width: 375, height: 380 },
  },
};

export const POSTER_BOX = { width: 605, height: 340 } as const;
