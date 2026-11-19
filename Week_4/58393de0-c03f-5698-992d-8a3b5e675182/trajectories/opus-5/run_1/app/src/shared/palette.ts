/** The four solid shape colours, cycled in creation order. */
export const SHAPE_COLORS = ['#3fa34d', '#7b3ff2', '#f08a24', '#2f80ed'] as const;

export const colorForIndex = (index: number): string => SHAPE_COLORS[index % SHAPE_COLORS.length];
